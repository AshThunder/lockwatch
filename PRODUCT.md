# Product

<!-- impeccable:product-schema 1 -->

> Interview substitution: the build ran as a delegated subagent with no answer channel. Facts below come from the repo, README, SECURITY.md and Chris's chat brief. Items marked (inferred) were not confirmed by him.

## Platform

web

## Users
- **veBTC holders on Mezo.** People who locked BTC into veBTC (max ~4-week locks, all ending Thursday 00:00 UTC) to vote on gauges and earn incentives. Their job: keep their BTC working. Every lock ends on a Thursday, and a lock nobody claims leaves BTC idle: earning nothing, voting for nothing, and unprotected until the owner comes back. They check in weekly, often on a phone, around the Thursday boundary.
- **MUSD borrowers.** People with a trove (BTC-collateralised MUSD loan). Their job: know where they stand in the redemption line and what moves them back before someone redeems against them.
- **Hackathon judges (Mezo Wave 1, Akindo).** Evaluate in minutes: is the problem real, does it work on testnet, is it safe, is it distinct from Matchbox and TrovePilot. (Audience confirmed by Chris.)

## Product Purpose
Lockwatch watches every veBTC lock and MUSD loan on Mezo. It alerts owners (Telegram and email) at 7 days, 24 hours and expiry; and with one per-lock approval it auto-protects a lock: at expiry a permissionless keeper clears votes, withdraws, and sends the BTC back to the owner, re-locks it in their name, or opens an MUSD loan in their name. Success: no protected lock ever sits idle; judges see live testnet proof.

## Positioning
The only product on Mezo that acts at the moment a veBTC lock ends. The vault has no admin, no upgrade path, no withdraw function and no trusted-forwarder path, and can only send funds, new locks or loans to the lock owner. Redemption Radar is borrower-side, unlike TrovePilot, which serves redeemers. No gauge-vote optimizer (Matchbox owns that).

## Proof and facts (live testnet)
- LockwatchVault `0xD7160697f3ACd0191e65bcccaAFeaa0913D21999` on Mezo testnet (31611), source verified.
- ~286 of ~380 indexed locks expired and unclaimed, ~873.6 BTC; one outlier lock (#100) holds ~868 BTC unclaimed for ~350 days. Always show the outlier separately.
- Keeper runs every 5 min, every 30 s around Thursday. Voted locks can only be cleared from 01:00 UTC (02:00 WAT).
- Tests: Foundry unit/fuzz/invariant/gas-griefing plus fork tests against real testnet contracts.

## Brand commitments
- Name: Lockwatch. Mark: a split-flap tile whose top half is a lock shackle, with an orange bar (v2).
- Bitcoin orange (#F7931A) belongs to the subject; usage open.
- Wallet connection is the standard RainbowKit modal with Mezo Passport Bitcoin wallets (Chris's explicit preference).
- No emoji, no generic AI gradients, no cookie-cutter cards (Chris). It must not look "vibe coded".
- Reference bar named by Chris: Linear, Stripe, Uniswap, Aave, Morpho, Pendle, Phantom.

## Voice
Plain, exact, calm. Says where the BTC goes and when, in the user's timezone. Never hype, never fear-mongering beyond the facts.

## Accessibility
WCAG 2.2 AA; full keyboard paths; prefers-reduced-motion respected.

## Narrative rule (Chris, Oct 15)
Lead positive: veBTC locks end every Thursday, holders forget, BTC sits idle and unprotected; Lockwatch keeps it working and safe automatically (alerts, auto-claim, re-lock, MUSD). The Oct 5 incident may be mentioned at most once, briefly and neutrally (one FAQ answer or security note), never in a hero, headline, meta or OG text. The Mezo team are the judges.
