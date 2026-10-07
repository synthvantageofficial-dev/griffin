# CLAUDE.md — Project Master Plan

> **Name:** Owna (an "invest where you shop" app for India) — chosen 2026-10-02; verify domain/handle/trademark before heavy use. Brand look (from landing page): blue #2589D2, pink #DB406C, dark #121516, Metropolis font (Grifin-style, per founder's request).
> **One-liner:** Jab bhi user kisi **publicly-listed company** par kharch karta hai, hum us kharch ka ek chhota hissa jama karte hain, aur jaise hi us company ke **1 poore share** jitna paisa jama ho jaata hai, uske liye **usi company ka 1 share automatically execute** kar dete hain. (India-adapted "Grifin" model.)
> **Last updated:** 2026-10-02

This file is the single source of truth for the project. Read it fully at the start of every session before writing code. Keep it updated as decisions are made.

---

## 0. Golden Rules (NON-NEGOTIABLE — a coding agent MUST respect these)

These are legal/financial guardrails. Violating any of these can make the product illegal or unsafe.

1. **Execution-only. NEVER give investment advice.** The app must never recommend, rank, rate, or suggest which stock to buy/sell/hold. The user sets ONE standing rule up-front ("invest in the brands I shop at"); we only execute that rule. No "top picks", no "buy this instead", no tips. (Advice = SEBI RIA license required → we avoid it entirely.)
2. **We NEVER hold customer money ourselves.** All client funds sit with the SEBI-registered **partner broker** (in their nodal accounts) or in the user's own name (e.g., a liquid fund). We are a tech/UX layer on top. No pooling of user money in our accounts.
3. **We do NOT get our own broker license** (needs ₹5–50 cr net worth). We operate as an **Authorized Person (AP)** / distribution partner of a SEBI-registered broker, and use the broker's API + KYC + custody.
4. **The user, not us, chooses the target.** The stock bought is ALWAYS the listed company the user shopped at (deterministic mapping). We never substitute or "pick" a different stock. This is what keeps us execution-only.
5. **All money math in integer paise.** Never use floating point for money. Store amounts as integers (paise). Financial writes must be **idempotent** (use idempotency keys) and auditable.
6. **India-hosted data + DPDP consent.** All financial/personal data stored on India-hosted infra (RBI mandate). Separate, explicit consent for KYC, transaction-data access, and marketing (DPDP Act, 2023).
7. **No fraud, full transparency.** Every rupee accumulated, parked, and invested must be visible to the user with a clear audit trail.

---

## 1. The Core Model (how it works, step by step)

1. **Onboarding + KYC** — user signs up; KYC done via partner broker's flow (CKYC / DigiLocker). A demat + trading account is opened for the user with the partner broker.
2. **Consent + Rule setup** — user gives a one-time standing instruction: "round up my spending and invest in the brands I buy from," plus a UPI AutoPay mandate for debits. Separate DPDP consents captured.
3. **Purchase detection** — we detect the user's spends at listed companies (see §5 for the strategy — this is the hardest technical piece).
4. **Round-up / set-aside** — for each qualifying purchase we compute a small set-aside amount (e.g., round up to nearest ₹10/₹50, or a fixed ₹10–₹20 per purchase; user-configurable).
5. **Merchant → Listed company mapping** — the merchant is mapped to its listed parent company + NSE/BSE symbol (see §6). If merchant is not listed / not mappable → handle gracefully (skip, or a user-chosen fallback like a Nifty ETF — user decides once, not us).
6. **Accumulation (parked)** — set-aside money is debited (weekly batch via UPI AutoPay) and **parked in a liquid/overnight fund in the user's name**, tracked per-company in an accumulation ledger. (User earns ~6–7%; we earn trail commission — see §4.)
7. **Threshold hit → auto-execute** — when a company's accumulated balance ≥ live price of 1 share, we redeem that amount and place a **market buy order for 1 share of that exact company** via the broker API. Share lands in the user's demat.
8. **Portfolio + progress** — user sees holdings, and a progress bar per brand ("Reliance share: 62% filled 🎯").

