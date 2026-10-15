import type { Address } from "viem";

/** EIP-712 OpenTrove for MUSD BorrowerOperationsSignatures (domain "BorrowerOperationsSignatures" v1).
 *  Nonce = bos.getNonce(borrower); any other signed BOS action by the borrower consumes it. */
export function openTroveTypedData(p: {
  chainId: number;
  bos: Address;
  assetAmount: bigint; // exact BTC the vault will forward = veBTC locked(id).amount
  debtAmount: bigint;
  borrower: Address;
  recipient: Address; // owner (MUSD mode) or the vault (MUSD_SAVINGS mode)
  nonce: bigint;
  deadline: bigint;
}) {
  return {
    domain: { name: "BorrowerOperationsSignatures", version: "1", chainId: p.chainId, verifyingContract: p.bos },
    types: {
      OpenTrove: [
        { name: "assetAmount", type: "uint256" },
        { name: "debtAmount", type: "uint256" },
        { name: "borrower", type: "address" },
        { name: "recipient", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "OpenTrove" as const,
    message: {
      assetAmount: p.assetAmount,
      debtAmount: p.debtAmount,
      borrower: p.borrower,
      recipient: p.recipient,
      nonce: p.nonce,
      deadline: p.deadline,
    },
  };
}

export const MIN_NET_DEBT = 2000n * 10n ** 18n;
export const GAS_COMPENSATION = 200n * 10n ** 18n;

/** NICR used for SortedTroves hints (coll * 1e20 / compositeDebt). */
export const nicr = (coll: bigint, compositeDebt: bigint) => (coll * 10n ** 20n) / compositeDebt;

export enum Mode { RETURN = 0, RELOCK = 1, MUSD = 2, MUSD_SAVINGS = 3 }

export const NOT_PROTECTABLE_REASONS: Record<number, string> = {
  0: "ok",
  1: "not registered",
  2: "lock changed owner — re-register",
  3: "not expired yet",
  4: "permanent lock",
  5: "vault not approved — re-approve",
  6: "votes can't be reset until 01:00 UTC Thursday (or voted this epoch)",
  7: "managed/locked NFT",
};
