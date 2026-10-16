export const MEZO_TESTNET = 31611 as const;
export const MEZO_MAINNET = 31612 as const;
export type ChainId = typeof MEZO_TESTNET | typeof MEZO_MAINNET;

type Hex = `0x${string}`;
export interface MezoAddresses {
  veBTC: Hex;
  voter: Hex;
  btc: Hex;
  forwarder: Hex; // listed so we can assert we never use it
  troveManager: Hex;
  sortedTroves: Hex;
  borrowerOperations: Hex;
  borrowerOperationsSignatures: Hex | null;
  priceFeed: Hex;
  hintHelpers: Hex;
  musd: Hex;
  smusd: Hex | null;
  lockwatchVault: Hex | null; // current vault (v2: protect + auto-extend + reward auto-claim)
  lockwatchVaultsLegacy: Hex[]; // older vaults the keeper still serves (existing registrations keep working)
  lockwatchRescue: Hex | null; // loan rescue escrow
  veBTCDeployBlock: bigint;
  // veMEZO (vote-escrowed MEZO, same tigris VotingEscrow, 4-year max, BoostVoter = bribes only)
  mezo: Hex;
  veMEZO: Hex;
  veMEZOVoter: Hex; // BoostVoter
  lockwatchVaultMezo: Hex | null; // LockwatchVault instance bound to veMEZO (RETURN/RELOCK only)
  /** tigris RewardsDistributor (weekly rebases). claim(tokenId) is permissionless: compounds into a live lock, pays the owner if expired. */
  rebaseDistributor: Hex | null;
  rebaseDistributorMezo: Hex | null;
}

export const ADDRESSES: Record<ChainId, MezoAddresses> = {
  [MEZO_TESTNET]: {
    veBTC: "0xB63fcCd03521Cf21907627bd7fA465C129479231",
    voter: "0x72F8dd7F44fFa19E45955aa20A5486E8EB255738",
    btc: "0x7b7C000000000000000000000000000000000000",
    forwarder: "0x5fA3D34F6c1537A0393098F0e124064B66cE8E24",
    troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
    sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
    borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
    borrowerOperationsSignatures: "0xD757e3646AF370b15f32EB557F0F8380Df7D639e",
    priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
    hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
    musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
    smusd: null,
    lockwatchVault: "0xdd5baB25b65C4697A2e14F47B919B61416A0cAdB",
    lockwatchVaultsLegacy: ["0xD7160697f3ACd0191e65bcccaAFeaa0913D21999"],
    lockwatchRescue: "0x4408e3348584d37a4412B0BeEF71a3e97Fd32f64",
    veBTCDeployBlock: 0n,
    mezo: "0x7B7c000000000000000000000000000000000001",
    veMEZO: "0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b",
    veMEZOVoter: "0x21d7bDF5a5929AD179F8cA0c9014A0B62ae6Bfd1",
    lockwatchVaultMezo: "0x24fd63DE4274c71B51cA08adEd519B6cC72f27ae",
    rebaseDistributor: "0x10B0E7b3411F4A38ca2F6BB697aA28D607924729",
    rebaseDistributorMezo: "0x2962E8817ae716019F759d098e2caE658bDcAd04",
  },
  [MEZO_MAINNET]: {
    veBTC: "0x7D807e9CE1ef73048FEe9A4214e75e894ea25914",
    voter: "0x3A4a6919F70e5b0aA32401747C471eCfe2322C1b",
    btc: "0x7b7C000000000000000000000000000000000000",
    forwarder: "0xE6F919e62c370Ef04EDF4cA5E2a901Ea1aa87085",
    troveManager: "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
    sortedTroves: "0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f",
    borrowerOperations: "0x44b1bac67dDA612a41a58AAf779143B181dEe031",
    borrowerOperationsSignatures: null,
    priceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88",
    hintHelpers: "0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3",
    musd: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
    smusd: "0xb4D498029af77680cD1eF828b967f010d06C51CC",
    lockwatchVault: null,
    lockwatchVaultsLegacy: [],
    lockwatchRescue: null,
    veBTCDeployBlock: 0n,
    mezo: "0x7B7c000000000000000000000000000000000001",
    veMEZO: "0xb90fdAd3DFD180458D62Cc6acedc983D78E20122",
    veMEZOVoter: "0x0000000000000000000000000000000000000000", // read veMEZO.voter() before mainnet launch
    lockwatchVaultMezo: null,
    rebaseDistributor: "0x535E01F948458E0b64F9dB2A01Da6F32E240140f",
    rebaseDistributorMezo: null, // not published in tigris deployments yet
  },
};

export const RPC: Record<ChainId, string> = {
  [MEZO_TESTNET]: "https://rpc.test.mezo.org",
  [MEZO_MAINNET]: "https://mainnet.mezo.public.validationcloud.io",
};

export const EXPLORER: Record<ChainId, string> = {
  [MEZO_TESTNET]: "https://explorer.test.mezo.org",
  [MEZO_MAINNET]: "https://explorer.mezo.org",
};

export function explorerUrl(chain: ChainId, kind: "tx" | "address" | "token", id: string): string {
  return `${EXPLORER[chain]}/${kind}/${id}`;
}