**Future switch:** When SEBI legalizes fractional shares (see §3), we drop the "accumulate then buy whole share" bridge and invest the exact round-up instantly as a fractional share — becoming the pure Grifin model. Architecture must make this swap easy (isolate the "investment execution" module).

---

## 2. Regulatory Framework (the rails we run on)

| Concern | Reality | Our approach |
|---|---|---|
| Own broker license | Needs ₹5–50 cr net worth | ❌ No. Operate as **Authorized Person (AP)** under a SEBI broker (SEBI scrapped "sub-broker" in 2018; all are APs now). Low barrier: PAN/Aadhaar + security deposit. |
| Holding client funds | Must sit with broker in nodal accounts (SEBI upstreaming rules) | Funds stay with broker / in user-name liquid fund. We never pool. |
| Investment advice | Any recommendation → SEBI RIA license | **Execution-only, user-directed.** No recommendations anywhere. |
| Fractional shares | Not allowed for regular trading yet; SEBI **Innovation Sandbox pilot** live (Xaults, Jul 2025), depository-level custody model | Use **accumulate-then-buy-whole-share** bridge now; switch to fractional when legal. |
| Distributing liquid funds | Needs AMFI **ARN** (MF distributor) | Get ARN (or tie up with an MF distribution partner) to park idle money + earn trail. |
| Data privacy | **DPDP Act 2023**; rules notified Nov 2025; compliance deadline **13 May 2027**; penalties up to ₹250 cr | Consent-first design; India-hosted data; separate consents. |
| Auto-debit | UPI AutoPay mandate (recurring ≤ ₹15,000 without per-txn OTP) | Set up via payment aggregator (Razorpay/Cashfree). |

**Entity:** Incorporate a Pvt Ltd. Get legal counsel to paper the execution-only structure, AP agreement, T&Cs, and DPDP consent framework before launch.

---

## 3. Market Context (why this is worth building)

- **22 crore demat accounts** (Jan 2026), 23 crore (Jun 2026); **~75% of new accounts are under-30.** Young, digital, small-ticket investors at scale.
- **Proof the model works:** Jar (round-up → digital gold) = 4 cr+ users, $66M raised, free-to-user (earns from provider). Deciml (round-up → mutual funds) validates round-up in India.
- **White space:** NO Indian app buys the actual stock of the brand you shop at. That "own what you shop" hook is our unique differentiator.
- **Tailwind:** fractional-share legalization is in motion → we're positioned to ride it.

---

## 4. Monetization (Jar-style: free to user, earn indirectly)

**No mandatory subscription** (Indians resist it; flat fees crush small accounts — the Acorns/Stash mistake).

**Phase 1 (launch):**
- **AP revenue-share:** partner broker shares a % of brokerage/charges generated by our users' trades.
- **Float / trail commission:** the "waiting to be invested" money is parked in liquid funds; we earn MF **trail commission (~0.1–1.5% of AUM/yr)**. Scales hard: 10L users × ₹1,000 parked = ₹100 cr AUM → ~₹50L/yr at 0.5%. User also earns ~7% — win-win.

**Phase 2 (scale — the big money):**
- **Brand partnerships (unique moat):** listed brands pay us to sponsor "boosted stock-ups" (e.g., "shop at Amazon → get ₹10 extra Amazon stock, funded by the brand"). Turning shoppers into shareholders drives loyalty — brands pay from marketing budgets. Like CashKaro/CRED but with real equity.
- **Card interchange:** launch a co-branded card (bank partner) → ~0.5–1% interchange per swipe **and** it solves purchase-detection (we see every transaction on our own card).

**Always (optional, not a paywall):**
- **Premium a-la-carte:** bigger round-ups, insights, tax reports, family accounts.

