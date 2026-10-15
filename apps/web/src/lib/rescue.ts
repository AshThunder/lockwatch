import { formatEther } from "viem";

/** Steps the rescue setup will walk through, given what is already in the reserve. */
export const rescueSteps = (p: { add: bigint; repay: bigint; btcEscrow: bigint; musdEscrow: bigint }) => [
  ...(p.add > p.btcEscrow ? [{ k: "depositBtc", t: `Move ${formatEther(p.add - p.btcEscrow)} BTC into your rescue reserve` }] : []),
  ...(p.repay > p.musdEscrow ? [{ k: "approveMusd", t: "Allow the reserve to take MUSD" }, { k: "depositMusd", t: `Move ${formatEther(p.repay - p.musdEscrow)} MUSD into your reserve` }] : []),
  { k: "sign", t: p.add && p.repay ? "Sign the top-up and the repayment" : "Sign the top-up" },
  { k: "setRule", t: "Save the rescue rule" },
];

