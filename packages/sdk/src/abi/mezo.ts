import { parseAbi } from "viem";

export const veBTCAbi = parseAbi([
  "function tokenId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function getApproved(uint256) view returns (address)",
  "function isApprovedForAll(address,address) view returns (bool)",
  "function locked(uint256) view returns ((int128 amount, uint256 end, bool isPermanent))",
  "function voted(uint256) view returns (bool)",
  "function escrowType(uint256) view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function ownerToNFTokenIdList(address,uint256) view returns (uint256)",
  "function approve(address,uint256)",
  "function withdraw(uint256)",
  "function increaseUnlockTime(uint256,uint256)",
  "function createLock(uint256,uint256) returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
  "event Deposit(address indexed provider, uint256 indexed tokenId, uint8 indexed depositType, uint256 value, uint256 locktime, uint256 ts)",
  "event Withdraw(address indexed provider, uint256 indexed tokenId, uint256 value, uint256 ts)",
]);

export const voterAbi = parseAbi([
  "function lastVoted(uint256) view returns (uint256)",
  "function reset(uint256)",
  "event Voted(address indexed voter, address indexed pool, uint256 indexed tokenId, uint256 weight, uint256 totalWeight, uint256 timestamp)",
  "event Abstained(address indexed voter, address indexed pool, uint256 indexed tokenId, uint256 weight, uint256 totalWeight, uint256 timestamp)",
]);

export const sortedTrovesAbi = parseAbi([
  "function getSize() view returns (uint256)",
  "function getFirst() view returns (address)",
  "function getLast() view returns (address)",
  "function getPrev(address) view returns (address)",
  "function getNext(address) view returns (address)",
  "function findInsertPosition(uint256,address,address) view returns (address,address)",
]);

export const troveManagerAbi = parseAbi([
  "function getCurrentICR(address,uint256) view returns (uint256)",
  "function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getTroveStatus(address) view returns (uint8)",
  "function getTroveColl(address) view returns (uint256)",
  "function getTroveDebt(address) view returns (uint256)",
]);

export const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);

export const hintHelpersAbi = parseAbi([
  "function getApproxHint(uint256,uint256,uint256) view returns (address,uint256,uint256)",
]);

export const bosAbi = parseAbi([
  "function getNonce(address) view returns (uint256)",
  "function eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