---

## 5. Purchase Detection Strategy (the hardest problem)

We must know when the user spends at a listed company. Options, ranked:

1. **Account Aggregator (AA) framework** — RBI consent-based financial data sharing (450+ FIs, 17 AAs). Good, compliant, but **not truly real-time** (statement/periodic pulls). Fine for a batch round-up model. **→ Primary for MVP.**
2. **Own co-branded card (Phase 4)** — perfect real-time visibility on every swipe. Best long-term. Requires bank/card partner.
3. **SMS reading** — Deciml's approach, but **Google Play heavily restricts SMS/Call-Log permissions**. ❌ Avoid as primary (fragile, policy risk).
4. **UPI transaction data / PA webhooks** — explore partnerships for richer real-time data.

**MVP decision:** AA-based periodic pull → compute round-ups on fetched transactions → weekly batch debit via UPI AutoPay. Design the detection layer as a pluggable interface so we can add card/real-time sources later without rewrites.

**Online vs offline vs cash (important):** Detection is at the **bank/card/UPI layer, NOT the store**. So **both online AND offline digital payments** (UPI/card) are captured identically — offline is NOT a special case. The ONLY blind spot is **cash** payments (invisible to us → no round-up). A manual "add a purchase" option may be added post-MVP, but cash is out of scope for Phase 1.

---

## 6. Merchant → Listed Company Mapping + Eligibility Decision Tree

> **CORE PRINCIPLE — we invest in the SELLER you pay, not the products in the basket.**
> Payment feeds (UPI/card/bank) only ever reveal the **merchant who received the money** —
> never the individual product brands bought. So "the brand" in our model = the seller/outlet
> you transacted with (if listed), exactly like Grifin's "stock where you **shop**".
> - Pay at a DMart till → you own **DMart** (not the HUL/ITC products on its shelves).
> - Pay a local kirana via personal QR → merchant = the shop owner (unlisted) → **fallback ETF**
>   (even if you bought a listed product like Coke inside — that is invisible to us, by design).
> - Therefore the mapping must list **sellers / outlets / apps / direct subscriptions**, NOT
>   product-maker brands (Maggi, Dove, Surf…) — those never appear as a merchant.
> - Cards carry MCC + a cleaner merchant name; a co-branded card (Phase 4) is the cleanest source.

- Build a **mapping engine**: merchant name/MCC/UPI VPA → listed entity → NSE/BSE symbol.
- Start curated: **top ~200 listed consumer-facing brands** in India (Reliance/retail, Tata brands, HUL, ITC, Titan, DMart/Avenue Supermarts, Zomato, Nykaa, Paytm, etc.).
- Fuzzy matching + manual override table; log unmapped merchants to expand coverage.
- **Expensive-share UX:** some shares are cheap (₹50–500), some huge (MRF ₹1L+, TCS ~₹4k). Show a progress bar; for very expensive targets, warn the user at setup and let them opt for the fallback for those. Never silently trap money.

### Eligibility decision tree (run per detected DIGITAL purchase) — FINAL

For each detected purchase (cash is never detected — see §5). Online vs offline makes NO difference. There is **no "skip"** — every qualifying round-up is always invested somewhere.

1. **Is there a LISTED INDIAN entity for this merchant?** (direct India listing, OR the listed Indian operator/franchisee/JV partner that runs the brand here) → **invest in that Indian stock** (core accumulate-then-buy-whole-share model). ✅
   - Key insight: many "foreign" brands are run by a **listed Indian operator** — map to that:
     | Brand | Listed Indian entity |
     |---|---|
     | Domino's / Popeyes / Dunkin' | Jubilant FoodWorks |
     | McDonald's (West & South) | Westlife Foodworld |
     | KFC / Pizza Hut / Taco Bell | Devyani International / Sapphire Foods |
     | Starbucks | Tata Consumer (Tata-Starbucks JV) |
