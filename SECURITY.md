# Security

LockwatchVault is non-custodial by construction. Report issues privately via GitHub security advisories.

## Guarantees (each enforced by a test)
| # | Guarantee | Test |
|---|---|---|
| 1 | Vault ends every tx holding 0 BTC / MUSD / sMUSD | `invariant_vaultHoldsNothing` |
| 2 | Funds, new locks and troves only reach `prefs[id].owner == veBTC.ownerOf(id)` at protect time | `invariant_onlyOwnerPaid`, `test_revert_staleOwnerAfterTransfer` |
| 3 | No owner/admin/upgrade/selfdestruct/arbitrary call/`to` param | code review (≈270 lines) |
| 4 | Never trusts Mezo's ERC-2771 forwarder — plain `msg.sender` only | no `_msgSender` in source |
| 5 | Stale prefs (NFT transferred) can't execute | `test_revert_staleOwnerAfterTransfer`, `test_newOwner_canOverwrite` |
| 6 | Reentrancy guard (storage-based; london has no transient storage); `receive()` only open mid-protect | `test_receive_rejectsDirectBtc` |
| 7 | Any failing mode step falls back to returning BTC to the owner | `test_*_fallsBack*` |
| 8 | A keeper can't downgrade the owner's mode by starving the inner call of gas (EIP-150 1/64 trick) | `test_gasGriefing_neverForcesFallback` |
| 9 | BTC conserved across random register/transfer/vote/warp/protect sequences | `invariant_btcConserved` |

## Oct 5 2026 Mezo exploit context
The attacker spoofed `_msgSender()` via the MezoForwarder calldata suffix on expired locks. Lockwatch never uses the forwarder, and Lockwatch's API signs users in with SIWE (EIP-4361) only.

## Known limitations
- MUSD modes need an EOA signature (BorrowerOperationsSignatures uses `ECDSA.recover`, no ERC-1271), so Mezo Passport Bitcoin-wallet smart accounts can use RETURN/RELOCK only.
- The OpenTrove signature fixes collateral (= lock amount), debt and deadline; a later signed MUSD action by the user consumes the nonce → protect falls back to RETURN (UI and alerts prompt a re-sign).
- Voted locks can only be reset from 01:00 UTC on the expiry Thursday (Voter distribute window), so claims for voted locks happen ≥1h after expiry.
- veBTC is an upgradeable proxy; the keeper should monitor the EIP-1967 implementation slot.

## Slither (Oct 15 2026)
10 informational results, all triaged: timestamp use (intended, epoch math), "weak PRNG" (`ts % 1 weeks` epoch math), unused `approve` return (Mezo BTC precompile / MUSD return true or revert), calls in loop (`protectBatch` try/catch by design), strict equality `amount == 0` (intended).
