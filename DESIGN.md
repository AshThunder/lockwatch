# Lockwatch — Design System

## Direction
**Solari departures board.** Every veBTC lock departs Thursday 00:00 UTC; Lockwatch is the departures board for your BTC. Dark station-hall ground, paper-white type, Bitcoin orange reserved for "your BTC / act now". Dense, tabular, time-first. Every lock is an addressable page (`#id` search, `/lock/[id]`), borrowed from teletext.

## Tokens
| Token | Hex | Use |
|---|---|---|
| ground | #0E1012 | page |
| panel | #14171A | surfaces |
| flap | #1B1F23 | flap tiles, table zebra |
| raised | #22272C | hover / popovers |
| line / hair | #2C3238 / #1E2226 | borders, dividers |
| paper | #F1EEE6 | primary text |
| mute / faint | #A9ADAB / #82888C | secondary / tertiary text |
| btc / btc-hi / btc-ink | #F7931A / #FFA53D / #1A0F02 | primary action, own BTC |
| signal | #F2C14E | boarding / upcoming |
| ok / bad | #62C68E / #F2705F | protected / idle-expired |

## Type
- Display: Big Shoulders Display, uppercase, tight leading (headings, board labels). Use `<span class="normal-case">ve</span>BTC` inside caps.
- Body: Hanken Grotesk.
- Figures: JetBrains Mono, tabular numerals (`.num`), for all amounts, ids, times.

## Components
Logo (flap tile + shackle + orange bar), Icon set + Spinner, Flap / FlapCountdown (GSAP flip), Ticker, Countdown, ExpiryBar, StatusPill (boarding / idle / expired / voted / protected), Stat, PageHead (crumb), Skeleton, State/Empty, Pager, CopyButton, ExplorerLink/LockLink, GlobalSearch (`/` or ⌘K, hero/big variants), AppShell (sidebar + mobile bottom tabs + NetworkBadge), SiteNav/SiteFooter, ToastProvider, useTx transaction dialog (approve → confirm → done), `.tbl` data tables, `.btn` variants, `.field`.

## Motion
GSAP via `useGSAP` + `gsap.matchMedia`. Flap flips on digit change, staggered reveals with ScrollTrigger.batch on the landing. All motion is disabled under `prefers-reduced-motion`. State is always shown without motion (motion only decorates).

## Layout and responsiveness
12-col max-w-6xl marketing; app shell 240px sidebar ≥lg, bottom tabs below. Tables drop low-priority columns on mobile. Touch targets ≥44px.

## Borrowed patterns
Morpho/Aave: market tables with dense numbers. Pendle: time-to-maturity as the main axis. Linear: keyboard-first command search and a quiet sidebar. Stripe: spec-sheet security section. Uniswap: one primary action per view. Mezo: BTC orange on near-black, testnet badge.

## Bans
No emoji, no decorative gradients, no generic icon-card grids, and no fear-led copy (the Oct 5 incident appears once, neutrally, in the FAQ).