2. **Else, is the brand listed ONLY abroad** (US etc.) with NO listed Indian entity — e.g., Amazon, Apple, Netflix, Nike? → invest in the **actual foreign stock via the "INDmoney-style" US route** (LRS + a US-investing **infrastructure partner** — NOT the INDmoney consumer app itself; likely a US broker / GIFT-City–IFSCA / DriveWealth-type provider). US fractional shares are legal, so no whole-share wait, BUT remittances must be **batched** (LRS paperwork, forex cost, 20% TCS above ₹10L/yr → tiny per-txn remittances are uneconomical). **Implementation deferred to Phase 2**; until Phase 2 ships, these purchases route to the fallback (step 3).
3. **Else, NOT listed anywhere** (local/private brand, or an international brand unlisted everywhere) → **Fallback**: invest the set-aside money into a **single, broad India index ETF** (e.g., a Nifty 50 ETF), bought via the **same broker demat rails** as stock buys (one integration, cleanest).
   - **Execution-only safeguard:** the fallback vehicle is **chosen by the user ONCE at onboarding** (from a short pre-defined list) and disclosed/consented in the T&Cs. We never pick it dynamically per-transaction. Use ONE unified India-index fallback for all unlisted cases (national or international) — do not branch into "international index".

The target is always **deterministic** from this tree + the user's pre-set fallback choice. We never rank, recommend, or substitute — this preserves Golden Rules #1 and #4.

---

## 7. Architecture & Tech Stack

**Guiding principle:** compliance-first, money-safe, India-hosted, modular (so we can swap detection sources and switch to fractional later).

- **Mobile app:** **React Native** (largest India talent pool, ~40–70% cheaper hiring, production-tested libs: react-native-razorpay, biometrics). (Flutter is an alternative for heavier chart animation — revisit if charts get demanding.)
- **Backend:** **Node.js + TypeScript** for the core API/orchestration (fast to build, good for real-time/webhooks). Consider **Go** for high-throughput services later. Polyglot only when justified.
- **DB:** **PostgreSQL** (transactional integrity for money) — India-hosted. Redis for queues/caching.
  - **Dev/hosting decision:** using **Supabase** (managed Postgres) — provision in the **Mumbai region (`ap-south-1`)** to satisfy the India-hosted rule even in dev. Backend connects via `DATABASE_URL` using the `pg` client; we own our schema via SQL migrations (Supabase is just the Postgres host, not used as a client-side BaaS). Local Postgres install was blocked (EDB 403 via winget); Supabase also matches the founder's existing workflow. **STATUS: LIVE** — project `investing-app` (`cvvlarhtcukcgcedojie`, ap-south-1), `DATABASE_URL` wired in `backend/.env` (session pooler), `PgStore` persists the core loop (verified end-to-end).
- **Infra:** India region (AWS Mumbai / equivalent). IaC, audit logging, encryption at rest + in transit.
- **Key integrations:**
  - **Broker API** — shortlist: **Angel One SmartAPI (free), Dhan, Upstox, Fyers, Shoonya (free)**, Zerodha Kite Connect (₹2000/mo). Pick based on AP partnership terms + multi-user order flow support + market-data licensing.
  - **Payment aggregator** — **Razorpay** or **Cashfree** for UPI AutoPay mandates + recurring debit + webhooks.
  - **Account Aggregator** — an AA + FIU setup (e.g., Setu/Finvu/CAMSFinserv) for consented transaction data.
  - **KYC** — via broker's flow / CKYC / DigiLocker.
  - **MF/liquid fund** — AMFI ARN or distribution partner (e.g., a platform that lets us park in liquid/overnight funds).

**Money-safety rules for code:** integer paise everywhere; idempotency keys on all financial writes; double-entry style ledger; reconciliation jobs; never trust client for amounts.

---

## 8. Data Model (initial sketch)

