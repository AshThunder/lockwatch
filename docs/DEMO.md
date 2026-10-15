# Demo script (~3 min walkthrough)
Record Wednesday night (WAT). Lock ends round to Thursday 00:00 UTC = 01:00 WAT.
1. **00:50 WAT** — Landing: live "BTC at risk" counter; At-risk map (largest locks, age buckets).
2. Create a 0.03 BTC lock on testnet (ends 01:00 WAT). Dashboard shows it red with a minutes countdown.
3. Protect → "Open an MUSD loan" (2,000+ MUSD, ≥150%) → Approve → Sign → Enable. (Don't vote with this lock, or the keeper must wait until 02:00 WAT.)
4. Telegram: T-1d / expiry alerts arrive (link via /alerts first).
5. **01:00 WAT** — countdown hits zero; keeper burst (30 s cadence) calls `protectBatch` → `Protected` event; trove opened in your name; Telegram "✅ Protected" with explorer link.
6. Radar: paste your address → place in line, MUSD ahead, redemption simulator, "move back" suggestions.
Backup: `pnpm test:fork` shows the same flow against real testnet contracts.
