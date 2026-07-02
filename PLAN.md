# Investment/Forex Platform — Portfolio Demo Site Plan

## Context

This is a **portfolio/demo build** (confirmed with the user — not a licensed
financial entity), meant to showcase a polished, "global forex standard"
investment brand: a marketing frontend plus a real-time customer portal
backend. Because platforms that solicit public deposits into pooled
investment products are heavily regulated (securities/broker-dealer/money
transmitter law) in virtually every jurisdiction, this plan treats the site
as a **simulation**: no real payment rails, no real custody of funds, no
real investment offering. Every page must make this clear via a footer/legal
disclaimer ("Demo platform for portfolio purposes. Not a real investment
offering. No real funds are processed."). This protects the user from
having a live-looking, unlicensed solicitation site mistaken for the real
thing, while still delivering the full designed experience they asked for.

The deliverable is this **spec document** — detailed enough to hand to
Fable to build end-to-end without further clarification.

## Brand & Frontend (Marketing Site)

Working name: placeholder **"Meridian Capital"** (swap freely) — global,
neutral, trustworthy. Visual language: dark navy/charcoal base with a single
confident accent (gold or emerald), high-contrast data visualizations,
large serif/sans display type for headlines, generous whitespace — the
"global forex broker" aesthetic (think the polish of large FX/CFD brokers'
marketing sites).

Pages:
1. **Home** — hero with animated market ticker (mock FX/stock rates),
   value props (security, regulation-style badges, 4-pool diversification),
   trust bar (mock "regulated/audited" badges — clearly labeled as
   illustrative), performance snapshot chart, CTA to open account.
2. **How It Works** — deposit → allocate across 4 pools → 3-year lock →
   real-time tracking → maturity payout, shown as a 4-step visual flow.
3. **Investment Pools** (4 dedicated sections/pages) — Stocks, Forex, Real
   Estate, IT Business. Each: description, simulated historical performance
   chart, risk profile, illustrative target return range.
4. **Security & Trust** — explains simulated security posture (2FA, encryption
   messaging, cold-storage-style copy, KYC/AML messaging) — framed as design
   showcase, not a real compliance claim.
5. **Pricing/Terms** — $1,200 minimum deposit, 3-year lock, early-withdrawal
   penalty schedule (mock), fee structure.
6. **About / Legal / Contact** — includes the demo disclaimer prominently.
7. **Login / Register** — entry to the customer portal.

## Customer Portal (Backend, Core Investor Dashboard scope)

Authenticated area, simulated data only:

- **Onboarding**: register → mock KYC form (ID upload UI + personal info,
  stored but not verified against any real ID service) → account approved
  automatically for demo purposes.
- **Deposit flow**: choose pool(s) or split across all 4, enter amount
  (min $1,200 total), mock payment method selection (card/bank/crypto UI),
  simulated "processing" state → funds credited instantly to a virtual
  balance. No real processor integration.
- **Portfolio dashboard**: real-time (client-side simulated ticking)
  portfolio value across the 4 pools, allocation breakdown (donut chart),
  performance line chart per pool and combined, next unlock date countdown
  (3 years from deposit date), transaction history table.
- **Simulated performance engine**: a backend job/function that generates
  realistic fluctuating daily returns per pool (different volatility/drift
  per pool — e.g. Forex more volatile/higher frequency swings, Real Estate
  slow/steady, Stocks moderate, IT Business growth-oriented with occasional
  jumps) and appends to a time-series table per user-position. Portfolio
  values are computed from this series, not hardcoded.
- **Withdrawals**: request flow that checks the 3-year lock date; before
  maturity shows early-withdrawal penalty terms and requires explicit
  confirmation (still simulated, no real payout); after maturity, funds
  become withdrawable.
- **Security/account settings**: password change, 2FA toggle (mock/TOTP UI),
  login/session activity log, active sessions list.

## Data Model (sketch)

- `users` (id, email, password_hash, kyc_status, created_at)
- `kyc_submissions` (user_id, name, dob, address, id_doc_ref, status)
- `pools` (id, name, description, risk_profile, volatility_params)
- `positions` (id, user_id, pool_id, principal_amount, deposited_at,
  lock_end_at)
- `performance_ticks` (position_id, timestamp, value) — generated series
  driving the live dashboard
- `transactions` (id, user_id, type[deposit/withdrawal_request/withdrawal],
  amount, status, created_at)
- `sessions` / `audit_log` (user_id, event, ip, user_agent, created_at) —
  for the "security & trust" activity log feature

## Security Posture (of the demo build itself)

Even though funds are simulated, build real web-app security hygiene so the
demo isn't itself vulnerable: hashed passwords (bcrypt/argon2), CSRF
protection, rate-limited auth endpoints, input validation/sanitization on
all forms, parameterized queries (no SQL injection surface), secure
session cookies (httpOnly/secure/sameSite), no sensitive data in
client-side storage, HTTPS-only assumptions documented for deployment.

## Tech Stack

Left stack-agnostic per the user's choice — Fable should pick its
optimized stack. The spec above (pages, data model, flows) is the
implementation-agnostic contract Fable should satisfy.

## Verification

Once built: register a test account → complete mock KYC → deposit $1,200+
split across pools → confirm dashboard shows live-updating values sourced
from the performance-tick series (not static) → attempt early withdrawal
(should show penalty/lock warning) → check all legal/disclaimer text is
present on every page.