- `users` — profile, status.
- `consents` — type (kyc / txn_data / marketing), granted_at, revoked_at, version. (DPDP)
- `linked_accounts` — AA-linked bank/UPI sources.
- `broker_accounts` — partner broker demat/trading account refs.
- `mandates` — UPI AutoPay mandate refs, limits, status.
- `transactions` — detected spends (merchant, amount_paise, ts, source).
- `merchant_company_map` — merchant → company → symbol, confidence, override.
- `roundups` — per transaction, amount_paise, rule applied.
- `accumulation_ledger` — per (user, company): balance_paise, parked_fund_ref. Double-entry.
- `orders` — broker order refs, symbol, qty, status, idempotency_key.
- `holdings` — user's shares per company.
- `events` / `audit_log` — full immutable trail.

---

## 9. Development Roadmap (phased)

### Phase 0 — Foundations (legal + partnerships) [do first, in parallel with prototyping]
- [ ] Incorporate Pvt Ltd; engage fintech legal counsel.
- [ ] Sign **broker AP partnership** (evaluate Angel One SmartAPI / Dhan / Upstox).
- [ ] Set up **payment aggregator** (Razorpay/Cashfree) UPI AutoPay.
- [ ] Set up **Account Aggregator** (FIU) integration path.
- [ ] Get **AMFI ARN** (or MF distribution partner) for liquid-fund parking.
- [ ] Draft execution-only T&Cs + DPDP consent framework.

### Phase 1 — MVP (the core loop)
- [ ] Onboarding + KYC (broker flow) + demat account opening.
- [ ] Consent capture (DPDP) + UPI AutoPay mandate setup.
- [ ] AA linkage → fetch transactions.
- [ ] Merchant→company mapping engine (top ~200 brands).
- [ ] Round-up computation + weekly batch debit.
- [ ] Accumulation ledger + park in liquid fund.
- [ ] Threshold detection → auto-buy 1 whole share via broker API (listed-India path).
- [ ] Fallback path: route unlisted-brand set-asides into the user-selected India index ETF (same broker rails).
- [ ] Portfolio + per-brand progress bars.
- [ ] Full audit trail + reconciliation.
- **Goal:** a small closed beta where the end-to-end loop works for real for a handful of top brands.

### Phase 2 — Scale & monetize
- [ ] Brand partnerships / sponsored boosted stock-ups.
- [ ] Gamification, referrals, streaks (Jar-style engagement).
- [ ] Premium a-la-carte features.
- [ ] Expand merchant mapping coverage.
- [ ] **US-fractional route** (LRS / GIFT-City partner) for brands listed only abroad (Amazon/Apple/etc.) → "shop at Amazon → own Amazon (US)".

### Phase 3 — Fractional shares
- [ ] Integrate fractional execution when SEBI legalizes (depository-level); swap out the whole-share bridge for instant fractional. (Isolated execution module makes this a drop-in.)

### Phase 4 — Card
- [ ] Co-branded card (bank partner) → interchange revenue + real-time detection.

---

## 10. Key Risks & Open Decisions

**Risks to watch:**
- Thin unit economics on tiny trades (statutory charges — STT, stamp duty, exchange, DP — hit small trades hard). Batching + float income must offset.
- Regulatory tightening (SEBI increased digital-platform scrutiny in 2026).
- Purchase-detection latency/coverage until we have a card.
- Retention (micro-investing apps live/die on engagement).

