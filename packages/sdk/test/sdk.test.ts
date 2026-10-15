import { describe, expect, it } from "vitest";
import { hashTypedData, keccak256, toHex, encodeAbiParameters, concat } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  WEEK, DAY, epochStart, lockEnd, validLockEnds, resetWindowOpen, inBurstWindow,
  lockStatus, dueExpiryAlerts, summarizeAtRisk, redemptionLine, radarRisk, redemptionHit,
  collToPass, repayToPass, openTroveTypedData, MCR,
} from "../src";

const THU = 1792022400; // Thu 2026-10-15 00:00 UTC
describe("time", () => {
  it("epochs flip Thursday 00:00 UTC", () => {
    expect(new Date(THU * 1000).getUTCDay()).toBe(4);
    expect(epochStart(THU + 5 * DAY)).toBe(THU);
  });
  it("lock ends round down to week, max 30d", () => {
    expect(lockEnd(THU + DAY, 10 * DAY)).toBe(THU + WEEK);
    const ends = validLockEnds(THU + DAY);
    expect(ends[0]).toBe(THU + WEEK);
    expect(ends.at(-1)!).toBeLessThanOrEqual(THU + DAY + 30 * DAY);
    expect(ends.length).toBe(4);
  });
  it("reset window mirrors Voter.onlyNewEpoch", () => {
    expect(resetWindowOpen(THU + 30 * 60, THU - DAY)).toBe(false);
    expect(resetWindowOpen(THU + 3601, THU - DAY)).toBe(true);
    expect(resetWindowOpen(THU + 7200, THU + 3700)).toBe(false);
  });
  it("burst window", () => {
    expect(inBurstWindow(THU + 60)).toBe(true);
    expect(inBurstWindow(THU - 60)).toBe(true);
    expect(inBurstWindow(THU + 3600)).toBe(true);
    expect(inBurstWindow(THU + 3 * 3600)).toBe(false);
  });
});

describe("locks", () => {
  const now = THU;
  it("status thresholds", () => {
    expect(lockStatus({ end: now + 8 * DAY, permanent: false }, now)).toBe("active");
    expect(lockStatus({ end: now + 3 * DAY, permanent: false }, now)).toBe("expiring");
    expect(lockStatus({ end: now + 3600, permanent: false }, now)).toBe("critical");
    expect(lockStatus({ end: now, permanent: false }, now)).toBe("expired");
    expect(lockStatus({ end: now, permanent: true }, now)).toBe("permanent");
  });
  it("due alerts", () => {
    expect(dueExpiryAlerts({ end: now + 6 * DAY, permanent: false }, now)).toEqual(["lock_t7d"]);
    expect(dueExpiryAlerts({ end: now - 1, permanent: false }, now)).toEqual(["lock_expired"]);
    expect(dueExpiryAlerts({ end: now - 1, permanent: false, withdrawn: true }, now)).toEqual([]);
  });
  it("at-risk summary", () => {
    const a = "0x0000000000000000000000000000000000000001" as const;
    const s = summarizeAtRisk(
      [
        { id: 1n, owner: a, amount: 10n, end: now - DAY, permanent: false, voted: false },
        { id: 2n, owner: a, amount: 5n, end: now - 100 * DAY, permanent: false, voted: false },
        { id: 3n, owner: a, amount: 7n, end: now + WEEK, permanent: false, voted: false },
        { id: 4n, owner: a, amount: 9n, end: now - DAY, permanent: false, voted: false, withdrawn: true },
      ],
      now,
    );
    expect(s.expiredCount).toBe(2);
    expect(s.expiredBtc).toBe(15n);
    expect(s.owners).toBe(1);
    expect(s.buckets[0].count).toBe(1);
    expect(s.buckets[3].btc).toBe(5n);
    expect(s.upcoming).toEqual([{ end: now + WEEK, count: 1, btc: 7n }]);
  });
});

describe("radar", () => {
  const P = 80_000n * 10n ** 18n;
  const e = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
  const t = (o: number, coll: number, debt: number) => ({ owner: `0x${o.toString(16).padStart(40, "0")}` as `0x${string}`, coll: e(coll), debt: e(debt) });
  const troves = [t(1, 1, 50_000), t(2, 0.1, 7_500), t(3, 0.05, 3_000), t(4, 1, 76_000)];
  const line = redemptionLine(troves, P);
  it("orders by ICR ascending, skips < MCR", () => {
    expect(line.map((x) => Number(x.owner))).toEqual([4, 2, 3, 1]); // 105.3%, 106.7%, 133%, 160%
    expect(line[0].redeemable).toBe(false);
    expect(line[0].icr < MCR).toBe(true);
  });
  it("musdAhead and rank", () => {
    const x3 = line.find((x) => Number(x.owner) === 3)!;
    expect(x3.rank).toBe(1);
    expect(x3.musdAhead).toBe(0n);
    const x1 = line.find((x) => Number(x.owner) === 1)!;
    expect(x1.rank).toBe(2);
    expect(x1.musdAhead).toBe(e(3000));
    expect(redemptionHit(x1, e(2000))).toBe(0n);
    expect(redemptionHit(x1, e(4000))).toBe(e(1000));
    expect(radarRisk(x1, e(10_000))).toBe("danger");
    expect(radarRisk(x1, e(100))).toBe("safe");
  });
  it("suggestions move the trove behind a target", () => {
    const me = troves[2];
    const target = line.find((x) => Number(x.owner) === 1)!.icr;
    const add = collToPass(me, target, P);
    expect(((me.coll + add) * P) / me.debt > target).toBe(true);
    const rep = repayToPass(me, target, P);
    expect((me.coll * P) / (me.debt - rep) > target).toBe(true);
  });
});

describe("eip712", () => {
  it("matches the contract's abi.encodePacked(typehash, abi.encode(...), nonce, deadline) digest", async () => {
    const acct = privateKeyToAccount("0x" + "11".repeat(32) as `0x${string}`);
    const bos = "0xD757e3646AF370b15f32EB557F0F8380Df7D639e";
    const td = openTroveTypedData({ chainId: 31611, bos, assetAmount: 10n ** 17n, debtAmount: 2500n * 10n ** 18n, borrower: acct.address, recipient: acct.address, nonce: 0n, deadline: 2_000_000_000n });
    const viemDigest = hashTypedData(td);
    const TH = keccak256(toHex("OpenTrove(uint256 assetAmount,uint256 debtAmount,address borrower,address recipient,uint256 nonce,uint256 deadline)"));
    const DT = keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"));
    const dom = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }], [DT, keccak256(toHex("BorrowerOperationsSignatures")), keccak256(toHex("1")), 31611n, bos]));
    const sh = keccak256(concat([TH, encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "address" }, { type: "address" }], [10n ** 17n, 2500n * 10n ** 18n, acct.address, acct.address]), toHex(0n, { size: 32 }), toHex(2_000_000_000n, { size: 32 })]));
    expect(viemDigest).toBe(keccak256(concat(["0x1901", dom, sh])));
    expect(await acct.signTypedData(td)).toMatch(/^0x[0-9a-f]{130}$/);
  });
});