**Open decisions (to finalize):**
- [x] Product **name**: **Owna** (chosen 2026-10-02). Landing page built at `landing/index.html` (Grifin-style), waitlist → Supabase `waitlist` table.
- [ ] Which **broker** partner (depends on AP terms + API + willingness for this novel flow).
- [ ] Round-up rule default (round-to-nearest vs fixed per-purchase).
- [x] Fallback rule **finalized**: NO skip — always invest. Unlisted (national or international) → user-selected broad **India index ETF** (chosen once at onboarding, consented in T&Cs), bought via broker demat rails. (Still to pick: which exact ETF options to offer.)
- [x] Cash purchases: out of scope for Phase 1 (confirmed). Manual "add purchase" — post-MVP maybe.
- [x] International brands **finalized**: (1) listed Indian operator → buy that Indian stock; (2) abroad-only listed → INDmoney-style US route (Phase 2); (3) unlisted anywhere → India-index fallback.
- [ ] Which exact **US-investing infra partner** for the abroad-only route (Phase 2).
- [x] India-only scope confirmed ✅.

---

## 11. Glossary

- **AP (Authorized Person):** SEBI category (post-2018, replaced sub-broker) — a partner who onboards clients under a broker and shares revenue.
- **AA (Account Aggregator):** RBI consent-based financial data-sharing framework.
- **RIA:** SEBI Registered Investment Adviser (needed to give advice — we avoid).
- **ARN:** AMFI Registration Number (to distribute mutual funds).
- **DPDP:** Digital Personal Data Protection Act, 2023.
- **Nodal account:** broker's segregated client-fund bank account.
- **Trail commission:** ongoing % of AUM paid by AMC to MF distributor.
- **LRS:** Liberalised Remittance Scheme (for US-stock route — not used in the core India model).

---

## 12. Reference Companies

- **Grifin (US):** the inspiration. "Stock where you shop." $22M raised, 5L+ users. Accumulates weekly, then invests. Fractional-based.
- **Jar (India):** round-up → digital gold. 4 cr+ users, $66M raised. Free-to-user monetization model to emulate.
- **Deciml (India):** round-up → mutual funds. Validates round-up in India.
- **Xaults (India):** in SEBI's fractional-share sandbox — watch for the fractional-shares unlock.

---

## 13. Build Status / Progress Log (UPDATE THIS AFTER EVERY PIECE)

**Backend (code) — DONE & tested:**
- [x] Scaffold — Fastify + TypeScript (strict) + integer-paise money lib + `/health`
- [x] Supabase project (`investing-app`, ap-south-1) + schema — migrations 0001–0004
- [x] Accumulation engine — round-up, deterministic routing, ledger, whole-share execution, progress %
- [x] Merchant → company mapping — sellers/outlets only (Zomato→ETERNAL, McDonald's→WESTLIFE…)
- [x] Mock price feed — `PriceProvider` interface + `MockPriceProvider`
- [x] Simulation + demo — `npm run demo`
- [x] REST API — `POST /users`, `GET /users/:id`, `POST /users/:id/transactions`, `GET .../portfolio` + zod + idempotency
- [x] **Persistence** — `PgStore` on Supabase Postgres (`DATABASE_URL` in `backend/.env`). LIVE, verified end-to-end.
- [x] **Unmapped-merchant logging** — unknown sellers recorded with hit counts (migration 0005, `GET /admin/unmapped-merchants`), verified live. Store is now dependency-injected into `buildServer` so tests use in-memory (fast/isolated).

- [x] **Batch sweep job** — `store.runSweep()` re-checks every balance vs current price and buys whole shares now coverable (handles price drops / weekly-invest). `POST /admin/run-sweep`, atomic in PgStore, verified live. NOTE: still needs wiring to an actual scheduler (cron/queue) at deploy time.

**Group A — remaining (pure software, no partnership needed) — do ONE BY ONE:**
- [ ] Auth / login (real users + sessions; currently just a userId)
- [ ] Consent records (DPDP) + user rule management endpoints
- [ ] Reconciliation + audit surfacing

**Then (later, after Group A):** Mobile app (React Native) · External integrations (broker API, Account Aggregator, UPI AutoPay, KYC, liquid-fund) · Business/legal/ops.

**Ops pending (small, one-time):** GitHub push (`gh` installed, not logged in) · landing page live deploy.

_Last build update: 2026-10-07 · 49 tests passing._
