# Vants: Specification (proof of concept)

2026-10-22. Every external fact used here is logged in `docs/SOURCES.md`.

**Approved: 2026-10-22** (the human approved in chat: "approved. lets start building"; recorded by the agent at the human's request)

## §0 Rules for agents

- This repository follows the agent workflow in `CLAUDE.md` at its root.
- **Stellar facts come only from the Raven MCP (`stellar-raven`)**, logged in SOURCES.md with the operation and `asOf` date.
  The same rule as Pier's DEC-005.
- **Testnet and sandbox only.** Nothing in this milestone touches Stellar mainnet, Hodle production (`api.hodle.com.br`, `hodle_live_`
  keys) or any real Pix. The human's decision of 2026-10-22: "I don't want to test production. Only sandbox."
- Anything marked `[VERIFY: …]` is checked before code depends on it. Anything in §11 blocks the tasks listed there.

## §1 Goals and non-goals

**Milestone PoC: pay a Pix BR Code with Stellar assets, end to end, on testnet and the Hodle sandbox.** It proves the two products
from the thesis on one backbone:

- **Vants Pay (the rail):** a Stellar wallet or app gets a quote for a BR Code and sends testnet USDC to Vants. Vants pays the Pix from a
  pre-funded float and notifies the integrator by webhook. This is the slot Abroad left in Brazil.
- **Vants mini app:** a user connects a Stellar wallet, sees their positions (classic balances and DeFindex vaults), picks in
  order what to liquidate (the "liquidation picker" from `earlier prototype/product.md`), signs, and the BR Code is paid. The mini app is a
  client of the rail.

### PoC checks (the PoC is done when all seven pass and are recorded in T-090)

| #  | Check | How it is tested |
|----|-------|------------------|
| D1 | An integrator pays a BR Code from testnet USDC through the API | Script: quote → accept → USDC payment to the deposit address → `payment.completed` webhook received. Records deposit ledger close → payout `COMPLETED` time |
| D2 | A wallet user pays a BR Code from their positions in the mini app | Freighter or xBull on testnet: connect, see classic + DeFindex positions, pick USDC then a vault, sign, receive a receipt. Scan → paid timed |
| D3 | Crashes lose nothing and pay nothing twice | Kill `api` and `worker` at each saga step (scripted), restart: every funded payment ends `COMPLETED` or `REFUNDED`, exactly one Hodle payout per payment |
| D4 | Forged and duplicate external events change nothing | Replay every Hodle and Pier webhook twice and send forged ones: duplicates are no-ops, forgeries get 401 and no state change |
| D5 | Bad deposits are refunded | Underpaid, late (after the quote expired), unknown muxed id, and wrong asset: each refunded to the sender within 60 s, tagged with the payment id |
| D6 | The float refills itself without blocking payments | Push the float below its minimum: the refill saga runs (testnet CCTP burn → Base Sepolia mint, then the float credited: confirmed by Hodle's `DEPOSIT_ASSET_SUCCESS` webhook once registered, by a balance poll until then, §11 Q1) while payments continue |
| D7 | The books balance | Ledger entries sum to zero per asset. Treasury ledger = Horizon balances; float ledger = Hodle sandbox balance (`GET /api/wallet?sync=true`) |

### In scope

- Vants Pay REST API v0 (quotes, payments, integrator webhooks), with API keys per integrator.
- Destinations: a **BR Code** (static or dynamic) and a **Pix key** (third party). "My own account" is the same Pix key flow; KYC binding is out of scope (§7).
- Funding assets on testnet: the allowlisted USD assets (DEC-006).
- On-chain detection through **Pier** (payment subscription on the treasury, webhooks plus pull reconciliation).
- Payout through the **Hodle sandbox** (USDH test-wallet path), consuming Hodle **webhooks**.
- Float ledger, float health, refill saga (CCTP Stellar testnet → Base Sepolia, reusing the spike's code).
- Mini app: wallet connection (Stellar Wallets Kit), portfolio (classic balances + DeFindex vault shares), the liquidation
  picker, step-by-step signing, BR Code scanning, receipts.
- Refunds for every failed or mismatched deposit.

### Non-goals (logged for later)

Mainnet and real Pix; production KYC/KYB; SEP-6/24/31 through the Anchor Platform (M-next); SEP-45 login for contract accounts (M-next); the one-signature **exit router** contract;
Blend, Aquarius, Soroswap and Etherfuse exits (read-only display is a stretch goal); embedding inside LOBSTR (needs a partnership,
thesis §10.1); optimistic payouts before the deposit confirms (measured in the spike, off by INV-01); NEAR Intents; BRLA funding;
multiple payout providers.

## §2 Claims policy

| Claim | Allowed when | Evidence | Status |
|-------|--------------|----------|--------|
| "Proof of concept on Stellar testnet" | Always, in that exact framing | This spec | Allowed |
| "Pays Pix QR codes from Stellar assets" | D1 and D2 pass, **qualified "in sandbox (simulated Pix)"** | T-037 | README | T-036 | §2, §8 | review | A README at the root: what the PoC is (claims within §2), layout, setup, checks, deploy, license status |
| T-038 | Web deploy outside git | T-037 | §8 | done | `deploy/web.sh` stages the upload outside the repo, so Vercel gets no commit to check and does not block the production deploy |
| T-039 | Fast reads on a slow RPC | T-038 | §3.2 | done | Portfolio and invest read their chain state side by side; reads of the same thing in flight together run once; quotes kept 15 s and yields 5 min; account, shares and vault totals never kept; same positions, order and values (existing tests unchanged) |
| T-040 | Portfolio kept on the device | T-039 | §3.2, §7 | done | Home and Investir show the last portfolio and investments at once and refresh them in the background on every visit; every action (Pix paid, invest, redeem, Tesouro, money added, refund) refreshes them; saved per account, cleared on sign-out; paying and investing still check balances on the server |
| T-041 | Invest and take out, step by step | T-040 | §3.5, PRODUCT.md | done | Each option (both vaults, Tesouro) opens on an overview (what you have, the rate, how taking out works) with Investir and Resgatar as separate actions; each runs as a flow like Pagar Pix: header with steps, the amount on the keypad with quick amounts, a review (what moves from where to where, in reais too, terms, deadline, the wallet lines one tap away), then the success moment; Tesouro's first purchase adds the "receive Tesouro" step; same server calls and checks as before |
| T-042 | Clear, consistent waiting | T-041 | PRODUCT.md, §3.5 | done | One vocabulary for waiting, everywhere: content that loads shows placeholders shaped like it that visibly move (still with reduced motion) and says what is loading; a button that asks the server keeps its colour, names the work and turns; an operation with the wallet and the network shows its steps (confirm in the wallet, send, record) where they are always visible; any wait past a few seconds says it is still working and what is safe (nothing sent yet / already sent), and past half a minute says what to do; back is locked while a transaction is being sent; sign-in names each step |
| T-043 | Design refactor: directions for approval | T-042 | PRODUCT.md, §2 | done | The human sets aside the earlier design rules (palette, type, light-only, logo, photo) and asks for a production-grade look without AI tells. Three directions (two light, one dark), each showing the same four screens (Início, Revisar pagamento, Comprovante, an investment) from the same sample data, built as static mockups outside `apps/web`; planned with impeccable (shape) and checked with tasteskill v2 app rules (`inspect.mjs --app`: 0 FAIL on every mockup); the human picks a direction before any app code changes. The build follows as T-044. The human chose A (Comprovante) on 2026-11-03, without the PAGO stamp. |
| T-044 | Design system A ("Comprovante") in the app | T-043 | PRODUCT.md, DESIGN.md, §2 | done | The approved direction A replaces the earlier visual system everywhere in `apps/web`, behaviour unchanged: Archivo (self-hosted, condensed and heavy for money and titles); paper, ink and carimbo blue; a screen's answer on an ink slab (balance, rate); lists and facts as ledgers (2px ink rule, hairlines, dotted leaders), no cards; the receipt and every success as a paper slip whose top band states the status (carimbo blue when paid; the PAGO stamp of the mockups is replaced at the human's request); no glow, ring, count-up or gradient sweep; a new V-tick wordmark; Welcome on ink without a photograph. All gates pass (305 tests unchanged, contrast 0 below AA); tasteskill v2 `inspect.mjs --app` shows 0 FAIL on Início, Atividade, Investir, an investment, a receipt and Welcome. |
| T-045 | Welcome with the photograph | T-044 | PRODUCT.md, DESIGN.md | done | The human found the ink-only Welcome of T-044 empty ("a dark image is still better"). The café-counter photograph (T-031) returns, darkened (brightness 0.6, saturation 0.7) and printed edge to edge across the top with a hard edge to the ink, no gradient fade; the words, promises and wallet stay on the ink below. Its credit returns in Conta. Contrast 0 below AA; tasteskill inspect 0 FAIL (the empty-stretch warning of T-044 is gone). |
| T-046 | WalletConnect connection | T-045 | §3.5, §7, INV-07, DEC-011 | done | The human (2026-11-03): "Implement walletconnect conection". The wallet picker offers WalletConnect (Stellar Wallets Kit 2.7.1's `WalletConnectModule`, no new dependency) when the web build has `VITE_WALLETCONNECT_PROJECT_ID` (a Reown project id); without it nothing changes. Testnet only (`stellar:testnet`; the module defaults to the public network). Its code and Reown's AppKit load in their own chunks (the main bundle grows about 3 KB). A signature right after a reload waits for the WalletConnect client; a lost session is said in Portuguese. Unit tests for the parameters (off without an id, testnet only, metadata). The end-to-end flow with a phone wallet needs the human's Reown project id. |
| T-090 evidence log | Not yet |
| Any latency figure ("in N seconds") | Measured in T-090 and quoted with "sandbox" | T-090 | Not yet |
| "Non-custodial" (mini app) | The backend never holds or receives a user key (INV-09) and every user transaction is built unsigned | Code review + INV-09 test | Not yet |
| "Never pays twice", "no lost deposits" | D3 and D4 pass | T-090 | Not yet |

The words "instant", "secure", "audited", "production-ready", "guaranteed", "regulated" and "zero fees" are not allowed anywhere.
The Pix leg is simulated by the Hodle sandbox and every demo says so.

## §3 Architecture

### 3.1 Overview

**An event-driven modular monolith.** One Postgres database is both the system of record and the event backbone (transactional
outbox, inbox and pg-boss queues). It runs as two processes (`api`, `worker`) plus the mini app (`web`). External signals (Pier,
Hodle, the wallet) enter only through **ingress adapters**. Ingress verifies each signal, writes it to the inbox exactly once,
and emits a domain event. Long-running flows are **sagas** driven by those events and by timers (DEC-002).

```
        Integrator (wallet/app)              Mini app (web, Wallets Kit)
               │ REST v0                          │ BFF /app/*      ▲ wallet signs (unsigned XDR only)
               ▼                                  ▼                 │
┌──────────────────────────────── api (Fastify) ──────────────────────────────────────┐
│  /v0/quotes /v0/payments          /app/portfolio /app/exits        /ingress/pier       │
│                                                                     /ingress/hodle/:ev │
│  commands ──► domain (pure state machines) ──► Postgres tx: state + outbox event       │
└──────────────────────────────┬───────────────────────────────────────────────────────┘
                               │ outbox → pg-boss queues (same database)
┌──────────────────────────────▼──── worker (pg-boss consumers) ──────────────────────────┐
│  payment saga   exit saga   float/refill saga   refund saga   notifier   reconcilers      │
│      │              │              │                 │            │           │           │
│  hodle adapter  stellar adapter  cctp adapter   stellar adapter  webhooks  pier pull,       │
│  (payout,       (build/submit,   (burn→attest   (refund payment) (Standard  hodle balance,  │
│   deposit/settle) simulate)       →mint)                          Webhooks)  horizon         │
└──────────────────────────────────────────────────────────────────────────────────────────┘
      ▲ webhooks + pull                       ▲ webhooks (one per event)
      │                                       │
   Pier (testnet)  ◄── Stellar testnet ──►  treasury G… (USD assets)        Hodle sandbox ──► simulated Pix
   payment subscription: account=treasury, direction=in                   (USDH float on Base Sepolia)
```

### 3.2 Components

| Component | Responsibility |
|-----------|----------------|
| `apps/api` | Fastify. Vants Pay REST v0 (§5.1), mini-app BFF (§5.3), ingress endpoints (§5.4). Validates input, runs domain commands in one DB transaction, writes outbox events. Never calls Hodle or submits Stellar transactions inline, except `/app/exits/:id/steps/:n/submit`, which forwards a *user-signed* transaction (§3.5). |
| `apps/worker` | pg-boss consumers for sagas, notifier and reconcilers. The only process that calls Hodle (payout, deposit/settle), signs treasury transactions (refunds, CCTP) or calls Pier's API. |
| `apps/web` | Mini app (React, Vite). Stellar Wallets Kit for connection and signing, a BR Code scanner, the portfolio and the liquidation picker. Talks only to `/app/*`. |
| `packages/config` | Environment for `api` and `worker`, validated at startup with fixed, value-free error messages; refuses anything not testnet or sandbox (INV-07). Only `api` and `worker` may depend on it; other packages take settings as parameters (DEC-019). |
| `packages/domain` | Pure TypeScript: Payment, Exit and Float state machines, pricing, the ledger posting rules, event and command types. No I/O, so property tests run here. |
| `packages/pix` | BR Code parser and validator (CRC16, TLV, amount, key), ported from `spike/src/pix/emv.ts`. |
| `packages/adapters/*` | `hodle` (sandbox client, webhook verification), `pier` (subscriptions, pull, webhook verification via `Pier's SDK`), `stellar` (Horizon/RPC reads, unsigned tx builders, simulate, submit, treasury signer), `defindex` (vault reads, withdraw builder; spike code), `cctp` (spike code). |
| `packages/db` | Migrations, repositories, the outbox/inbox, ledger. |

### 3.3 Event backbone

- **Outbox (`Backbone.publish`).** Every state change writes its domain event(s) to `outbox` in the same transaction, and enqueues
  them with pg-boss `publish(type, envelope, { db })` in that transaction too. pg-boss fans each event type out to every queue that
  `subscribe`d to it (one queue per consumer). A rolled-back transaction publishes nothing, and no relay process is needed (DEC-017).
- **Inbox (`recordInbound` / `consumeInbox`).** Every external signal is stored once in `inbox` with a unique `(source, dedupe_key)`, and
  its `inbox.<source>` job is enqueued in the same transaction, *before* the sender gets its 2xx. A duplicate returns
  `{ duplicate: true }` and enqueues nothing. The handler locks the row, skips it if `processed_at` is set, and marks it processed in the
  same transaction as its effects.
- **Envelope (internal, v0):** `{ id (uuid), type, version, occurredAt, aggregate: { type, id }, correlationId (payment id),
  causationId (event or inbox id that caused it), payload }`. Domain code builds drafts (`EventDraft`, `@vants/domain`), and
  `publish` assigns `id` and `occurredAt`.
- **Consumers are transactional and deduplicated.** Every handler runs through pg-boss `work(…, { transactional: true })`: its writes
  commit together with the job's completion, so a crash mid-handler rolls everything back and the job retries (INV-04, proven by the
  T-002 crash test). For events, `consumed_events (consumer, event_id)` is inserted in the same transaction, so a redelivered event
  is a no-op for that consumer. Handlers still check aggregate state and version, because two *different* events can race.
- **Ordering.** Per-aggregate order comes from the aggregate's version column (optimistic locking). Cross-aggregate order is not
  assumed. Pier deliveries are unordered (Pier DEC-047), so deposits are matched by id, never by arrival order.
- **Timers and watchdogs are a sweep, not per-item jobs (DEC-025).** A pg-boss cron job (`payment-sweep`, every minute) expires
  payments whose quote expired more than 5 min ago and re-wakes the payout and refund pumps. Work lists live in tables
  (`payouts`, `refunds`), and jobs only wake the loops that read them, so a lost job delays work by at most a minute and loses none.

### 3.4 The rail payment flow (Vants Pay)

```
POST /v0/quotes {brCode|pixKey, amountBrl?, asset}
  → BR Code validated locally (INV-05) → priced (§3.7) → Quote(expiresAt = now + QUOTE_TTL)
POST /v0/payments {quoteId, refundTo?} + Idempotency-Key
  → Payment AWAITING_DEPOSIT, muxId = next u64, deposit = { address: M…(treasury, muxId), memoId: muxId, asset, amount }
wallet pays (classic payment with memo id, or SAC transfer to the M… address)
  → Pier transfer event (to = treasury, to_muxed_id = muxId) → /ingress/pier (or the pull reconciler) → inbox
  → DepositMatched{exact|over|under|late|unknown|wrong_asset}
exact/over (and quote alive) → PayoutRequested → hodle-payout queue (concurrency 1, DEC-008)
  → POST /api/wallet/payout {value, asset:"USDH", network:"base", qrCode|pixKey, externalId:"vants:<paymentId>"}
  → 202 COMPLETED (sandbox) → PayoutCompleted → ledger posted → PaymentCompleted → integrator webhook
  → Hodle PAYOUT_SUCCESSFUL webhook → confirms (watchdog flags it if missing, §3.6)
over → excess refunded (RefundRequested, partial)
under / late / wrong_asset → RefundRequested (full) → treasury payment to refundTo|sender, memo text "vants:rf:<mux id base 36>:<n>"
unknown muxId → UnattributedDeposit → refund to sender (testnet policy, §11 Q6)
PAYOUT_FAILED / 4xx from Hodle → RefundRequested (full) ; PAYOUT_REFUNDED (MED) → RefundRequested (returnedAmount)
```

**Payment states** (`@vants/domain` `decide`, DEC-020): `awaiting_deposit → funded → paying → completed`, with branches
`→ refunding → refunded` and `awaiting_deposit → expired` (no deposit before the timeout). A quote has its own state (QUOTED belongs to
the quote, not the payment). A MED reversal is an event (`PayoutReversed`) that moves `completed → refunding`, not a resting state.
- **A deposit that can't fund the payment ends it.** While awaiting, a wrong-asset, late or short deposit sends the payment to `refunding`.
- **A deposit after the payment moved on is refunded** (`kind: "unexpected"`), and the status is unchanged.
- **A payment is settled** (`isSettled`) when its status is terminal and every refund has been sent.

Every transition is persisted in `payment_transitions` with its causing input.

### 3.5 The mini-app exit flow

The exit planner applies `earlier prototype` rules: **price the charge first; the user orders the positions; one final transfer of the exact
amount carries the payment id; on a shortfall nothing is built.** Since DEC-031, **every payment is one transaction, signed once**.

```
scan BR Code → POST /app/exits/quote {brCode, account G…} → Quote (same as rail) + portfolio with cost-to-exit per position
user orders positions → POST /app/exits {quoteId, picks:[{position, order}]} → Exit + Payment (source="app")
  → plan = ONE transaction for the route the picks allow; shortfall or two vaults → no transaction, Exit BLOCKED (with why)
GET /app/exits/:id/transaction → unsigned XDR (built + simulated server-side) + human summary
  → wallet signs once → POST /app/exits/:id/submit {signedXdr}: api checks it is the planned tx (hash), submits, records txHash
the transfer lands → the same Pier event (to_muxed_id) → the rail flow from DepositMatched on
```

Two routes, each a single transaction (Soroban allows one contract call per transaction, which can't be mixed with classic
operations):
- **Classic route:** the quote asset's balance, plus XLM swapped by `pathPaymentStrictReceive` to self. Then one `payment` of the
  exact amount to the payment's `M…` address. One classic transaction (up to 100 operations), atomic.
- **Contract route:** DeFindex vault shares, plus XLM and the same asset's balance. One call to the Vants **exit router** contract
  (`pay`): `vault.withdraw` an exact amount to the user, then (with XLM picked) an exact-output Soroswap swap of XLM into the
  asset for the user, then SAC `transfer` of the exact amount to the `M…` address (a `MuxedAddress`, Protocol 23 / CAP-67), so
  the transfer event carries `to_muxed_id`. The user is the transaction source: one envelope signature authorizes the whole call
  tree (DEC-034).
- XLM without a vault stays on the classic route (the order book). One vault per payment.

### 3.6 External signals: verification, dedupe, gaps

| Source | Ingress | Verification | Dedupe key | Gap / loss protection |
|--------|---------|--------------|------------|------------------------|
| Pier | `POST /ingress/pier` (webhook destination of the treasury subscription) | Standard Webhooks (`webhook-id/timestamp/signature`, `whsec_…`) via `Pier's SDK` `verifyWebhook` | `pier-event-id` (= envelope `id`) | Pier delivery is at least once and unordered. The `pier-pull` reconciler reads `GET /v1/subscriptions/:id/events?after=<cursor>` every 30 s and at startup; the cursor is stored after inbox insert. Pull is gap-free and ordered within Pier's 7-day retention |
| Hodle | `POST /ingress/hodle/:event`, one URL per event (Hodle has one webhook per event, each with its own secret) | `hex(HMAC_SHA256(secret, "<X-Hodle-Timestamp>.<raw body>"))`, constant-time compare, timestamp within 300 s; `WEBHOOK_TEST` → 200, no action | Deposits: `data.eventId`. Payouts: `(event, data.transactionId ?? data.externalId ?? data.invoice)` `[VERIFY: identifiers present in sandbox PAYOUT_* bodies]` | Payout webhooks retry only 3 times (10 s / 60 s / 5 min), and `GET /api/wallet/payout/:id` is closed to our key (403). In the sandbox the **202 response is final** and authoritative; the webhook confirms it. A watchdog flags payments whose webhook hasn't arrived in 10 min (`payout_unconfirmed`) for manual review. Deposit webhooks retry every minute until 2xx |
| Wallet (mini app) | `POST /app/exits/:id/steps/:n/submit` | The signed transaction's hash must equal the planned one; simulated before submit | Exit step id | The final transfer is still matched through Pier, so a lost submit response loses nothing |

### 3.7 Pricing, float and ledger

- **Quote:** `assetAmount = ceil((valueCents + feeCents) / rate)` in 7 decimals. In the sandbox `rate = 5.4` (Hodle's fixed sandbox
  rate), `fee` from `FEE_MODEL` (`sandbox` = 0; `hodle-default` = R$ 1.50 + 2.5% for modelling). TTL `QUOTE_TTL` (default 120 s,
  DEC-010). Code from the spike (`src/float/pricing.ts`, tested).
- **Float:** the Hodle sandbox USDH test wallet stands in for the production USDC/BRLA float (DEC-005). Float health
  (`available = ledger balance − reserved`) is checked when a payment is accepted, and the amount is **reserved** at `FUNDED`.
  `FloatLow` fires below `FLOAT_MIN_USD`.
- **Refill saga (DEC-029):**
  - When the float is below `FLOAT_MIN_USD` (woken by `FloatLow`, and by a per-minute cron), the worker bridges
    `min(target − float, CCTP_CAP_USD, USDC the treasury owns)` with CCTP: approve, then `deposit_for_burn` on Stellar
    testnet, then Iris attestation, then `receiveMessage` on Base Sepolia.
  - It then credits the Hodle sandbox float the same amount: `POST /api/deposit/asset` + settle, confirmed by the balance poll,
    since the sandbox sends no webhook (DEC-027), and posts `FloatCredited`.
  - The USDH credit is a sandbox stand-in for "the bridged USDC landed in the Hodle wallet": the bridged USDC stays on Base
    Sepolia (booked in `base:wallet` and reconciled), and the USDH comes from `sandbox:standin`. This is honest about the token
    mismatch shown in the spike.
- **Ledger:** double entry in minor units per asset (7 decimals for Stellar assets keyed by SAC id, 6 for USDH), posted by `publish`
  in the event's own transaction (DEC-028). Accounts: `treasury`, `float:hodle`, `clearing:<payment or deposit id>`, `conversion`
  (the funding asset ↔ USDH bridge: the PoC's FX position), `capital` (opening balances and top-ups), `expenses:fees` (network
  fees). Postings per event live in `packages/domain` (`postingsFor`) and are property-tested to sum to zero.
- **Books and reconciliation:** the worker opens the books once from the live balances (`LedgerOpened`). Every 5 min it compares
  the `treasury` balances with Horizon (per asset) and `float:hodle` with the Hodle sandbox balance; the same non-zero difference
  on two runs in a row is drift (`ReconciliationDrift`). `pnpm reconcile` prints one pass (D7).

### 3.8 Dependency boundaries

- Only `worker` calls Hodle, Pier's API, CCTP/Iris and Base Sepolia, and only `worker` signs with the treasury key. Only `worker`
  imports `@vants/adapter-hodle`, `@vants/adapter-pier` and `@vants/adapter-cctp`. The one exception: `api` imports the
  network-free `/webhook` subpath of the Hodle and Pier adapters to verify ingress signatures (DEC-021).
- `api` writes state and outbox. Its outbound calls are **Stellar reads** (Horizon/RPC for the portfolio and simulation, through
  `@vants/adapter-stellar` and `@vants/adapter-defindex`) and submitting **user-signed** transactions to Stellar RPC (DEC-016).
- `packages/domain` has no I/O and depends on nothing but `@vants/pix`; `@vants/pix` depends on nothing. Adapters never import each other.
- `web` talks only to `/app/*` and depends on no backend package.
- Enforced by `test/workspace.test.ts`, which checks manifests and every `@vants/*` import in `src/`.
- Allowed exceptions: none.

## §4 Invariants

| ID | Statement | Enforced by |
|----|-----------|-------------|
| INV-01 | **No payout without funding.** A Pix is requested only after a deposit for that payment is confirmed in a ledger and covers the quoted asset amount, and the quote was alive when the deposit's ledger closed. | Saga unit tests; D1, D5 |
| INV-02 | **At most one payout per payment.** Hodle `externalId = "vants:<paymentId>"`. The payout job is keyed by payment id. A replay returns the original payout (measured in the spike). | Saga tests; D3 |
| INV-03 | **Every funded payment terminates.** Each `FUNDED` payment reaches `COMPLETED` or `REFUNDED`. Watchdogs re-drive stuck sagas, and nothing waits forever on an external signal. | Saga timeout tests; D3 |
| INV-04 | **Each external event takes effect once.** Inbox uniqueness on `(source, dedupe_key)` plus state-checked handlers. | Inbox tests; D4 |
| INV-05 | **BR Codes are validated by Vants** (CRC16, TLV, amount = value when present) before quoting and before every payout. The Hodle sandbox validates nothing (spike). | `packages/pix` tests (ported); D4 |
| INV-06 | **The books balance.** Postings sum to zero per asset; reconcilers compare ledger vs Horizon and vs the Hodle sandbox balance and raise on drift. | Ledger property tests; D7 |
| INV-07 | **Testnet and sandbox only.** Config refuses the Stellar public passphrase, `hodle_live_` keys, non-sandbox Hodle hosts, Base mainnet (chain id ≠ 84532) and Pier subscriptions with `network: "mainnet"`. | Config tests (pattern from the spike's `src/config.ts`) |
| INV-08 | **Every ingress signal is verified before it changes state.** Hodle HMAC with timestamp tolerance; Pier Standard Webhooks; the user-signed tx hash equals the plan. Forgeries get 401 and nothing is written. | Ingress tests; D4 |
| INV-09 | **The backend never holds a user key.** User transactions are built unsigned and signed in the user's wallet. The only server key is the testnet treasury. | Code review + a test that no `/app/*` route accepts a secret |
| INV-10 | **Refunds go back with the payment id.** To `refundTo`, or else the deposit's sender, with memo `vants:rf:<mux id in base 36>:<n>` (≤ 28 bytes). A refund envelope is persisted before submission and re-submitted unchanged on retry (idempotent by hash). | Refund saga tests; D5 |
| INV-11 | **Quotes are honored or refunded.** The BRL paid equals the quote. A deposit after expiry is refunded, never re-priced silently. | Saga tests; D5 |
| INV-12 | **No secrets in git.** | secretlint gate |

## §5 Interfaces (v0, not frozen until gate G-B)

### 5.1 Vants Pay REST v0 (integrators)

Auth `x-api-key` (per integrator; stored hashed). JSON. Every `POST` takes an `Idempotency-Key` header (same key and same body → same response).

- `POST /v0/quotes` `{ destination: { type: "br_code", brCode, amountBrl? } | { type: "pix_key", key, keyType: "CPF"|"CNPJ"|"EMAIL"|"PHONE"|"RANDOM", amountBrl }, asset: "<code>:<issuer>" }`
  → 201 `{ id, destination: { type: "br_code", payee: { name, city, key? }, isDynamic } | { type: "pix_key", key, keyType }, amountBrl, feeBrl, asset, assetAmount, rate, expiresAt }`.
  A BR Code's own amount wins; `amountBrl` is only for codes without one, and must match when both are given.
  400 `INVALID_REQUEST`, `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_BR_CODE` (with the parser's reason), `AMOUNT_REQUIRED`, `AMOUNT_MISMATCH`,
  `ASSET_NOT_SUPPORTED`; 409 `FLOAT_UNAVAILABLE` (the float can't cover the payout, or the books aren't open); 422 `IDEMPOTENCY_KEY_REUSED`.
- `POST /v0/payments` `{ quoteId, refundTo?: G… }` → 201 `{ id, status: "awaiting_deposit", deposit: { address: "M…", account: "G…", memoId: "<u64>", asset, amount, expiresAt } }`.
  The wallet pays **either** `address` (muxed) **or** `account` + memo id. 404 `QUOTE_NOT_FOUND`; 409 `QUOTE_EXPIRED`, `QUOTE_ALREADY_USED`,
  `FLOAT_UNAVAILABLE`.
- `GET /v0/payments/:id` → `{ id, status, quote, deposit, funding: { txHash, ledgerClosedAt, amount } | null, payout: { endToEndId, txHash } | null, refunds: [ { amount, reason, status: "requested"|"sent", txHash } ], timeline: [ { status, at } ] }`.
  404 `PAYMENT_NOT_FOUND` (also for another integrator's payment).
- `POST /v0/webhook-endpoints` `{ url }` → 201 `{ id, url, createdAt, secret: "whsec_…" }` (the secret is shown only here);
  `GET /v0/webhook-endpoints` → `{ endpoints: [ { id, url, createdAt } ] }`; `DELETE /v0/webhook-endpoints/:id` → 204, or 404
  `WEBHOOK_ENDPOINT_NOT_FOUND`.
- `GET /v0/openapi.json` (no auth): OpenAPI 3.1 generated from the zod schemas that validate the API, including the webhook.
- Statuses exposed: `awaiting_deposit`, `funded`, `paying`, `completed`, `refunding`, `refunded`, `expired`.

### 5.2 Integrator webhooks v0

Standard Webhooks signing (`webhook-id`, `webhook-timestamp`, `webhook-signature`, `whsec_…` secret per endpoint), the same
scheme Pier uses. Body `{ type: "payment.updated", payment: <GET /v0/payments/:id body> }`, as of when the notification is
created. One notification per payment transition per active endpoint, `webhook-id` = `<paymentId>:<version>`, stable across
retries (dedupe on it). At least once: any non-2xx, timeout (10 s) or connection error is retried after 1, 2, 5, 15, 30, 60, 60
and 60 min, then marked failed. Redirects are not followed. An endpoint gets only transitions after it was added (DEC-026).

### 5.3 Mini-app BFF (`/app/*`)

**Login follows Stellar wallet practice (DEC-011):**

1. **Connect.** Stellar Wallets Kit v2 `authModal()`, with Freighter, xBull, LOBSTR (signer extension on desktop, **WalletConnect** on
   mobile; the WalletConnect module is added explicitly), HOT, Hana and others. This returns the account `G…`.
2. **Authenticate with SEP-10.** `GET /auth?account=G…[&client_domain=…]` returns a challenge transaction built with
   `WebAuth.buildChallengeTx`. The wallet signs it with its ordinary `signTransaction` (SEP-43), which every wallet supports, including
   LOBSTR through WalletConnect. `POST /auth {transaction}` checks it with `readChallengeTx` + `verifyChallengeTxSigners` (multisig-aware)
   and returns a short-lived JWT (15 min, `sub` = account). Vants publishes `/.well-known/stellar.toml` with `WEB_AUTH_ENDPOINT` and
   `SIGNING_KEY`, so wallets can discover it like any anchor's.
3. **Host wallet attestation (optional).** When opened from inside a wallet that supports SEP-10 `client_domain` signing, the challenge
   carries that wallet's domain, and the JWT records which host wallet the session came through (used later for revenue share).
4. **Every money movement is still a signed transaction.** The JWT authorises reads and planning only. Funds move only through
   transactions the wallet signs, step by step (INV-09).

Not used for login: SEP-53 `signMessage` (Final, but support varies by wallet `[VERIFY: LOBSTR/WalletConnect signMessage support]`).
Contract accounts (C…, passkey smart wallets) use **SEP-45** (signed authorization entries via `signAuthEntry`). That's out of the PoC,
because stellar-sdk 17.3.0 has no SEP-45 helpers; it's logged for M-next.
`GET /app/portfolio` → `{ account, funded, positions: [{ id, kind: "classic"|"defindex", asset, vault?, shares?, amount, valueUsd|null,
pricing: "par"|"estimated"|"unpriced", payable, exit: { steps, slippageBps, estimated } }], totalUsd }` (DEC-030; the route lands with auth
in T-020, `pnpm portfolio <G…>` reads it today).
Endpoints (DEC-032), all behind the SEP-10 JWT:
- `POST /app/exits/quote` `{ destination }` → the price in every funding asset, plus the portfolio (price first). An amount the
  float can't cover now is refused here with 409 `FLOAT_UNAVAILABLE`, right after scanning, before anything is picked.
- `GET /app/portfolio` also returns `rate` (BRL per USD) so balances show in reais (T-023).
- `POST /app/exits` `{ destination, picks: [positionId | { id, amount }…] }` (an `amount` in the quote asset, up to 7 decimals,
  is how much the user chose to take from that position; T-023) → 201 `{ id, paymentId, route, amountBrl, asset, assetAmount,
  transaction: { xdr, hash, maxTime, summary } }`: **one** unsigned transaction. When it can't be done in one transaction:
  422 `EXIT_BLOCKED` with `reason` (`shortfall`, `mixed_routes`, `wrong_asset`, `unpayable`, `unknown_position`, `over_position`,
  `router_unavailable`), and no payment is created.
- `GET /app/exits?limit=&before=` → `{ items, next, month: { paidBrl, count } }`: the account's signed exits, newest first,
  each with its payment and its `picks` (T-023, T-025); `month` is what was paid this calendar month (São Paulo time).
- `GET /app/limits` → `{ maxBrl }`: the largest payment the float covers right now (T-025).
- A Pix key destination is validated and stored in the directory's canonical form (`@vants/pix` `normalizePixKey`: CPF/CNPJ
  digits with check digits, `+55` phone, lower-case e-mail and EVP), else 400 `INVALID_PIX_KEY`; the quote returns
  `pixKey` and `pixKeyType` (T-025).
- `GET /app/exits/:id` → the exit and its payment.
- `POST /app/exits/:id/submit` `{ signedXdr }` → 202. It must be the planned transaction (same hash), signed, before its deadline:
  `PLAN_MISMATCH`, `EXIT_EXPIRED`, `SUBMIT_FAILED`; a repeat → 200, nothing sent again.
Schemas are strict: unknown fields such as a secret are refused (INV-09). Unpriced positions aren't payable, so signing stays
disabled for them (a `earlier prototype` principle).

Investing and adding money (T-026, DEC-038), behind the same JWT. Each move of money is again ONE transaction the wallet signs,
built by the server, kept by hash, and submitted only as that transaction, signed (`/app/actions`, same checks as an exit):
- `GET /app/invest` → `{ vaults: [{ id, name, asset, unit, apyPercent|null, invested, canInvest }], rate }`: the DeFindex USDC
  vault ("Dólar que rende") and XLM vault ("Lumens que rendem"); the yield is DeFindex's own API figure.
- `POST /app/invest` / `POST /app/redeem` `{ vault, amount }` → 201 an action `{ id, kind, transaction: { xdr, hash, maxTime,
  summary } }`: `deposit([amount], [99.5%], from, invest=true)` / `withdraw(shares rounded up, [99.5%], from)`; over what the
  account holds or has invested → 422 `OVER_BALANCE`; a vault Vants doesn't offer → 404.
- `POST /app/actions/:id/submit` `{ signedXdr }` → 202 (`PLAN_MISMATCH`, `ACTION_EXPIRED`, `SUBMIT_FAILED`; a repeat → 200);
  `GET /app/actions/:id` → its status (`built`, `submitted`, then `done`/`failed` from the RPC transaction status).
- `GET /app/ramp` → `{ available, sandbox, profile|null, targets: ["USDC","TESOURO"], orders }`.
- `POST /app/ramp/profile` (once): name, CPF (check digits), birth date, e-mail, phone, occupation, address → Etherfuse
  onboarding (sandbox KYC auto-approves); Vants keeps the Etherfuse ids, the name and the e-mail only.
- `POST /app/ramp/quote` `{ target, amountBrl }` → `{ quoteId, receive, feeBrl, expiresAt, needsTrustline }` (409
  `PROFILE_REQUIRED` first). The quote is held for its account until it expires.
- `POST /app/ramp/trustline` `{ target }` → an action (changeTrust), or `{ needed: false }`.
- `POST /app/ramp/orders` `{ quoteId }` → 201 the order with its Pix code when Etherfuse sends one and Etherfuse's status page
  (`QUOTE_EXPIRED`, `QUOTE_NOT_FOUND` (also another account's quote), `TRUSTLINE_REQUIRED`).
- `POST /app/ramp/orders/:id/simulate-payment` (sandbox) → 202; `GET /app/ramp/orders/:id` → the order refreshed from
  Etherfuse (`created` → `funded` → `completed`).

### 5.4 Ingress

`POST /ingress/pier`, `POST /ingress/hodle/:event` (`event ∈ PAYOUT_SUCCESSFUL | PAYOUT_FAILED | PAYOUT_REFUNDED | DEPOSIT_ASSET_SUCCESS | DEPOSIT_ASSET_FAILED`).
Raw body kept for signature checks. They answer 2xx only after the inbox insert commits (or on a known duplicate).

### 5.5 Domain event catalog (internal envelope v0, §3.3)

| Event | Producer | Consumers |
|-------|----------|-----------|
| `QuoteCreated`, `QuoteExpired` | api / timer | payment saga |
| `PaymentAccepted` | api | payment saga (deposit timeout timer), notifier |
| ~~`DepositObserved`~~ | — | The inbox record is the observation: the `inbox.pier` consumer *is* the deposit matcher (DEC-025) |
| `DepositMatched{kind}` | deposit matcher | payment saga, ledger |
| `UnattributedDeposit` | deposit matcher | refund saga (refund to the sender, memo tag `u<n>`) |
| `PayoutRequested` | payment saga | hodle-payout worker |
| `PayoutCompleted`, `PayoutFailed`, `PayoutReversed` | hodle-payout worker / hodle ingress | payment saga, ledger, notifier |
| `PayoutConfirmed` | hodle ingress (`PAYOUT_SUCCESSFUL`) | watchdog |
| `RefundRequested` | payment state machine | refund saga |
| `RefundSent` | refund pump, once the envelope is on the ledger | ledger, notifier |
| ~~`RefundConfirmed`~~ | — | Not needed: `RefundSent` already means "on the ledger" (DEC-025) |
| `FloatLow` | float consumer (a payout crossed `FLOAT_MIN_USD`) | refill saga (T-016) |
| `FloatCredited` | refill saga, once the credit shows in the sandbox balance | ledger |
| `LedgerOpened`, `TreasuryCredited` (top-up), `TreasuryFeePaid` | worker startup / deposit matcher / refund pump | ledger (DEC-028) |
| `ReconciliationDrift` | reconciler | ops (logged) |
| ~~`FloatReserved`, `FloatReleased`~~ | — | Rows in `float_reservations`, not events (DEC-028) |
| `CctpBurned`, `CctpMinted`, `TreasuryFeePaid` | refill saga | ledger (DEC-029); refill progress lives in `refills` |
| `ExitPlanned`, `ExitStepSubmitted`, `ExitStepConfirmed`, `ExitBlocked` | api / pier ingress | exit saga |
| `PaymentCompleted`, `PaymentRefunded`, `PaymentExpired` | payment saga | notifier |

### 5.6 Data model

Migrations live in `packages/db/migrations/` (node-pg-migrate, plain SQL). Applied migrations are never edited (DEC-017).

- **`1761180000000_backbone.sql` (T-002):** `inbox` (unique `source, dedupe_key`; `processed_at`), `outbox` (envelope v0, indexed by
  aggregate and correlation), `consumed_events` (PK `consumer, event_id`), `cursors` (e.g. the Pier pull cursor). pg-boss keeps its own
  schema (`pgboss`).
- **`1761180000001_payments.sql` (T-010):** `integrators`, `api_keys`, `quotes`, `payments` (+ `payment_mux_seq` from 1000),
  `payment_transitions`, `idempotency_keys`.
- **`1761180000002_sagas.sql` (T-011):** `deposits` (Pier event id PK; kind incl. `unattributed`, `unmarked`), `payouts` (one per
  payment, `external_id` unique, `confirmed_at` from the webhook), `refunds` (memo unique, `envelope_xdr`, `tx_hash`, `max_time`).
- **`1761180000003_notifier.sql` (T-012):** `webhook_endpoints`, `notifications`, `payment_transitions.notified_at`.
- **`1761180000005_refills.sql` (T-016):** `refills` (one active at a time: partial unique index), phase by phase.
- **`1761180000004_ledger.sql` (T-015):** `ledger_entries` (unique `event_id, account, asset`), `float_reservations`, `reconciliations`.
- **Domain tables, each added by the task that designs it:** `integrators`, `api_keys` (hashed), `webhook_endpoints`, `quotes`,
  `payments` (with `mux_id` unique, `version`), `payment_transitions`, `deposits` (Pier event id unique), `payouts` (`external_id` unique),
  `refunds` (`envelope_xdr`, `tx_hash` unique), `exits`, `exit_steps`, `ledger_entries`, `float_reservations`, `refills`.

## §6 Dependencies and versions

**Version policy (DEC-013): a new project starts on the latest stable release of every dependency**, resolved and checked at scaffold time
(T-001), then pinned exactly with a committed lockfile and locked installs. Pier's and the spike's pins are a reference for *which*
libraries to use, not for their versions. Every API the code depends on is checked against the installed version's source or docs.

- **Runtime and toolchain** (same tools as Pier, DEC-001): Node 24 LTS, pnpm, TypeScript, Biome, Vitest. Exact versions are recorded at T-001.
- **Libraries:** Fastify, pg, pg-boss, zod, standardwebhooks, viem, `Pier's SDK`. Latest stable at T-001; the versions are recorded in SOURCES.md.
- **`@stellar/stellar-sdk` ≥ 17.3.0, required** (latest, 2026-10-21; engines `node >= 22.12`). 17.3.0 fixes two SEP-10 verifier bugs that
  matter to DEC-011 (#1788: the `client_domain` signature check was skipped when that operation had no source; #1791: the server
  signature counted as the client-domain signature). It also makes `TransactionBuilder.build()` reject Soroban transactions with a memo or a
  muxed source, which DEC-004 relies on, and adds Protocol 30 types (CAP-84 muxed contract `W…` addresses).
- **Stellar Wallets Kit v2**, on JSR as `@creit-tech/stellar-wallets-kit` (npm updates will stop), static API with `authModal()`
  `[VERIFY: version at T-001; LOBSTR via WalletConnect on testnet]`.

| External | Value | Status |
|----------|-------|--------|
| Stellar network | testnet, `soroban-testnet.stellar.org`, Horizon testnet | SOURCES.md |
| Hodle | `https://sandbox-api.hodle.com.br`, key `hodle_test_…` | measured 2026-10-22 |
| Pier | Deployed instance `PIER_API_URL=https://<pier-host>` (health 200, ingest lag 4 s, 2026-10-22). The address is an ephemeral IP (Pier §11 Q19), so it's config only and never hard-coded | DEC-012 |
| SEP-10 helpers | `WebAuth.buildChallengeTx`, `readChallengeTx`, `verifyChallengeTxSigners`, `verifyChallengeTxThreshold`, `gatherTxSigners`, `verifyTxSignedBy` in `@stellar/stellar-sdk` **17.3.0** (checked in the package's type definitions, 2026-10-22). No SEP-45 helpers in 17.3.0 | DEC-011, DEC-013 |
| Testnet USD assets | Circle `USDC:GBBD47…` (SAC `CBIELTK6…`), Blend `USDC:GATALT…` (SAC `CAQCFVLO…`) | SOURCES.md, DEC-006 |
| DeFindex testnet vault | `CBMVK2JK…ZDWHN` (BlendUSDC) | SOURCES.md |
| CCTP | Stellar testnet domain 27 → Base Sepolia domain 6, Iris sandbox | spike `src/cctp/addresses.ts` |
| pg-boss transactional send | **Verified (T-001):** pg-boss 12.38.0 `send(name, data, { db })` takes any `IDatabase` (`executeSql(text, values) → { rows }`), so a `pg` client inside an open transaction enqueues atomically with the state change. No relay process | §3.3 |
| Resolved versions | Recorded in SOURCES.md "Resolved versions (T-001)" | DEC-013 |
| Open `[VERIFY]` | sandbox `PAYOUT_*` webhook emission and body ids; WalletConnect testnet support in LOBSTR; whether Stellar testnet is on Protocol 30 at T-001 (17.3.0 targets it; Pier saw P29 on 2026-10-21) | §11 |

## §7 Security and secrets

- **Trust model.** Integrators are trusted to send correct deposits, but nothing they send can make Vants pay before an on-chain
  deposit (INV-01). Hodle and Pier are authenticated per message (INV-08). The wallet is the only signer for user funds (INV-09).
  The treasury key is a testnet hot key in `worker` only.
- **Secrets** come from env or a git-ignored `.env`: `HODLE_SANDBOX_API_KEY`, `HODLE_WEBHOOK_SECRETS` (JSON map event → secret,
  from the Hodle sandbox dashboard), `PIER_API_KEY`, `PIER_WEBHOOK_SECRET`, `TREASURY_SECRET`, `EVM_TEST_PRIVATE_KEY`,
  `INTEGRATOR_KEY_PEPPER`. Logs use the spike's redacting logger.
- **Environments.** Local and testnet only (INV-07). Webhook ingress needs a public HTTPS URL (Cloudflare tunnel for local runs, as in the spike).
- **Personal data.** BR Codes carry payee names and keys. They're stored for the receipt, never logged in clear outside the payment
  record. No KYC data in the PoC.

## §8 Gates

| Gate | Command | When |
|------|---------|------|
| Format | `pnpm format:check` | every task |
| Lint | `pnpm lint` (`--error-on-warnings`) | every task |
| Unit tests | `pnpm test` | every task |
| Build | `pnpm build` | every task |
| Secrets | `pnpm check:config` (secretlint) | every task |
| Contracts | `pnpm test:contracts` (cargo test + clippy `-D warnings`, `contracts/exit-router`) | tasks touching contracts |
| Integration | `pnpm test:integration` (testcontainers Postgres 18.6, needs Docker; Hodle/Pier faked by recorded fixtures) | every task touching adapters or sagas |
| UI contrast | `pnpm check:contrast` (starts the Vite preview, drives Chrome over CDP at 390 px through 28 screens and states; WCAG AA 4.5:1 text, 3:1 large text and state marks, ≥ 12 px; text over photos measured on pixels; needs Chrome, `CHROME_PATH` to override) | every task touching `apps/web` (DEC-050) |
| E2E testnet | `pnpm e2e` against a running `pnpm api` + `pnpm worker` (real testnet, Hodle sandbox, Pier); checks D1, D4, D5 and writes `docs/evidence/g-b-*.json` | phase gates, T-090 |

Local services: `pnpm db:up` / `pnpm db:down` (Postgres 18.6 on host port 5433). Processes: `pnpm api`, `pnpm worker`,
`pnpm integrator:create <name>`, `pnpm float:topup <USD>` (sandbox only: a Hodle sandbox USDH deposit, booked as `FloatCredited`
from `sandbox:standin` like a refill's credit, so reconcile stays at 0; it refuses while a refill is in flight or the float
disagrees with the books).

**G-B evidence (T-012, 2026-10-22):** `pnpm e2e` 10/10: D1 ✓, D5 ✓ (all four kinds ≤ 30 s), D4 ✓ *simulated* (DEC-026).
**T-007 (2026-10-23):** D4 Pier half re-run with real deliveries ✓. Hodle signature verification proven on real signatures; Hodle replay still simulated, because the sandbox sends no event webhooks (DEC-027, Q11).
**D7 (T-015, 2026-10-22):** books opened live; after D1 + D5 traffic, reconcile 0 on every asset (DEC-028). Gates after T-015: test ✓ (169), test:integration ✓ (71).
**D6 (T-016, 2026-10-22):** float refilled through CCTP in 24 s while a payment completed; reconcile 0 on all five accounts (DEC-029). Gates after T-016: test ✓ (178), test:integration ✓ (79).
**One signature per payment (T-019, 2026-10-23):** both routes live, each 1 transaction / 1 signature, completed (DEC-031). Gates after T-019: test ✓ (199), test:integration ✓ (79), test:contracts ✓ (6).
**Mini-app backend (T-020, 2026-10-23):** SEP-10 login + one-signature exit live over the public URL, payment completed (DEC-032). Gates after T-020: test ✓ (203), test:integration ✓ (92).
**D2 test (T-021, for the human):**
1. With `ngrok http 3100`, `pnpm api` and `pnpm worker` running, open `https://<tunnel>.ngrok-free.dev/`
   in a desktop browser with Freighter or xBull on **testnet**.
2. Fund the account: Friendbot XLM is enough for the XLM route (it swaps on testnet SDEX); Circle or Blend testnet USDC for
   the balance route; DeFindex shares for the vault route.
3. Connect, sign the login challenge, paste a BR Code (a static code with an amount), pick positions, sign once, and watch
   the receipt reach "Pix pago".
**D2, XLM route (2026-10-23):** the human paid a R$ 20,00 code from XLM in the real UI: 1 signature, paid 10.8 s after signing
(26.4 s from plan), Pix E2E `SANDBOXB160197A070242D4A6AC96305` (`docs/evidence/d2-xlm-2026-10-23T00-44-18Z.json`). Then the vault route
from the human's wallet: R$ 20,00, 1 signature, paid 8.5 s after signing, Pix E2E `SANDBOXB0612B240DE644BDB0264F02F`
(`docs/evidence/d2-vault-2026-10-23T00-54-13Z.json`; the vault covered the whole amount). A vault withdraw needs a trustline to
the vault's asset (Blend USDC): without one the withdraw traps ("trustline entry is missing"). Earlier attempts got 409 `FLOAT_UNAVAILABLE` only after the pick; pricing now checks the float.
Gates after T-021: test ✓ (206), test:integration ✓ (94), test:contracts ✓ (6).
**XLM with a vault (T-022, 2026-10-23):** one router call withdrew 169.26 USDC from the vault, bought 10.18 USDC with at most
44.70 XLM on Soroswap, and paid 179.44 USDC: 1 operation, 1 signature, completed 6 s after landing (`e22bf4c6…`,
`docs/evidence/t-022-xlm-with-vault-2026-10-23T01-02-45.212Z.json`). Reconcile 0 on all five accounts (DEC-034). Gates after
T-022: test ✓ (208), test:integration ✓ (97), test:contracts ✓ (10).
**Investing and adding money (T-026, 2026-10-23):** `pnpm money:smoke` live: invest 10 lumens (7.3 s), take 4 out (2.1 s),
Etherfuse details → quote → accept dollars (5.5 s) → order → simulated Pix → `funded` (sandbox stops there) (DEC-038). Gates after
T-026: test ✓ (244), test:integration ✓ (107), test:contracts ✓ (10), build ✓, lint ✓, check:config ✓.
After T-012 the gates are: format ✓, lint ✓, build ✓, test ✓ (165), test:integration ✓ (60), check:config ✓.

**Baseline (T-001, 2026-10-22, clean install with Node 24.18.1 and pnpm 11.21.0):** format:check ✓, lint ✓, test ✓ (18 tests, `test/workspace.test.ts`),
build ✓ (tsc for the Node workspace + tsc and `vite build` for `apps/web`), check:config ✓, test:integration ✓ (no files yet).
After T-002: test:integration ✓ with 5 tests (`packages/db/src/backbone.int.test.ts`), and `--passWithNoTests` removed from the script.
The secret scan was proven live: a planted fake `hodle_test_…` key and the Hodle production host in tracked source both made it exit 1.
It skips git-ignored paths.

## §9 Milestones and tasks

Phase gates: **G-A** after T-005 (rail backbone, recorded fixtures), **G-B** after T-012 (D1, D4 and D5 on testnet; interfaces frozen),
**G-C** after T-021 (D2, D6), **G-D** after T-090 (all checks).

| ID | Title | Deps | Reads | Status | Acceptance criteria |
|----|-------|------|-------|--------|---------------------|
| T-000 | Spec approval | — | all | done | Approved 2026-10-22; Q1 deferred, Q3 and Q5 resolved |
| T-001 | Workspace scaffold | T-000 | §6, §8, DEC-013 | done | pnpm workspace with apps/packages from §3.2; latest stable versions resolved, pinned and logged in SOURCES.md (`@stellar/stellar-sdk` ≥ 17.3.0); every API the spec names checked against the installed source; gates runnable; CLAUDE.md copied; baseline recorded |
| T-002 | DB, outbox/inbox, pg-boss wiring | T-001 | §3.3, §5.6 | done | Migration 0001; outbox relay; inbox uniqueness; crash-between-ack-and-handle test passes (INV-04) |
| T-003 | `packages/pix` port | T-001 | INV-05 | done | Spike `emv.ts` + tests ported; BR Code guard (amount = value) |
| T-004 | Config guard | T-001 | INV-07 | done | Refuses mainnet passphrase, `hodle_live_`, non-sandbox host, chain ≠ 84532, Pier mainnet |
| T-005 | Domain: Payment state machine + pricing + ledger postings | T-002 | §3.4, §3.7, §4 | done | All transitions table-tested; postings sum to zero (property test); quote maths matches the spike |
| T-006 | Hodle adapter + ingress | T-002 | §3.6, §5.4 | done | HMAC verify + 300 s tolerance; WEBHOOK_TEST no-op; payout with `externalId`; recorded-fixture tests |
| T-007 | **Probe:** Hodle sandbox webhooks | T-006 | §11 Q1 | done | Human registers webhooks in the sandbox dashboard; record whether USDH payouts and deposit settles emit `PAYOUT_SUCCESSFUL` / `DEPOSIT_ASSET_SUCCESS`, and their body ids (SOURCES.md) |
| T-008 | Pier adapter + ingress + pull reconciler | T-002 | §3.6 | done | Treasury payment subscription created idempotently; Standard Webhooks verified; pull catch-up with stored cursor; kill/restart test loses no event |
| T-009 | Stellar adapter (treasury) | T-004 | §3.4, INV-10 | done | Muxed deposit address per payment; refund builder (persist envelope, resubmit by hash); Horizon balance reader |
| T-010 | Vants Pay API v0 + integrator keys | T-005 | §5.1 | done | Quotes and payments with Idempotency-Key; error codes; OpenAPI emitted |
| T-011 | Payment + refund sagas, hodle-payout worker (concurrency 1) | T-006, T-008, T-009, T-010 | §3.4, §4 | done | INV-01/02/03/10/11 tests; watchdogs; D5 cases unit-tested |
| T-012 | Notifier (integrator webhooks) + D1/D4/D5 on testnet | T-011 | §5.2 | done | Standard Webhooks signed; retries; **G-B evidence recorded** |
| T-015 | Float service + reconcilers | T-011 | §3.7, INV-06 | done | Reserve at FUNDED; FloatLow; ledger vs Horizon and Hodle balance |
| T-016 | Refill saga (CCTP + USDH credit via webhook) | T-015, T-007 | §3.7 | done | Spike CCTP code ported; capped; event-driven credit; payments not blocked (D6) |
| T-018 | DeFindex + portfolio reads | T-009 | §5.3 | done | Classic balances + vault shares valued; matches the spike's vault maths |
| T-019 | Exit planner + one-transaction builders + exit router contract | T-018, T-011 | §3.5, DEC-031 | done | **One signature per payment.** `earlier prototype` rules as tests: price first, ordered picks, transfer last with muxed id, shortfall → no transaction. Classic route (USDC + XLM swap) as one classic tx; vault route as one router call; router contract tested (Rust) and deployed on testnet |
| T-020 | Mini-app BFF + SEP-10 auth | T-019 | §5.3, DEC-011 | done | `/.well-known/stellar.toml` + `GET/POST /auth` per SEP-10 (stellar-sdk WebAuth); multisig-aware verification; 15-min JWT; challenge replay and expiry rejected; tested with Freighter, xBull and LOBSTR (WalletConnect); unsigned XDR only (INV-09); submit checks the planned hash |
| T-021 | Mini app web | T-020 | §5.3 | done | Wallets Kit connect (Freighter/xBull testnet), BR Code scanner, portfolio, picker, signing, receipt; **G-C evidence (D2, D6)** |
| T-022 | XLM with a vault in one signature | T-021 | §3.5, DEC-034 | done | The human asked (2026-10-23) to pay from XLM and vault shares together. Router `pay` gains an exact-output Soroswap swap leg; planner allows XLM with a vault (router route); builder prices the leg with the AMM's own quote and refuses (422 `shortfall`) when it costs more XLM than spendable; Pick screen no longer blocks the combination; live run on testnet |
| T-023 | Mini app as a real app: per-position amounts, Vants design system | T-022 | §5.3, DEC-035 | done | The human asked (2026-10-23): choose how much of each position pays the bill, the new Vants design system, a home, a connection that persists, a transactions list. Planner and API take `{ id, amount }` picks (`over_position` when above a balance); `GET /app/exits` (cursor pages); 7-day session kept on the device; portfolio carries the rate. Web: welcome, home (balance, assets, recent), pay (scan → allocate with sliders and amounts → review), activity, receipt, account (theme, disconnect); design system tokens, fonts, logo and components ported |
| T-024 | Light-only polish (taste + impeccable) | T-023 | §5.3, DEC-036 | done | The human (2026-10-23): "use the taste skill to improve it. i dont like the dark mode. make light mode only and focus on that". Dark theme and theme switch removed; light screens reworked against the taste skill's app-screen rules and impeccable's polish pass, inside the Vants design system |
| T-025 | Redesign from the Claude Design canvas; QR code and Pix key | T-024 | §5.3, DEC-037 | done | The human (2026-10-23): a full refactor from Claude Design, inspired by modern global-account apps, covering paying a QR code and sending to a Pix key. Canvas "Vants mini app redesign" (11 boards) implemented; key detection/validation shared by API and app; amount entry for keys and amount-less QR codes; `/app/limits`; list picks and month summary; live key payment |
| T-026 | Visual refactor, motion, plain words; adding money (Etherfuse) and investing (DeFindex) | T-025 | §5.3, DEC-038, DEC-039 | done | The human (2026-10-23): "use the taste skill to do a visual refactor and motion. check what other pages are missing. i like full width images, people, a very professional style", then "we never use cripto jargon, very friendly. also, i want to integrate onramp via etherfuse. and investiments on defindex". Investir tab (two vaults, put in / take out in one confirmation), Adicionar dinheiro (Pix through the Etherfuse sandbox: details once, price, accept the asset once, Pix, status), Ajuda and not-found pages, full-width credited photographs, glossary pass in the app and in every summary the wallet shows, view transitions and reduced-motion fallbacks; live invest/redeem and ramp run recorded |
| T-027 | Hosting: app on Vercel, backend on Google Cloud | T-026 | DEC-045 | done | The human (2026-10-23): "now deploy it and host on vercel", then "host it on gcloud the backend. frontend on vercel" (Vercel scope: personal, project `vants-app`). Static app on Vercel at https://vants.example.com with rewrites to the backend; API, worker, Postgres and Caddy on one GCE e2-small (`vants-1`, project `<gcp-project>`); local database copied once; evidence `docs/evidence/t-027-deploy-app-2026-10-23T10-16-42.740Z.json` |
| T-028 | Link previews: Open Graph, X card, icons | T-027 | DEC-046 | done | The human (2026-10-23): "Ok, but now lets focus on OG tags. Images, description, everything. then deploy it again". A 1200×630 card from the welcome screen (og/card.html → public/og.jpg), Open Graph and X tags with absolute URLs, title and description in the app's voice, PNG touch and manifest icons; redeployed to Vercel production |
| T-029 | Tesouro in "Seu dinheiro" and as a way to pay | T-028 | DEC-047 | done | The human (2026-10-23): "on my Seu Dinheiro tab i dont see the TESOURO. Also, i cant use TESOURO to pay a pix. Solve that". Root cause: the Etherfuse sandbox never delivers TESOURO on testnet. Tesouro now bought and sold on the order book (Etherfuse's market maker), valued there, payable like lumens in one signature; Tesouro page in Investir; evidence `docs/evidence/t-029-tesouro-2026-10-23T10-47-28.279Z.json` |
| T-030 | Professional pass: grouped panels, money marks, header hierarchy | T-029 | §5.3, DEC-044, DEC-048 | done | The human (2026-11-02): "lets do a refactor for vants ui. I still fell that is not professional enough. use impeccable skill"; chose grouped panels over DEC-044's lists on the page. Same flows, copy and API; lists, facts and breakdowns in panels; one mark per kind of money with a yield badge; two header tiers; no console errors and no horizontal overflow at 390 px on every preview screen; gates green |
| T-031 | Brand media: full-screen welcome photograph, brand-ink moments | T-030 | §5.3, DEC-048, DEC-049 | done | The human (2026-11-02): "the images are still not giving me the professional look. maybe we can use full screen images or videos. also do ou believe the logo or colors should change?"; then, on an Ipanema beach loop: "why beaches? we are creating a financial app", chose everyday payment footage, and "use default payment footage or image". Welcome: a full-screen photograph of paying with a phone at a café counter under the brand ink; receipt and link-preview card in brand ink; logo and palette kept; credits in Conta; gates green |
| T-032 | Contrast and readability gate; fix the adding-money status | T-031 | §5.3, §8, DEC-050 | done | The human (2026-11-02), with a screenshot of "Adicionar dinheiro" (light text on the light page): "Look at this contrast issues. double check every page so this dont happen again. check for contrast and readability issues". Root cause fixed (T-031's dark-card rules leaked through `.receipt`); `pnpm check:contrast` covers every screen and state, catches the reported case (1.21:1), and passes at 0 failures; added to §8 |
| T-033 | Atividade shows every movement | T-032 | §5.3, DEC-051 | done | The human (2026-11-02): "the activity is only listing offramps and forgeting about investments and other kinds of activities". One feed: Pix payments, investing/redeeming, Tesouro trades, accepting an asset, Pix deposits; newest first, by day, one cursor; unsigned actions left out; submitted actions settled from the network; integration test on Postgres; contrast gate on Atividade |
| T-034 | Money math audit and fixes | T-033 | §3.7, §5.3, DEC-052 | done | The human (2026-11-02): "lets double check all the math around the system. Calculation about values everywhere ... double check all the infos and if they are correct". Two independent audits (backend; app) with every finding confirmed by a numeric example; confirmed bugs fixed with tests; the books-alarm rule is a §11 question (Q15) |
| T-035 | The success moment and where each flow ends | T-034 | §5.3, DEC-053 | done | The human (2026-11-02): "lets work a little bit on the wow moment. when someone invest, pay or get to the end of a flow on the app. i want motion, elegant but pretty. also check where it redirects after, it needs to make sense". One signature success moment at the end of paying, investing, redeeming, Tesouro and adding money, only when completion happens on screen; reduced motion shows the end state; each end leads somewhere that makes sense; contrast gate covers the success states |
| T-047 | Only an asset's own contract makes a deposit | T-011 | §3.4, §3.6, INV-01, INV-10, DEC-064 | review | From the review of PR #1. A `transfer` event whose contract is not the SAC of the asset it names (or whose name is not an asset) changes nothing: no deposit, no refund, no capital booked, no payment state change, no retry; real transfers behave as before |
| T-090 | PoC evidence run | T-012, T-016, T-021 | §1 | todo | D1–D7 recorded with timings, tx hashes and logs; §2 claims updated |

## §10 Decision log

### DEC-001: Pier's stack and workflow (2026-10-22, T-000)
Context: The human asked for a solid architecture and to use Pier where useful. Pier already runs this kind of system (Postgres log,
pg-boss delivery, Standard Webhooks, Fastify) with tests and gates.
Decision: Same toolchain, same agent workflow (`CLAUDE.md`), same SPEC/SOURCES layout.
Alternatives: Next.js API routes (as in `earlier prototype`): no durable jobs or outbox. Go: no shared code with the spike or Pier.
Consequences: §6 and §8 mirror Pier. Spike code (TypeScript) ports directly.

### DEC-002: Event-driven modular monolith on Postgres + pg-boss (2026-10-22, T-000)
Context: A payment waits on several asynchronous outside signals (Stellar deposits via Pier, Hodle webhooks, CCTP attestation,
timers). It must survive crashes, duplicates and out-of-order delivery. The human asked for event-driven where it makes sense.
Decision: Domain events through a transactional outbox, an inbox for every external signal, sagas as idempotent consumers, and timers
as delayed jobs. One Postgres is both the record and the queue (pg-boss). Two processes (`api`, `worker`).
Alternatives: RabbitMQ or Kafka (Pier can deliver into them): a second stateful system to run for a PoC, and the outbox would still be
needed for atomicity. Microservices per domain: network failure modes without a scaling need. A synchronous request chain: can't
wait minutes for external signals or recover after a crash.
Consequences: Exactly-once *effects* come from the inbox plus state checks, not from the transport. A broker can replace pg-boss
later behind the same outbox.

### DEC-003: Pier for on-chain detection, webhooks plus pull (2026-10-22, T-000)
Context: Vants must see every deposit to the treasury. Pier pushes at least once and unordered, and its pull API is gap-free and
ordered within 7 days.
Decision: One payment subscription (`account` = treasury, `direction: "in"`) with a webhook destination for latency, plus a pull
reconciler with a stored cursor for completeness.
Alternatives: Our own `getEvents` poller (what Pier exists to replace). Horizon streaming (no replay guarantee and no SAC transfers to M… ids in one place).
Consequences: Pier is an external dependency (§11 Q3). If it's unreachable, the pull reconciler catches up once it's back, within retention.

### DEC-004: Correlate deposits by muxed id (2026-10-22, T-000)
Context: Contract invocations must use `MEMO_NONE`, so a SAC transfer can't carry a memo. Since Protocol 23 the SAC `transfer` takes
a `MuxedAddress`, and both a classic memo id and a muxed destination appear as `to_muxed_id` in the transfer event (Raven; Pier measured it).
Decision: Each payment gets a unique u64 `muxId`. The deposit address is `M…(treasury, muxId)`, with `account` + memo id as the fallback for wallets without M support.
Alternatives: Memo text (not available to contract transfers). One account per payment (reserve cost and account sprawl).
Consequences: The deposit matcher keys on `(asset contract, to_muxed_id)`. Mini-app final transfers use the muxed address.

### DEC-005: Hodle sandbox USDH test wallet as the float (2026-10-22, T-000)
Context: The payout permission (`WALLET_PAYOUT_API`) is off on our sandbox key, but `asset: "USDH"` payouts take the test-wallet path that needs neither the flag nor a PIN
(measured). The sandbox can't spend bridged USDC.
Decision: The float is the USDH test wallet. Payouts use `asset: "USDH"`, `network: "base"`, `externalId`. Refill credits it via deposit + settle.
Alternatives: Wait for the payout permission (blocks the PoC). The USDC path (needs the flag, PIN and key).
Consequences: The bridge leg and the float are value-reconciled in USD, not carried token to token (§3.7, `fx:sandbox` account).

### DEC-006: USD asset allowlist on testnet (2026-10-22, T-000)
Context: Testnet has two "USDC"s: Circle's (CCTP) and Blend's (the DeFindex vault asset).
Decision: Accept both 1:1 as USD on testnet, listed in config by SAC contract id. Refill uses only Circle's.
Consequences: The treasury accumulates BlendUSDC with no refill route on testnet. This is accepted and reported in D7.

### DEC-007: Pay only after the deposit confirms (2026-10-22, T-000)
Context: The spike measured optimistic confirmation (p50 2.4 s) against confirmed (p50 3.5 s).
Decision: INV-01. Optimistic payout stays a later experiment behind a flag and a cap.

### DEC-008: One Hodle payout in flight per wallet (2026-10-22, T-000)
Context: Two concurrent sandbox payouts from one wallet failed with `422 SANDBOX_SETTLEMENT_FAILED` (an EVM nonce clash; spike).
Decision: The `hodle-payout` queue runs with concurrency 1.

### DEC-009: ~~Step-by-step signing in the PoC; the exit router comes later~~ (2026-10-22, T-000), superseded by DEC-031
Context: Soroban allows one operation per transaction. An atomic multi-protocol exit needs a new contract and an audit.
Decision: The PoC signs each unwind step separately, then the final transfer (as `earlier prototype` did). The exit router is a later milestone.

### DEC-031: One signature per payment: a classic route and an exit-router route (2026-10-23, T-019)
Context: The human's requirement (2026-10-23): "I want only one sign per payment." DEC-009 had planned one signature per unwind step.
The facts that shape it:
- A Soroban transaction carries exactly one `InvokeHostFunction` operation, which can't be combined with classic operations.
- A classic transaction can carry up to 100 operations, atomically.
- Since Protocol 23 (CAP-67), the SAC's `transfer` takes a `MuxedAddress`, and its event carries `to_muxed_id` (Stellar docs, SAC
  "Sending to a muxed address"; Raven, 2026-10-23).
Decision:
- **Every payment from the mini app is exactly one transaction, signed once.** The planner picks a route from the user's ordered
  picks.
  - **Classic route:** the quote asset's balance, plus XLM via `pathPaymentStrictReceive` to self, then one exact `payment` to
    `M…`.
  - **Contract route:** one `pay` call on the Vants exit router: withdraw an exact amount from a DeFindex vault, then one exact SAC
    transfer to `M…`.
- Picks that would need two transactions (XLM together with vault shares) are refused with an explanation, never split.
  **Superseded by DEC-034:** the router now buys the XLM leg on a Soroban AMM inside the same call.
- **Either way there is one deposit of the exact amount, matched as today** (no change to the rail).
- **The exit router** (`contracts/exit-router`, Rust/soroban-sdk):
  - stateless, no admin, holds no funds;
  - every movement uses the caller's own authorization, and it asserts the caller authorized the call;
  - tested with soroban-sdk testutils (a mock vault and a real SAC);
  - deployed to testnet from a dedicated Friendbot-funded deployer key, never the treasury, so the books stay clean.
Alternatives:
- Step-by-step signing (DEC-009): rejected by the human.
- A fee-bumped multi-transaction bundle: still one signature per transaction.
- A Soroban AMM inside the router for XLM: possible later; testnet liquidity is uncertain.
Evidence:
- **Router** (`contracts/exit-router`, soroban-sdk 29.0.1 for testnet protocol 29). 6 Rust tests with a mock vault and a real SAC:
  - withdraw + exact transfer to a muxed address, whose SAC event carries `to_muxed_id` 1002;
  - balance only;
  - `env.auths()` shows exactly one authorization, by the payer: root `pay` with nested `withdraw` and `transfer`;
  - a failing transfer reverts the withdraw;
  - no authorization → refused;
  - typed errors.
  Clippy is clean. A mutation dropping the root `require_auth` fails 3 tests.
- **Deployed 2026-10-23** from the dedicated key `GDOHO27R…VN43` (Friendbot): router `CC3UZVNRHSTQS5BCPWCUTLOYPM24MERBQ433GANF5WKQ77WHNYWA25ZY`
  (tx `ea9ec288…a282`, wasm sha256 `2a1ca8db495419e2…`), configured as `EXIT_ROUTER_CONTRACT_ID`.
- **Planner:** 10 tests (both routes, the user's order, stop at the amount, shortfall, mixed routes, wrong asset, unpayable,
  unknown position).
- **Live, both routes, 2026-10-23 00:01Z** (`pnpm exit:smoke`, `docs/evidence/t-019-one-signature-2026-10-23T00-01-38.403Z.json`):
  - **Router route:** the spike's DeFindex user paid a R$ 5.40 Blend-USDC quote from its vault in 1 contract call, 1 signature
    (`b248e299…`). The SAC transfer inside the router call reached Pier with its muxed id, and the payment completed 9 s after
    landing.
  - **Classic route:** the test payer paid a R$ 2.70 Circle-USDC quote from XLM in 1 transaction (path payment + payment), 1
    signature (`00a47c1c…`), completed 7 s after landing.
  - Reconcile after: 0 on all five accounts.
Consequences:
- §3.5 rewritten; T-020's step endpoints collapse to one transaction per exit.
- `pnpm test:contracts` (cargo test + clippy) joins the gates for contract changes.
- The router is new on-chain code: before mainnet it needs an audit.

### DEC-010: Quote TTL 120 s (2026-10-22, T-000)
Context: The deposit must land inside the quote. Testnet ledgers close in about 5 s, but a user may need time in their wallet.
Decision: 120 s by default, configurable. Late deposits are refunded (INV-11).

### DEC-011: Mini-app login is SEP-10 via the wallet's `signTransaction` (2026-10-22, T-000)
Context: The human asked for login that follows Stellar best practice and how LOBSTR and other wallets use apps. LOBSTR reaches apps through
WalletConnect (mobile) and a signer extension with "Log in with LOBSTR" (desktop). Stellar Wallets Kit v2 (`authModal()`) is how
Blend and others connect many wallets, and Offer Hub ships wallet login with Freighter, LOBSTR and xBull through it. SEP-10 is the
ecosystem's web-auth standard, used by anchors and the Anchor Platform. It needs only `signTransaction`, the one capability every
wallet and WalletConnect expose.
Decision: Wallets Kit v2 for connection; SEP-10 challenge/response for the session (stellar-sdk `WebAuth`); a published
`stellar.toml`; optional `client_domain` to record the host wallet; short-lived JWT for reads and planning only.
Alternatives: SEP-53 `signMessage` (simpler, but per-wallet support varies and it isn't what anchors use). A custom signed nonce (non-standard;
wallets show an unexplained payload). Privy or email login (`earlier prototype`'s Blux route): fine for a standalone app, wrong inside someone else's wallet.
Consequences: Vants' auth surface is already anchor-shaped, so moving to the Anchor Platform (SEP-6/24/31) later reuses it. C-accounts
need SEP-45 (M-next).

### DEC-012: Use the deployed Pier (2026-10-22, T-000)
Context: The human chose the deployed Pier over running one locally. It answered `/health` 200 with 4 s ingest lag on 2026-10-22.
Decision: `PIER_API_URL` points at the deployed testnet instance; one team key; one payment subscription created idempotently at startup.
Consequences: Pier's address is an ephemeral IP (Pier §11 Q19). If it changes, only config changes, and the pull reconciler catches up
within Pier's 7-day retention. If Pier is down, deposits are detected late but not lost.

### DEC-013: Latest stable dependencies, not inherited pins (2026-10-22, T-000)
Context: The first draft copied versions from Pier and the spike. The human asked to update `@stellar/stellar-sdk` rather than adapt to
an older version. 17.3.0 (2026-10-21) fixes SEP-10 `client_domain` verification bugs present in 17.1.0 and 17.2.x, which this design uses.
Decision: Resolve the latest stable release of every dependency at T-001, check the APIs against it, pin exactly and lock. `@stellar/stellar-sdk` ≥ 17.3.0.
Alternatives: Matching Pier's pins for consistency. Rejected: Vants shares no code with Pier at runtime (it talks to Pier over HTTP), so
consistency buys nothing and older SDKs carry known SEP-10 bugs.
Consequences: §6 lists libraries, not versions; T-001 records the resolved versions in SOURCES.md. A side note for Pier (not this repo):
it pins 17.2.0, and 17.3.0 changes `scValToNative` on colliding map keys and makes `inSuccessfulContractCall` optional.

### DEC-014: Respect pnpm's release-age window; Biome leaves the lockfile and Markdown alone (2026-10-22, T-001)
Context: pnpm 11 holds back releases younger than its minimum release age (cutoff about 24 h on 2026-10-22). Pinning `viem` 2.57.10
(published the same day) made pnpm write a `minimumReleaseAgeExclude` entry into `pnpm-workspace.yaml` for it and its dependency `ox`,
which quietly weakens a supply-chain safeguard. Separately, Biome 2.6 formats YAML and Markdown, which Pier's Biome 2.5 did not.
Decision: "Latest stable" (DEC-013) means the newest release that clears the window: `viem` 2.57.8 (2026-10-21). No exemptions.
The lockfile was rebuilt from a fresh resolution (it had never been committed). Biome ignores `pnpm-lock.yaml` (pnpm writes it) and
`**/*.md` (the spec docs are hand-written; `CLAUDE.md` stays a byte-for-byte copy of Pier's).
Alternatives: Keep the auto-added exemptions (rejected: they bypass the safeguard for a same-day release we don't need yet). Let Biome
reflow the docs (rejected: it would change `CLAUDE.md`).
Consequences: A future dependency younger than the window waits a day, or gets an explicit, reviewed exemption with a DEC.

### DEC-015: Accept a second, transitive Stellar SDK from `Pier's SDK` (2026-10-22, T-001)
Context: `Pier's SDK` 0.1.0 pins `@stellar/stellar-sdk` 17.2.0 (for its topic helpers), so the lockfile holds 17.2.0 next to
our 17.3.0.
Decision: Accept it. Vants code imports the SDK only as 17.3.0 (direct dependency of the stellar, defindex and cctp adapters and of
`api`); the Pier adapter uses pier-sdk only for HTTP, pull and `verifyWebhook`, and never passes SDK objects across the boundary.
Alternatives: A pnpm override forcing 17.3.0 into pier-sdk (rejected: it patches another package's tested pin). Dropping pier-sdk for raw
HTTP (rejected: duplicates its webhook verification).
Consequences: §11 Q10 asks Pier to move to 17.3.0. Once it does, the duplicate goes away.

### DEC-016: `api` reads Stellar state (2026-10-22, T-001)
Context: §3.8 said `api`'s only outbound call is submitting user-signed transactions, but §5.3 puts the portfolio and the step
builders (which read Horizon/RPC and simulate) in `api`. The two contradicted each other.
Decision: `api` may read Stellar state and simulate, through `@vants/adapter-stellar` and `@vants/adapter-defindex`, and submit
user-signed transactions. It still never calls Hodle, Pier or CCTP, and never signs with the treasury key (worker only).
Consequences: §3.8 reworded. The worker-only adapters are enforced by `test/workspace.test.ts`. **Flagged for the human's review**,
since this widens a boundary as written (even though §5.3 already required it).

### DEC-017: The backbone is pg-boss's transactional workers plus three tables (2026-10-22, T-002)
Context: §3.3 called for an outbox relay, an inbox and idempotent consumers. pg-boss 12.38.0 (installed) offers `send/publish(…, { db })`
inside a caller's transaction, `subscribe` fan-out, and `work(…, { transactional: true })`, which runs the handler and the job's
completion in one database transaction.
Decision:
- `publish` writes `outbox` and calls pg-boss `publish` in the caller's transaction. There is no relay process.
- `recordInbound` inserts into `inbox` (unique `source, dedupe_key`) and sends `inbox.<source>` in one transaction before the sender is acknowledged.
- Every consumer is a transactional worker with batch size 1. Event consumers also insert `consumed_events (consumer, event_id)` in that
  transaction. Inbox consumers lock the row and set `processed_at` in it.
- Queues default to 10 retries with exponential backoff from 1 s (cap 300 s), a 300 s expiry, and `notify: true` (LISTEN/NOTIFY wake-ups, as in Pier DEC-048).
- Migrations: node-pg-migrate 9.0.0 (Pier's choice, latest release), plain SQL. Migration 0001 holds only the backbone. Domain tables
  arrive with the tasks that design them, so an applied migration never has to change.
Alternatives: A polling relay from `outbox` to pg-boss (an extra process and extra latency, for nothing a transactional send can't do). A
consumer dedupe based only on aggregate version (misses a re-delivered identical event). One wide initial migration with every §5.6
table (it would freeze schemas before their tasks design them).
Consequences: §3.3 and §5.6 updated. Integration tests need Docker (testcontainers). Every later task adds its own migration.

### DEC-018: BR Code module ported without BlindPay specifics, ASCII-only fields, property-tested (2026-10-22, T-003)
Context: The spike's `emv.ts` carried a BlindPay sandbox "magic sequence" guard, used Node's `Buffer`, and its builder wrote TLV lengths
in UTF-8 bytes while its parser read them in characters. A new test exposed the mismatch for a non-ASCII key. Which unit EMV specifies
is unverified here (outside Raven's scope), and Pix keys (email, phone, CPF/CNPJ, EVP) are ASCII in practice.
Decision: Port the parser, builder, CRC and payout guard. Drop the BlindPay sequences. Use `TextEncoder` so the module also runs in the
browser. The builder rejects any non-printable-ASCII field (names, cities and descriptions are already sanitized to ASCII), so bytes and
characters agree. Add fast-check 4.10.2 (latest, 2026-09-19) as a root dev dependency, with two properties: valid input round-trips,
and any one-character tamper with the old CRC is rejected.
Alternatives: Byte-length parsing (unverified against EMVCo; real codes seen so far are ASCII). Hand-rolled random loops instead of fast-check.
Consequences: `checkBrCodeForPayout` (INV-05) lives in `@vants/pix`, returning `INVALID_VALUE | INVALID_BR_CODE | AMOUNT_MISMATCH`.
`[VERIFY: EMVCo MPM length unit for non-ASCII values]` stays open if a real non-ASCII code ever appears.

### DEC-019: One validated config package, read only by the two processes (2026-10-22, T-004)
Context: INV-07 needs `api` and `worker` to refuse mainnet and production values at startup. Both read overlapping variables, and a
config error must not print the secret it rejects.
Decision: A new `@vants/config` package (zod), with `loadApiConfig` and `loadWorkerConfig`. Each variable has one schema with a fixed message,
and every issue is collected before throwing `ConfigError`. Refused: the Stellar public passphrase (checked against the SDK's
`Networks.PUBLIC`, never a literal), `horizon.stellar.org`, `hodle_live_` keys, non-sandbox Hodle hosts, `PIER_NETWORK` other than
testnet, `BASE_CHAIN_ID` other than 84532, and Iris hosts other than `iris-api-sandbox.circle.com`. The api config has no treasury,
Hodle, Pier or EVM secrets. Only `api` and `worker` may depend on the package (`test/workspace.test.ts`).
Alternatives: A config module per app (duplicated rules). Reading `process.env` inside adapters (hidden dependencies, untestable).
Consequences: §3.2 gains a component. The mainnet host list is short on purpose, with no unverified endpoints. T-009 adds the
authoritative runtime check: the RPC's `getNetwork()` passphrase must be testnet, and T-016 likewise checks `eth_chainId` on Base.

### DEC-020: Payment state machine, pricing and ledger as pure functions (2026-10-22, T-005)
Context: §3.4 listed states and branches but left their edges open: what a bad or second deposit does, how a MED is refunded, and
what "settled" means for INV-03. §3.7 named ledger accounts without postings.
Decision:
- `decide(payment, input, causationId)` returns `{ payment, events }` and never does I/O.
  - Inputs: `deposit.observed`, `payout.started`, `payout.succeeded`, `payout.failed`, `payout.reversed`, `deposit.timeout`, `refund.sent`.
  - Duplicate inputs (same deposit id, repeated success, sent refund, known reversal) return the payment unchanged with no events.
  - Inputs that can't apply throw `InvalidTransition`.
- Deposit kinds, in this order: `wrong_asset`, `late` (ledger closed after `expiresAt`; exactly at expiry is on time), `under`, then `exact` or `over`.
  Anything after the payment left `awaiting_deposit` is `unexpected`. Refunds go to `refundTo`, else the sender.
- Amounts:
  - An over-payment refunds only the excess. A failed payout refunds the quoted amount.
  - A MED refunds `quote × returnedCents ÷ valueCents`, rounded down and capped at the quote.
  - Refund ids are `<payment>:rf<n>`.
- Pricing in integers: rates as millionths (`rateToMicros`), `assetAmount7 = ceil(totalCents × 10¹¹ ÷ rate)`, and USDH debit
  `= floor((value + fee) × 10¹⁰ ÷ rate)`. All the spike's figures are reproduced.
- Ledger: signed postings per asset over the accounts `treasury`, `clearing:<payment>`, `conversion`, `float:hodle`.
  - Postings per event: `DepositMatched` (treasury +D, clearing −D); `PayoutCompleted` (clearing +Q, conversion −Q; conversion +u USDH,
    float −u USDH); `PayoutReversed` (clearing −R, conversion +R); `RefundSent` (clearing +R, treasury −R).
  - Amounts are `bigint` in the domain and decimal strings in event payloads (JSON-safe).
Evidence: 99 unit tests. The table tests cover every transition. A fast-check property over 2,000 random histories checks that every
event balances per asset and that every settled payment leaves its clearing account at zero. A deliberate mutation (dropping a refund's
treasury leg) made the property fail with a minimal counterexample.
Alternatives: A state-machine library (XState): more surface than the 7 inputs need, and it would pull I/O-shaped APIs into `domain`.
Floats for money: rejected outright.
Consequences: §3.4 restated. Reversal refunds come from the treasury in the PoC. Recovering the returned USDH into the float is left to
reconciliation (T-015).

### DEC-021: Webhook verification lives next to each provider's client, behind a `/webhook` subpath (2026-10-22, T-006)
Context: Ingress runs in `api` (§3.6), but the Hodle and Pier adapters are worker-only (§3.8), because only `worker` may *call* those
services. Verifying an incoming signature isn't a call, and the verifier belongs with the provider's other knowledge.
Decision: Each worker-only adapter exposes a network-free `./webhook` subpath (`exports` in its `package.json`). `api` may declare the
Hodle and Pier adapters, but its source may import only those subpaths. `test/workspace.test.ts` enforces it at import level, and checks
that `webhook.ts` imports nothing but `node:crypto` (or, for Pier, its SDK's verifier).
Hodle specifics (T-006):
- One ingress URL per event (`/ingress/hodle/:event`), because each Hodle webhook has its own secret.
- Order of checks: unknown event → 404; `WEBHOOK_TEST` → 200 with no action (Hodle sends it before the secret is shown); signature over
  the raw body with 300 s tolerance → 401; body event ≠ URL → 400; inbox write → 200, or 500 so Hodle retries.
- Dedupe keys: deposits use `data.eventId` (documented as stable across retries); `PAYOUT_REFUNDED` uses the reversal or refund id; other
  payout events use `transactionId`, else `externalId`, else `invoice`.
- Client: sandbox host only, as defence in depth; payouts always use `asset: "USDH"`.
  - Payouts are retried on network errors, 5xx and 429 with the same `externalId` (Hodle dedupes it, measured in the spike). When retries
    run out, the error carries `outcomeUnknown`.
  - Error kinds: `insufficient_float`, `settlement_failed`, `invalid_request`, `unauthorized`, `busy` and `unavailable`. The saga maps
    these in T-011.
Alternatives: Move the verifiers into a shared ingress package (it splits each provider's knowledge in two). Let `api` import the whole
adapter (the boundary would then rest on discipline alone).
Consequences: §3.8 restated. Tests replay recorded sandbox exchanges from the spike and Hodle's documented webhook payloads.

### DEC-022: Pier adapter, ingress and pull reconciler (2026-10-22, T-008)
Context: §3.6 calls for Pier webhooks (for latency) plus a pull reconciler (for completeness). DEC-004 assumed both deposit paths carry the
payment id as `to_muxed_id`.
Decision:
- **Adapter (`@vants/adapter-pier`):**
  - `PierGateway` wraps `Pier's SDK` 0.1.0. `ensureTreasurySubscription` reuses any *testnet* payment subscription with
    `account` = treasury and `direction: "in"` (and the same webhook URL when one is given), else creates one; a new webhook's secret
    is returned once. `page` reads the pull API.
  - `parseTransfer` turns an envelope into `{ eventId, position, txHash, ledger, ledgerClosedAt, asset (contractId), from, to, amount7,
    muxedId? }`. Only a u64 digit string counts as a muxed id; a text memo arrives as bytes and is ignored.
  - `./webhook` holds `verifyPierWebhook`, which uses the SDK's Standard Webhooks check and validates the body shape.
- **`api`:** `POST /ingress/pier` refuses every delivery when `PIER_WEBHOOK_SECRET` is unset, and refuses a subscription other than
  `PIER_SUBSCRIPTION_ID`. It stores each delivery under the envelope id.
- **`worker`:**
  - `pullOnce` reads from the cursor `pier:<subscription>` and stores each event under the same envelope-id key. It moves the cursor only
    after a whole page is stored.
  - `pnpm pier:setup` creates or reuses the subscription and writes `PIER_SUBSCRIPTION_ID` (and the webhook secret, if one was created)
    to `.env`, never printing them.
  - `pnpm pier:pull` runs one pass.
- **Config:** `PIER_SUBSCRIPTION_ID` (UUID), plus the narrow loaders `loadPierSetupConfig` and `loadPierPullConfig`.

Evidence (testnet, 2026-10-22):
- **The deposit-matching key, confirmed live.** A T-008 probe recorded the envelopes for a classic payment with memo id 42 and for a
  native-SAC `transfer` to `M…(treasury, 43)`. Both read `topic ["transfer", from, to (base G…), "native"]` and
  `value { amount, to_muxed_id }`, which confirms DEC-004 on the live network.
- **Setup and pull against the deployed Pier.** `pnpm pier:setup` created subscription `9646a3f6-…` for treasury `GCOLMOCV…AJC2` and
  reused it on rerun. A real 1.5 XLM payment with memo id 777 then went through `pnpm pier:pull` into the local inbox
  (`to_muxed_id: "777"`, `amount: "15000000"`).
- **Crash test (integration).** The kill/restart test killed the reconciler after 130 of 250 events. After restart there were 250 inbox
  rows, the cursor stood at the last position, and a rerun was a no-op.

Alternatives: Our own `getEvents` poller (what Pier replaces). An SSE stream instead of pull (a stream still needs cursor bookkeeping, and
pull is enough at PoC volume).
Consequences: The webhook needs a public URL (a tunnel), then `pnpm pier:setup` again; the subscription is pull-only until then.
The treasury key was generated by the probe and lives only in the git-ignored `.env`.

### DEC-023: Treasury adapter: muxed deposit addresses, refunds by persisted envelope (2026-10-22, T-009)
Context: INV-10 wants every refund tagged with the payment and sent at most once. Contract calls can't carry a memo, so a SAC transfer
can't be a tagged refund. Refunding needs the deposit's classic asset.
Decision:
- **Deposit instructions:** `depositInstructions(treasury, muxId)` → `{ address: M…, account: G…, memoId }`.
- **Refunds:**
  - Each refund is one classic `payment` carrying the text memo `vants:rf:<base-36 mux id>:<n>` (≤ 28 bytes for any u64). The asset
    comes from the deposit event's `topic[3]` (`native` or `CODE:ISSUER`, now `assetName` in `parseTransfer`).
  - The envelope has `timebounds { maxTime = now + 300 s }` and is persisted before submission (by the T-011 saga).
  - On retry, `refundRetryDecision`: on the ledger → done; otherwise resubmit the *same* envelope until `maxTime + 30 s`; after that
    the envelope can never land, so rebuild.
- **Network:** `submitAndWait` looks the hash up before sending. `assertTestnet` checks the RPC's passphrase at startup (the
  authoritative INV-07 check DEC-019 promised). `treasuryBalances` reads classic balances for D7.
Evidence:
- **Live refund paid once (testnet).** A persisted envelope refunded the memo-777 deposit (1.5 XLM, memo `vants:rf:ll:1`); resubmitting
  the identical envelope returned `SUCCESS` and the ledger shows exactly one payment from it.
- **A real SDK quirk, caught live.** SDK 17.3 returns `tx.hash()` as a `Uint8Array`, whose `toString("hex")` ignores the encoding. The
  unit test had compared the value against the same mistake. Both are fixed: hashes go through `Buffer.from`, and the test asserts
  64-char hex.
Alternatives: Refund by SAC `transfer` (no memo possible). Rebuild on every retry (risks paying twice if the first one lands late).
Consequences: Refunds and payouts both run through serialized queues (treasury sequence numbers, Hodle nonce: DEC-008).

### DEC-024: Vants Pay v0: one transaction per request, idempotency stored with the response (2026-10-22, T-010)
Context: §5.1 needs quotes and payments that integrators can retry safely, scoped per integrator, with documented error codes.
Decision:
- **Auth:** `x-api-key` (`vk_test_…`), stored as `sha256(pepper:key)`. Unknown or missing → 401 `UNAUTHORIZED`. Other integrators'
  quotes and payments answer 404, never 403, so ids don't leak.
- **Idempotency:** `Idempotency-Key` (1–255 chars) is required on every POST. The lookup takes a transaction-scoped advisory lock on
  (integrator, key), runs the handler, and stores the status and body *in the same transaction* as the quote or payment. Same key and
  body → the first response is replayed byte for byte (errors included); same key, other body → 422 `IDEMPOTENCY_KEY_REUSED`.
- **One transaction per request:** creating a payment inserts the row and publishes `PaymentAccepted` to the outbox atomically (§3.3).
  The api never calls Hodle or Stellar.
- **Quotes:** `br_code` destinations go through `checkBrCodeForPayout`. A code that fixes its own amount wins, and an `amountBrl` that
  disagrees is `AMOUNT_MISMATCH`; an amount-less code needs `amountBrl` (`AMOUNT_REQUIRED`). The funding asset must be in
  `FUNDING_ASSETS` (default: the two testnet USDCs). Price: DEC-007 integers at `QUOTE_RATE_BRL_PER_USD` (sandbox 5.4); TTL 120 s.
  The fee model defaults to `sandbox` (0) until Q8 is answered.
- **Payments:** one payment per quote (unique `quote_id`; `QUOTE_ALREADY_USED` 409); expired quotes → 409 `QUOTE_EXPIRED`. The
  response carries the deposit: the treasury's muxed `M…` address, the `G…` + memo-id fallback, the asset and the exact amount (DEC-004).
- **Schemas:** zod schemas validate requests, generate `/v0/openapi.json` (OpenAPI 3.1, `z.toJSONSchema`), and check every response in
  tests, so the document can't drift from the behaviour.
- **Config:** the api gets `TREASURY_ACCOUNT` (public key only); `TREASURY_SECRET` stays worker-only.
Evidence:
- `apps/api/src/v0/api.int.test.ts` (13 cases, real Postgres): pricing (R$ 12.34 → 2.2851852 USDC), each error code, replay and
  reuse of a key, integrator scoping, the outbox row.
- **Live run (local api, testnet treasury):** `pnpm integrator:create`, then quote → payment → GET over HTTP; the deposit address decoded
  to the real treasury with memo id 1000.
Alternatives: An idempotency cache outside the transaction (a crash between commit and cache write would re-run the request). 403 for
foreign ids (confirms they exist).
Consequences: T-011's saga starts from `PaymentAccepted`. Q8 decides whether demos switch `FEE_MODEL` to `hodle-default`.

### DEC-025: Sagas as pumps over work-list tables; no network call inside a transaction (2026-10-22, T-011)
Context: §3.4 needs payouts and refunds that survive any crash without paying twice (INV-02, INV-10), one Hodle payout in flight
(DEC-008), one treasury sequence number at a time, and nothing left waiting forever (INV-03). A transactional pg-boss handler can't
call Hodle or Stellar safely: a crash after the call but before the commit would forget a payment that happened.
Decision:
- **Work lists in tables, jobs only wake.** `PayoutRequested` adds a `payouts` row; `RefundRequested` and `UnattributedDeposit` add a
  `refunds` row. Each list has one *pump* on a pg-boss `stately` queue (at most one running, one waiting). It works the list oldest
  first and stops at the first item it can't finish, so the order is kept and nothing races.
- **Payout pump.** In one transaction: lock the payment, re-check the BR Code (INV-05), mark it `paying`. Then call Hodle *outside* any
  transaction, always with `externalId = vants:<paymentId>`. Apply the answer in a new transaction.
  - A crash between the steps re-asks Hodle with the same id, which returns the original payout.
  - `settlement_failed`/`invalid_request` → `payout.failed` → refund. Empty float, busy, down, unknown outcome or `PROCESSING` → stop
    and retry later, same id.
- **Refund pump.** Build and sign the envelope, **commit it, then submit it**. On retry: on the ledger → done; landed but failed → set
  aside (`failed`, manual review: e.g. no trustline) and move on; otherwise resubmit the *same* envelope until `maxTime + 30 s`, then
  rebuild (DEC-023). A pending refund holds the ones behind it.
- **Sweep, every minute (cron).** Expires payments 5 min after their quote (`DEPOSIT_GRACE_SECONDS`) and wakes both pumps. This is the
  INV-03 watchdog and replaces per-payment delayed jobs (§3.3 updated).
- **Deposit matcher = the `inbox.pier` consumer.** It records every transfer into the treasury in `deposits` and feeds matched ones
  to `decide` in the inbox transaction (no `DepositObserved` hop). Transfers *out of* the treasury are ignored.
  - Unknown muxed id → `UnattributedDeposit` → refund to the sender with memo tag `u<n>` (§11 Q6 testnet default).
  - No muxed id → recorded as `unmarked`, never refunded: it may be our own top-up.
  - Refunds go back in the classic asset named by a deposit of that payment (`deposits.asset_name`).
- **Hodle payout webhooks** (`inbox.hodle`): matched by `externalId`, else by the payout's on-chain hash (`invoice`).
  `PAYOUT_SUCCESSFUL` confirms (`payouts.confirmed_at`) and completes a payout still in flight; `PAYOUT_FAILED` fails one in flight.
  `PAYOUT_REFUNDED` is logged for review until T-007 records its body (its fields are unverified).
- **Backbone additions:** `enqueue(tx, queue)` (send inside the caller's transaction), `process(queue, handler)` (non-transactional
  worker), `schedule(queue, cron)`, and a queue `policy`. `refundMemo` takes `<n>` or `u<n>` (≤ 28 bytes still holds).
- `pnpm worker` runs the sagas plus the Pier pull every 30 s.
Evidence:
- `apps/worker/src/sagas/sagas.int.test.ts` (23 cases, real Postgres; Hodle and the ledger faked, with the fake ledger reading the real
  signed XDR and enforcing sequence numbers and deadlines):
  - every D5 kind: under, late, wrong asset, unknown mux, over (partial refund);
  - top-ups not refunded; our own outgoing transfers ignored;
  - crashes before submit, after landing, and after Hodle paid; an envelope lost in flight (resubmitted, then rebuilt after its
    deadline); an envelope that lands just after it was looked up;
  - refunds strictly in order; failed-on-ledger set aside; empty float holds the queue in order; BR Code re-checked before paying;
  - the sweep's expiry and wake-ups; Hodle webhooks.
- **Mutation checks:** resubmitting → always rebuilding fails 2 tests; a fresh `externalId` per attempt fails 5.
- `wiring.int.test.ts`: the same flows through real pg-boss (inbox → consumers → pumps), a redelivered Pier event a no-op, the sweep
  scheduled.
- **Live, testnet + Hodle sandbox, 2026-10-22** (local `pnpm api` + `pnpm worker`, Pier pull only):
  - **Exact:** R$ 5.40 BR Code, 1 USDC paid to the M… address (`e0f7be51…a68a`, ledger closed 22:18:27Z) → Hodle sandbox payout
    `SANDBOX0850DF502C794F6AB9B99D293` → `completed` at 22:18:45Z (18 s).
  - **Underpaid:** 0.5 of 1 USDC (`018698e2…412b`, closed 22:19:07Z) → treasury refund `fa8f1571…6b2e` (closed 22:19:47Z, 40 s), memo
    `vants:rf:ru:1`, 0.5 USDC to the payer (checked on Horizon).
Alternatives:
- Per-payment delayed jobs for timeouts and watchdogs: more jobs, and a lost job is a stuck payment.
- Calling Hodle or Stellar inside the transactional handler: a crash after the call forgets it.
- Refunding unmarked transfers: would bounce our own top-ups.
Consequences:
- §3.3, §5.5, §5.6 and Q6 updated.
- T-016 (CCTP refill) also spends the treasury's sequence numbers: it must go through the refund pump's lane (or a shared
  treasury lock), never in parallel.
- A `failed` refund leaves its payment in `refunding` until someone acts: T-015's reconciler should surface it.
- The 30 s Pier pull dominates latency until the Pier webhook is reachable (a public URL).

### DEC-026: Integrator webhooks from the transition log; G-B evidence (2026-10-22, T-012)
Context: §5.2 promises a signed `payment.updated` on every transition, and G-B needs D1, D4 and D5 shown on testnet. The webhook
body must be the `GET /v0/payments/:id` body, but that view lived in `apps/api`, which the worker can't import.
Decision:
- **One read model.** `paymentResource` / `quoteResource` / `depositResource` move to `packages/db/src/resources.ts`.
  - The apps pass in the muxed-address encoder (`depositInstructions`, which needs the SDK).
  - `formatAmount7` moves to `@vants/domain`, re-exported by `adapter-stellar`; `formatBrl` and `formatRate` join it.
  - `GET /v0/payments/:id` and the notifier call the same function.
- **Endpoints.** `POST/GET /v0/webhook-endpoints`, `DELETE /v0/webhook-endpoints/:id` (migration 0004).
  - The `whsec_` secret (32 random bytes) is returned once and stored as given, because it must be readable to sign.
  - Production would encrypt it at rest.
- **Fan-out from `payment_transitions`.** The transition table is the notifier's outbox (new column `notified_at`).
  - The pump marks each transition and inserts one notification per *active* endpoint, in one transaction (`SKIP LOCKED`, so
    concurrent runs split the work).
  - The `webhook-id` is `<paymentId>:<version>`; an endpoint added later gets only later transitions.
- **Delivery** happens outside any transaction, with Standard Webhooks headers, a 10 s timeout and redirects not followed.
  - Retries come after 1, 2, 5, 15, 30, 60, 60 and 60 min; after that the notification is marked failed.
  - At least once: a crash after sending resends the same `webhook-id`.
- **Wake-ups:** every payment event wakes `notifier-pump` (a `stately` queue); a per-minute cron catches retries and transitions
  that emit no event (`paying`).
- **The body is the payment as of fan-out.** A transition fanned out after a later one already happened carries the newer
  state. D1 shows this: the `paying` transition (`:2`) arrived saying `completed`, because `payout.started` emits no event and
  the payout finished within seconds.
  - Receivers should treat the webhook as "this payment changed", not as a per-transition record. This is accepted for v0.
- **`pnpm e2e`** runs D1, D4 and D5 against a running `pnpm api` + `pnpm worker` and writes `docs/evidence/g-b-*.json` (Biome
  leaves evidence files alone).
- **D4 is simulated for both providers:** neither pushes to us yet. Hodle webhooks are unregistered (Q1), and the Pier
  subscription is pull-only, since there's no public URL. The run gives the api throwaway secrets and labels the result
  `simulated`.
Evidence: G-B run 2026-10-22T22:39Z, 10/10 checks (`docs/evidence/g-b-2026-10-22T22-39-27.023Z.json`):
- **D1:** a R$ 2.70 BR Code paid with 0.5 USDC (`29e58bcb…7c65`, closed 22:39:32Z). Hodle sandbox payout
  `SANDBOXEAA502CD16764AEBA931DAC66` completed in 32 s. The `completed` webhook arrived 35.4 s after the deposit, and all 4 webhooks
  verified with the endpoint's secret.
- **D5:** each refunded to the sender, tagged, within 60 s of the deposit's ledger close:
  - underpaid 25 s (`vants:rf:s1:1`);
  - unknown muxed id 15 s (`vants:rf:4lajqu1:u1`);
  - wrong asset (1 XLM, refunded in XLM) 25 s (`vants:rf:s2:1`);
  - late 30 s (`vants:rf:rz:1`).
  The payment-backed cases also got a verified `refunded` webhook.
- **D4 (simulated):**
  - Pier: the genuine envelope delivered twice → 200, 200, nothing changed. A wrong key and a tampered body → 401, 401, nothing
    stored.
  - Hodle: PAYOUT_SUCCESSFUL twice → 200, 200, stored once, payment unchanged. A forged PAYOUT_FAILED → 401; the payment stayed
    `completed`.
- An earlier run the same evening passed D1 and D5 too (refunds at 25 s each), then stopped at D4 because `PIER_WEBHOOK_SECRET`
  is empty. That run wrote no evidence file; the script now always writes one.
- **Tests:** `notifier.int.test.ts` (7, real HTTP receiver, verified with the `standardwebhooks` library) and API endpoint tests
  (5).
  - A mutation that skips marking transitions as notified fails the "endpoint added later" test. It is otherwise masked by the
    `ON CONFLICT` dedupe.
Alternatives:
- A per-transition snapshot stored with each transition: more storage for an ordering guarantee v0 doesn't promise.
- Webhooks driven only by domain events: `paying` has none.
Consequences:
- **G-B is ready for review.**
- D4 still needs a non-simulated run once a public URL (Pier webhook) and the Hodle registration (Q1) exist.
- The notifier posts to any http(s) URL an integrator gives. Production needs SSRF guards (no private ranges) and secret
  encryption.

### DEC-027: T-007 finding: the Hodle sandbox sends no event webhooks for our paths; D4 Pier is now real (2026-10-23, T-007)
Context: Q1 left two questions open: does a USDH test-wallet payout emit `PAYOUT_SUCCESSFUL`, does a settled sandbox deposit emit
`DEPOSIT_ASSET_SUCCESS`, and what do their bodies carry? D4 also ran only against simulated deliveries. The human registered the
five webhooks against the ngrok tunnel (`PUBLIC_BASE_URL`). The treasury's Pier subscription was recreated with a webhook
(`eab114d7…`; the pull-only `9646a3f6…` was deleted because the Pier SDK can't update a subscription).
Decision / findings:
- **The registration works end to end.** Hodle's dashboard sent a `WEBHOOK_TEST` validation ping (`Webhook-Validation/1.0`) to
  each URL, and all got 200.
  - Each ping verifies offline with *its own* event's secret and with no other, using our `verifyHodleSignature`. That proves the
    HMAC scheme against Hodle's real signatures, not only the docs, and proves the secret-to-event mapping.
  - Real requests also carry `X-Webhook-Event` and `X-Webhook-Id` (for the ping, `test-validation…`), headers not in the docs we
    used.
- **No event webhooks.** A USDH payout (`pay_fd8c901d…`, completed by the 202) and a settled R$ 1.00 sandbox deposit (trackId
  `1359b2ee…`, `settled: true`) produced no PAYOUT_* or DEPOSIT_* delivery: none within 120 s, none 5 min later, none on any path
  through the tunnel.
  - So T-007's answer is "not emitted", and the event bodies stay unverified (Q11).
  - No design change is needed: §3.6 already treats the sandbox 202 as final, and Q1's fallback (the balance poll for the refill
    credit) stands.
  - The payout-webhook watchdog stays off.
- **D4, Pier half, now real.** The genuine Pier delivery of the probe's deposit, captured by ngrok, was replayed byte for byte twice
  (200, 200) through the public URL, 133 s after the original: no inbox, deposit, refund or payment change. A tampered copy got 401.
- **D4, Hodle half, stays simulated** for its replay part. The verification part is now proven on real signatures. The sandbox
  never sent an event to replay, and a replayed `WEBHOOK_TEST` is a no-op by design.
- `pnpm probe:webhooks` reruns all of this. What the sandbox does is recorded as *observations*; only our own behaviour is a
  pass/fail check.
Evidence: `docs/evidence/t-007-2026-10-22T22-58-17.873Z.json` (this run's T-007 answers appear there as FAIL checks: the script
was changed afterwards to record them as observations) and `docs/evidence/t-007-validation-pings.json`.
Alternatives: polling `GET /api/wallet/payout/:id` for confirmation (closed to our key, 403; needs `WALLET_PAYOUT_API`, Q2).
Consequences:
- T-016 confirms the float credit by polling `GET /api/wallet?sync=true`; the webhook path is built and verified, ready if Hodle
  starts emitting.
- D4 is real for Pier; for Hodle it is real for verification and simulated for replay until Q11 is answered.
- Keep ngrok (`ngrok http 3100`) running while the sandbox should reach us.

### DEC-028: Books posted with their events, opened from live balances, reconciled every 5 minutes (2026-10-23, T-015)
Context: INV-06 and D7 need the ledger to equal Horizon (treasury) and the Hodle sandbox (float). T-005 defined postings only for
payment events. Money also moved with no posting: unattributed deposits and their refunds, top-ups, and the XLM fee of every
refund. And nothing had opened the books. §3.7 also wanted the float reserved at FUNDED and checked at acceptance.
Decision:
- **Postings in `publish`.** Each event's `postingsFor` entries are inserted in the event's own transaction, so a committed event's
  entries sum to zero per asset, and a rolled-back one leaves none. No posting consumer, no lag.
- **New money events.**
  - `LedgerOpened`: each live balance against `capital`.
  - `TreasuryCredited`: an unmarked transfer (no muxed id) is a top-up, booked to `capital`.
  - `UnattributedDeposit` is held in `clearing:<deposit id>`; its `RefundSent` now carries the SAC id and clears it.
  - `TreasuryFeePaid`: the fee a landed refund envelope actually paid. `feeCharged` comes from RPC `getTransaction`
    (`resultXdr.feeCharged`, a `bigint` in SDK 17.3); failed envelopes pay too (CAP-0022). It is read before the refund is marked
    sent, so a failed read leaves the refund to retry.
- **Opening.** At startup the worker opens the books once (advisory lock) from Horizon and Hodle balances. The opening should
  happen while no payment is in flight; one that is gets a non-zero clearing account.
- **Float.** The float consumer reserves `payoutDebit6(quote)` on `PayoutRequested` and releases it on `PayoutCompleted` or
  `PayoutFailed`.
  - `available = float ledger − open reservations`.
  - The api answers 409 `FLOAT_UNAVAILABLE` when a new quote or payment exceeds it, or when the books aren't open (fail closed).
    It's a soft check: reservation happens at FUNDED, as §3.7 says.
  - `FloatLow` is emitted once, when a payout takes the balance below `FLOAT_MIN_USD` (default 10). `FLOAT_TARGET_USD` (default 25)
    is the refill target, carried in the event as `topUp6`.
- **Reconciliation.** Every 5 min (cron, stately queue) and via `pnpm reconcile`:
  - each treasury asset vs Horizon, and the float vs `GET /api/wallet?sync=true`;
  - a difference is `mismatch` the first time (money in flight) and `drift` when the same difference repeats; `drift` emits
    `ReconciliationDrift` and logs;
  - each pass also counts failed refunds, failed notifications and reservations open over an hour (DEC-025's review items).
Evidence:
- **Tests:** domain postings (3 new), backbone posting atomicity (1), saga-level books, float and reconciliation (9, with
  per-flow deltas against independent tallies of the fakes), API float check (1).
  - Mutations caught: dropping the fee posting fails 2 tests; never releasing reservations fails 2.
- **Live, 2026-10-22 23:16–23:20Z** (`docs/evidence/d7-2026-10-22T23-20Z.json`):
  - The worker opened the books (2.5 USDC, 10,004.5801267 XLM, 22.129634 USDH), and the baseline reconcile was 0 everywhere.
  - `pnpm e2e` then ran D1 and D5 ×4 (8/8, `g-b-2026-10-22T23-16-54.786Z`).
  - Reconcile after it was again 0 everywhere: USDC +0.5 (D1 kept, refunds returned), XLM −400 stroops (4 refund fees),
    USDH −0.5 (D1's payout).
  - Ledger entries sum to 0 for every asset.
- With Pier pushing through the tunnel, the D5 refunds landed **10 s** after the deposit (was 15–30 s on pull).
- That run's D4 Pier half used the real Pier secret: replays 200/200, forgeries 401/401.
Alternatives:
- A posting consumer: an eventually-consistent ledger that reconciliation would race.
- Ignoring XLM fees: XLM would drift by 100 stroops per refund.
- Reconciling only stablecoins: misses wrong-asset XLM deposits and fees.
Consequences:
- **D7 is shown.**
- T-016 must post its own money movements, so reconciliation stays at zero: the CCTP burn from the treasury, its fee, and
  `FloatCredited` on the float.
- Probe scripts that touch the sandbox balance directly (e.g. `probe:webhooks`'s sandbox deposit) will show as drift until
  explained.

### DEC-029: The refill saga: CCTP to Base, an exact sandbox credit, every leg booked (2026-10-23, T-016)
Context: D6 needs the float refilled while payments continue (§3.7). The spike proved CCTP Stellar → Base (8/8, about 11 s) but
as a script that kept state in a JSON file. T-007 found the sandbox sends no deposit webhook. T-015's books must stay at zero
through every leg.
Decision:
- **One refill at a time** (a partial unique index on `refills`), advanced phase by phase by a `stately` pump. It is woken by
  `FloatLow` and by a per-minute cron, so a missed event or an expired cool-down still refills a low float.
- **Size:** `min(target − float, CCTP_CAP_USD (default 1), USDC the treasury owns)`, rounded down to an exact sandbox credit.
  "Owns" means treasury USDC minus what the clearing accounts say is owed to open payments and refunds.
- **Phases and why each is safe to retry:**
  - **approve and burn:** treasury envelopes through the shared `landOnce` (extracted from the refund pump: persist, then
    submit, resubmit until the deadline, rebuild after). The refund pump and the refill hold a named advisory lock
    (`treasury-signer`, `Backbone.withLock`) while building, submitting and waiting, so they don't race for sequence numbers.
  - **attest:** reading Iris.
  - **mint:** the CCTP nonce. A used nonce means it already minted, so a crash after broadcasting never mints twice.
  - **credit:** an unsettled sandbox deposit credits nothing, and settling is idempotent per `trackId`. The deposit is refused
    before settling unless it is priced at the configured rate with fee 0.
  - **The amount is exact.** Hodle answers a deposit with its rate, not the USDH credited, so the refill only asks for credits
    that are exact at the rate: `exactUsdhDeposit`, multiples of 27 cents at 5.4. The balance poll then confirms the credit to
    the unit: Hodle − books = the pending credit.
- **Postings:**
  - `CctpBurned`: treasury → `bridge:cctp`.
  - `CctpMinted`: bridge → conversion → `base:wallet` in `USDC@base-sepolia` (6 decimals). The CCTP fee stays in conversion.
  - `FloatCredited`: `sandbox:standin` → `float:hodle`.
  - `TreasuryFeePaid` for both Soroban transactions, at their real charged fee.
- **The reconciler also compares `base:wallet` with the mint recipient's USDC on Base.**
- **The CCTP adapter is ported from the spike** (addresses, units, Iris, the Stellar builders, the Base minter). It builds and
  signs envelopes but never submits them; startup checks the USDC SAC against its issuer and that the Base RPC is Base Sepolia.
  The Stellar contract ids were re-checked against Circle's page on 2026-10-23.
Evidence:
- **Tests:** 7 refill cases (fakes: the ledger lands real signed envelopes; CCTP with held attestations and crash-after-mint; the
  sandbox float). They cover the happy path with books per leg; attestation pending while a payout completes; crashes after the
  burn landed, after the mint was broadcast, and after settling; a wrong deposit rate; and a burn that fails on the ledger,
  followed by the cool-down.
- **Mutations caught:** ignoring the nonce fails the crash-after-mint test; a new deposit on every retry fails the
  crash-after-settle test. Also `exactUsdhDeposit` property tests, CCTP unit tests ported from the spike, and backbone lock tests.
- **Live D6, 2026-10-22 23:39–23:40Z** (`docs/evidence/d6-2026-10-22T23-39-36.309Z.json`). The worker ran with
  `FLOAT_MIN_USD=21.5`, `FLOAT_TARGET_USD=22.5` (env, just below the float).
  - Payment A's payout took the float under the minimum, and `FloatLow` followed 1 s later.
  - The refill bridged 1 USDC in 24 s: approve 5 s, burn 5.5 s (`04b8660c…`), attestation 6 s, mint on Base 1.5 s
    (`0xc799f50f…`, minted 1.000000, fee 0), then the credit 5.5 s (R$ 5.40 → exactly 1.000000 USDH, confirmed on the first
    balance read).
  - Payment B, paid during the refill, completed while it was still waiting for Circle.
  - `pnpm reconcile` after: 0 on all five accounts, including `base:wallet` = 1.000000 USDC on Base.
  - Treasury XLM fell by exactly the two Soroban fees booked (25,571 + 14,235 stroops).
- **Setup:** 0.01 Base Sepolia ETH was moved from the spike's EVM account to the PoC's for gas (tx `0x15490246…`).
Alternatives:
- Funding the float from the bridged USDC directly: impossible in the sandbox (USDH only; HODLE_PLAN Q5).
- A separate lock-free refill lane: sequence collisions would delay refunds past D5's 60 s.
- Polling the balance without an exact amount: concurrent payouts make the delta ambiguous.
Consequences:
- **D6 is shown.**
- The PoC holds Base USDC that grows with each refill. Rebalancing back to Stellar (via the CctpForwarder) is out of scope, as in
  the spike.
- A failed burn leaves the float low until the 15-min cool-down ends. A credit that never confirms keeps the refill active, with
  the reason in `last_error`, and blocks the next one; the reconciler shows the difference.
- Base gas is not booked (ETH isn't a ledger asset).

### DEC-030: Portfolio = spendable amounts, priced honestly; DeFindex valued by the vault's own maths (2026-10-23, T-018)
Context: §3.5 and §5.3 need, for a connected account, every position it could pay from, what it is worth, and what exiting it
takes. `earlier prototype` says synthetic or estimated numbers must be labelled, and an unpriced position must not be signable.
Decision:
- **Spendable, not balance.**
  - Classic assets count their balance minus selling liabilities.
  - XLM also loses the account's minimum balance, `(2 + subentries + sponsoring − sponsored) × 0.5 XLM` (Stellar docs,
    Accounts), and a 1 XLM buffer for the exit's own fees.
  - Empty and dust positions are left out.
- **Pricing.**
  - The funding assets (the two testnet USDCs) are `par`.
  - XLM is `estimated` from a live Horizon strict-send path of its whole spendable amount into the first funding asset, so the
    quote includes depth. With no path it is `unpriced`.
  - Every other asset is `unpriced`.
  - `payable` is false for anything unpriced.
- **DeFindex** (`usdc_paltalabs_vault`, Blend USDC): shares are read by simulation; value = `underlyingForShares` (rounded down)
  and, for T-019's exact withdraw, `sharesForUnderlying` (rounded up). Both are ported from the spike with its tests, plus a
  property test. The vault's `get_asset_amounts_per_shares` exists and is used as a live cross-check.
- **Exit cost** = transactions the wallet signs:
  - funding asset: 1 (the transfer);
  - vault: 2 (exact withdraw + transfer);
  - XLM: 2 (swap + transfer, 100 bps slippage, estimated).
  T-019 plans them.
- The reader is pure logic over a `PortfolioSources` port, with live sources in `apps/api/src/app/sources.ts` (Horizon + Soroban
  simulation, read-only, DEC-016). Contract ids were re-checked against `paltalabs/defindex` `testnet.contracts.json` on
  2026-10-23.
Evidence:
- Unit tests (6 portfolio, 1 amount parsing, 4 vault maths incl. a property).
- **Live 2026-10-23** (`docs/evidence/t-018-vault-maths.json`): our maths equals the vault contract's
  `get_asset_amounts_per_shares` for 4 share amounts (the vault is at 1:1 right now: all idle, no yield).
- **Live portfolio of the spike's DeFindex user** (`docs/evidence/t-018-portfolio-defindex-user.json`):
  - 705 Blend USDC (par) and 171.2611105 vault shares = $171.26;
  - 9,995.5 spendable XLM ≈ $8,771 (estimated; testnet SDEX prices are arbitrary);
  - BLND, wBTC and wETH listed as unpriced and not payable.
Alternatives:
- The DeFindex API: its testnet indexer was down in the spike.
- Pricing XLM from an oracle: no reliable testnet feed, and the swap the exit performs is what the user will actually get.
Consequences: T-019 builds the steps from these positions; T-020 serves `GET /app/portfolio` behind SEP-10.

### DEC-032: Mini-app backend: SEP-10 to the letter, one shared payment service, submit only the planned transaction (2026-10-23, T-020)
Context: §5.3 and DEC-011 call for SEP-10 login via the wallet's `signTransaction`; DEC-031 makes every payment one transaction.
The mini app must follow the rail's rules exactly (BR Code validation, float, outbox) without a second copy of them.
Decision:
- **SEP-1/SEP-10** (stellar-sdk `WebAuth`, checked against SEP-10 on 2026-10-23):
  - `/.well-known/stellar.toml` publishes `NETWORK_PASSPHRASE`, `WEB_AUTH_ENDPOINT` and `SIGNING_KEY`. That key is a dedicated
    keypair (`WEB_AUTH_SIGNING_SECRET`), never the treasury.
  - Challenges are valid 15 min. The server enforces that deadline itself, because the SDK grants 5 extra minutes for clock skew.
  - An existing account must reach its **medium** threshold (`verifyChallengeTxThreshold`, multisig-aware); an account not yet
    on the network signs with its master key only.
  - **One JWT per challenge** (`auth_challenges`).
  - Optional `client_domain`: the host wallet's `SIGNING_KEY` comes from its stellar.toml (HTTPS, 5 s timeout), and its signature
    is required too. The JWT carries `client_domain`.
  - Only G… accounts; M… and C… (SEP-45) stay out of the PoC.
  - CORS `*` on discovery and `/auth`, per SEP-10.
- **JWT:** HS256 with `node:crypto` (`JWT_SECRET`), 15 min, with `iss` = `https://<home>/auth`, `sub` = account, `iat`, `exp`,
  `jti` = the challenge hash. Only HS256 is accepted, compared in constant time.
- **One payment service** (`apps/api/src/payments-service.ts`), extracted from the v0 routes. v0 and `/app` create quotes and
  payments through it. Mini-app payments belong to a built-in integrator (`int_vants_mini_app`), with `refundTo` set to the
  user's account.
- **Exits:**
  - The asset is the first pick's (XLM is swapped into the first funding asset).
  - The planner runs before anything is written: a refusal (422) creates no payment.
  - The transaction's deadline is `min(quote expiry, now + 5 min)`, so a signature that comes too late simply can't land
    (no late deposit to refund).
  - Submit accepts only the planned hash, signed, before its deadline, and sends it once.
- The network sits behind `AppPorts` (fakes in tests; Horizon, RPC, DeFindex and stellar.toml in `pnpm api`).
- `/app/*` is on when `PUBLIC_BASE_URL`, `WEB_AUTH_SIGNING_SECRET` and `JWT_SECRET` are set.
Evidence:
- **Tests:** 13 integration tests (real Postgres, real keys and signatures):
  - stellar.toml;
  - challenge and token; master-key-only for a new account; multisig medium threshold;
  - replay refused; expired refused; `client_domain` requires the host wallet's signature; G… only;
  - `/app` without a token refused; portfolio and price;
  - exit → submit (unsigned 400, wrong transaction `PLAN_MISMATCH`, signed 202, repeat 200, sent once); another account's exit
    404; a refused plan creates no payment; unknown fields refused.
  Also 3 JWT tests. The v0 suite passes unchanged on the extracted service.
- **Live 2026-10-23 00:12Z over the public URL** (`pnpm app:smoke`, `docs/evidence/t-020-app-2026-10-23T00-12-37.114Z.json`):
  stellar.toml → challenge (server signature verified by the client) → JWT → portfolio → price → exit (classic: swap ≤ 0.575429 XLM
  → 0.5 USDC, pay 0.5 USDC) → 1 signature → 202 → payment completed 11 s later. Reconcile 0 on all five accounts.
Alternatives:
- `jose` for JWTs: a dependency for 40 lines of HS256.
- Per-step submit endpoints (DEC-009): superseded by DEC-031.
- An idempotency key on `POST /app/exits`: a duplicate only leaves an unused payment, which expires.
Consequences:
- T-021 builds the web app on these endpoints.
- **Wallet tests with Freighter, xBull and LOBSTR (WalletConnect) need the human**, at T-021/D2. So does Q5: whether LOBSTR signs
  `client_domain` challenges.

### DEC-033: The mini app web: Wallets Kit v2, served by the API, designed for the counter (2026-10-23, T-021)
Context: T-021 puts a face on DEC-031 and DEC-032: connect, sign in, scan, price, pick, sign once, receipt.
Decision:
- **Wallets:** Stellar Wallets Kit **2.7.1** (npm `@creit.tech/stellar-wallets-kit`, released 2026-10-07).
  - `StellarWalletsKit.init({ modules: defaultModules({ filterBy }), network: TESTNET })`, `authModal()`, and
    `signTransaction(xdr, { networkPassphrase, address })`.
  - `defaultModules()` brings Freighter, xBull, LOBSTR (extension), Albedo, Hana, Rabet and others. MetaMask's Stellar
    module is filtered out (`productId !== "metamask"`): on load it tries to restore a session and logs a timeout when there
    is none.
  - WalletConnect (LOBSTR mobile) needs a WalletConnect project id, so it isn't wired yet (Q12).
  - The kit's WalletConnect stack wants install scripts (`@reown/appkit`, `bufferutil`, `utf-8-validate`, `secp256k1`); they stay
    off in `allowBuilds`, since all have JS fallbacks.
- **Login:** Connect reads `/.well-known/stellar.toml` and checks the SEP-10 challenge with `WebAuth.readChallengeTx` (server key
  and home domain) before asking the wallet to sign it, as SEP-10 asks of clients. The JWT is kept in memory only.
- **Flow, one decision per screen:**
  - Scan (`qr-scanner` 1.4.2, camera optional; pasting "copia e cola" always works) → Pick (price first: R$, payee, cost in USDC
    and the rate; positions tapped in order).
  - **Estimated** values are tagged; unpriced positions show **sem preço** and are disabled. (XLM with the vault was flagged
    here until DEC-034 made it payable.)
  - Review: the ONE transaction in pt-BR words from the API, plus a countdown to its deadline → the wallet signs → submit.
  - Receipt: live status (signed, received, sending the Pix, paid; or returning, returned), with the Pix E2E id and an
    explorer link.
  - The transaction summaries are now pt-BR at the source (`exit-tx.ts`).
  - **XLM alone → one `pathPaymentStrictReceive` straight to the `M…` address**, so a first-time wallet holding only Friendbot XLM
    (no USDC trustline) can pay. XLM mixed with a balance still swaps to self, then pays. Mini-app payments carry
    `refundTo` = the user, so a refund never goes to the market maker who delivered the USDC.
- **Design** (`PRODUCT.md`, written with the human through the impeccable teach flow on 2026-10-23):
  - Register: product.
  - Scene: at the counter, in daylight; personality calm, precise, honest (Wise and Nubank as references).
  - Anti-references: neon crypto, dense DeFi dashboards, navy-and-gold banking.
  - Look: light warm paper neutrals in OKLCH, one ultramarine accent for actions and selection, status always in words plus
    colour, system font with tabular numbers, primary action pinned under the thumb, and reduced motion respected.
- **Serving:** the API serves `apps/web/dist` at `/` (`apps/api/src/web.ts`) on the same origin as `/auth` and `/app`, so the
  tunnel URL is the whole app.
  - It guards against path traversal and never answers an API path with the app.
  - `index.html` is `no-cache`; hashed assets are immutable.
- **Preview:** `apps/web/preview.html?screen=pick|review|receipt` (Vite dev only) renders the screens with testnet fixtures.
Evidence:
- `web.test.ts` (3: serving, caching, API paths and traversal).
- **Headless Chrome at 390×844 over the public URL:** the app loads with no console errors, and "Conectar carteira" opens the kit
  listing Albedo, xBull, Freighter, LOBSTR and the others.
- **Every screen rendered with fixtures and reviewed.** Fixes from that review: a contradictory "cobre o valor inteiro" next to
  the mixed-routes note; English transaction summaries; a selected row losing its colour on hover; spacing above the pinned
  actions.
- The backend under these screens ran live end to end in T-020 (`pnpm app:smoke`).
- **A brand-new Friendbot account** (XLM only, no trustline) paid R$ 2.70 in 1 operation and 1 signature over the public URL
  (`SMOKE_FRESH=1 pnpm app:smoke`), completed 13 s after submit (`docs/evidence/t-020-app-2026-10-23T00-38-18.375Z.json`).
  Reconcile 0 on all five accounts.
Alternatives:
- A UI kit: fights the calm, specific look and adds weight.
- A separate web host: CORS, and a second public URL for wallets.
- A test-only wallet hook in the bundle: would test a different app than the one users get.
Consequences:
- **D2 needs the human with a real wallet** (see "D2 test" in §8).
- G-C closes when D2 is recorded (D6 is done).
- WalletConnect for LOBSTR mobile is Q12.
- The main chunk is about 216 kB gzipped (Stellar SDK + kit); code-splitting is a later optimisation.

### DEC-034: XLM with a vault in one signature: an AMM leg inside the exit router (2026-10-23, T-022)
Context: The human (2026-10-23): "why I cannot pay using xlm and defindex vaults shares at the same time? find a way to fix it".
DEC-031 refused the combination:
- a Soroban transaction holds one operation (SOURCES), so the classic path payment can't share a transaction with the router
  call;
- a contract can't reach the classic order book.
Decision:
- **The XLM leg moves inside the router call, as a Soroban AMM swap.** `pay(from, vault?, shares, min_out, swap?, token, amount,
  to)`: withdraw, then `swap_tokens_for_exact_tokens(amount_out, amount_in_max, path, from, deadline)` on a Soroswap router,
  then the exact transfer to `M…`. All atomic, one authorization by the payer.
  - The router checks the swap's path ends in the payment token and both amounts are positive (`InvalidSwap`); it stays
    stateless and holds no funds. The AMM router address comes from the API and is visible in what the wallet signs.
  - Redeployed as `CAAQ3E4AQK7P53T6QSUTPDS3UIBS267CT53BPFHTNQKEZNUGTO5RADPB` (wasm sha256 `204aaeee…449c`, tx `760abf8b…056f`,
    deployer `GDOHO27R…VN43`); `EXIT_ROUTER_CONTRACT_ID` updated. The old router (`CC3UZVNR…25ZY`) is unused.
- **The rail doesn't change:** Vants still receives exactly the quote asset in one deposit. The user bears the swap's price and
  slippage (100 bps over the AMM's own `router_get_amounts_in` quote), as on the classic route.
- **Planner:** XLM with a vault is a router plan with `swap: { receive7, slippageBps, spendable7 }`, in the user's order. XLM picked
  first pays in the first funding asset when it covers the amount alone (classic, later picks untouched); otherwise in the asset
  of the first pick that isn't XLM (XLM, then the vault, pays in the vault's asset). This keeps XLM-only payments off thin
  testnet order books (Blend USDC: about 7,900 XLM for 50 USDC on the SDEX).
- **Builder:** prices the leg on Soroswap (`router_get_amounts_in`, simulated). If the limit exceeds the account's spendable XLM, it
  refuses with 422 `EXIT_BLOCKED` `shortfall` (the payment just created is never funded and expires with its quote).
- XLM without a vault stays classic: the order book is deeper on testnet, and it needs no Soroban fees.
- Testnet: Soroswap router `CCJUD55A…7BRD`; pairs XLM/Blend USDC (`CBR76WMT…YM3V`, about 1,765 USDC + 7,605 XLM) and XLM/Circle
  USDC (`CCBX3NZT…7RQS`, about 419k USDC) on 2026-10-23. Testnet AMM prices are unrelated to the order book's (Blend USDC costs
  about 4.3 XLM on Soroswap; Circle USDC about 1.14 XLM on the SDEX), so the XLM position's estimated value (order book) can
  overstate what it buys on the AMM; the builder's check catches it.
Evidence:
- Router: 10 Rust tests with a mock Soroswap (fixed price, input taken from `to` under its auth): withdraw + swap + pay; one
  authorization with nested `withdraw`, `swap_tokens_for_exact_tokens`, `transfer`; a swap above its limit undoes the withdraw;
  bad swaps refused. Clippy clean.
- Planner: XLM after the vault and XLM before it (12 tests). API: XLM first + vault pays in the vault's asset via the router;
  a build refusal is 422 `shortfall` (16 tests).
- Live (`pnpm exit:smoke`, 2026-10-23 01:03Z): see §8.
Alternatives:
- Vants accepts XLM as a second deposit and swaps it on the treasury's side: changes the rail (two assets per payment), and Vants
  carries the FX risk.
- Two transactions: breaks "one signature per payment".
- Soroswap's aggregator (routes across Soroswap, Phoenix, Aqua): better prices on mainnet; one more contract to trust. Later.
Consequences:
- Payments mixing XLM with a vault cost Soroban fees and depend on AMM liquidity for the asset.
- The D2 test can now pick XLM and the vault together.

### DEC-035: The mini app as a real app: per-position amounts, a lasting session, the Vants design system (2026-10-23, T-023)
Context: The human (2026-10-23): "The user needs the ability to choose how much of each position he wants to liquidate to pay the
bill. Create a nice UX for it. Use the new Vants design system that i created on claude artifacts. Also lets make this a more
real app. I need a home, need the wallet to keep connected after it was connected first time, need the transactions list".
Decision:
- **How much from each position.** A pick may carry `amount` (quote-asset units). The planner takes exactly that from the
  position, in the user's order; above the position's balance (or ≤ 0) is `over_position`; amounts that don't reach the total
  are `shortfall`; more than the total is trimmed in order. Plain ids keep the old "use as much as needed" meaning.
  - The app works in reais to the centavo and converts at the quote's own ratio (`apps/web/src/allocation.ts`, tested): a
    position's ceiling rounds down, so it never converts to more than it holds; a covered allocation sums to the asset total
    exactly, the rounding remainder going to a position with room for it.
  - The screen can't build what one signature can't pay: shares never pass the bill or a position's ceiling, and stablecoins
    don't mix (Circle and Blend USDC are different assets; XLM goes with either).
  - UX: the price card with a segmented meter ("Faltam R$ …" until "Valor completo"); tapping a position fills what's left;
    each chosen position has an amount field in R$, a slider, "Completar"/"Máximo", and its equivalent (USDC, XLM estimated,
    vault shares); the primary action reads "Faltam R$ …" until the bill is covered.
- **A session that lasts.** The SEP-10 token now lives 7 days (was 15 minutes) and is kept in `localStorage`; the Wallets Kit
  already remembers the wallet and address there. A returning user lands on the home screen; when the session ends, the
  welcome screen offers "Continuar como G…" with the remembered wallet (one signature). A 401 or a wallet disconnect signs
  out. Risk accepted for the PoC: the token reads balances and history and plans payments, but can't move money (INV-09).
- **A real app.** Hash routes (refresh and back work): welcome, home (balance in R$, assets, recent payments), pay (scan → allocate →
  review), activity (`GET /app/exits`, by day, paged), receipt (live timeline, E2E id, copy), account (address, wallet,
  session end, light/dark/auto theme, disconnect). A web manifest and the app icon. Payees with placeholder names ("N", as some
  bank apps generate) show the masked Pix key.
- **The Vants design system** (claude.ai artifact `QaWZRrMk8RsmxTWFRSpJrD`, version 1792715528-5714) replaces the T-021 look:
  `tokens.css` generated from its `tokens.json` (light and dark), its three variable fonts, and its Logo, Icon, Button and
  Badge ported to React with its `bundle.css` classes. Its rules hold: blue is action, green is only yield (the vault's
  "Rendendo" badge and the yield button on the dark balance card), status is a word plus a tone.
Evidence:
- Planner 15 tests (chosen amounts, over_position, trimming); API 19 (amount picks, the list with cursor paging and isolation,
  7-day token, rate); allocation 6. Gates: test ✓ (217), test:integration ✓ (99), build ✓.
- Every screen captured at 390 px in light and dark through `apps/web/preview.html` (the real app over fixtures), no console
  errors; the built app live through the public URL with the human's account: home, activity and a receipt from real data, the
  three fonts loaded, no failed requests.
Consequences:
- The human's next D2 run can split a bill across positions.
- PRODUCT.md's look section now points at the design system.
- Fonts add about 330 kB (served once, `font-display: swap`); the main chunk is still the SDK and the kit.

### DEC-036: Light only, and the app-screen rules (2026-10-23, T-024)
Context: The human disliked the dark theme and asked for light only, improved with the "taste" skill (`leonxlnx/taste-skill`,
read from GitHub as reference, not installed) and impeccable.
Decision:
- **Light only.** `tokens.css` keeps the design system's light values; the dark blocks, the theme switch and its storage are
  gone (a stored choice is cleared on load).
- **Taste's app-screen rules, inside the brand:**
  - no blur glass, gradient fades, shimmer or shadows on resting cards: opaque bars with a 1px line, flat loading bars at the
    size of what lands;
  - no uppercase eyebrows or 01/02/03 numbering: the flow's step ("2 de 3") sits in the top bar, the welcome's numbered steps
    became a real fragment of the product (a bill split between the vault and XLM);
  - monospace only on figures (the design system's money face), every word in Manrope;
  - no icons in discs down lists: payments show the merchant's initials, the review shows plain icons;
  - one status mark per object (the receipt's redundant badge went).
- **A face only Vants has:** each asset keeps one colour on every screen (green only for the yield vault, steps of the brand
  blue for the rest). Home leads with the balance as type, a composition bar of where that money sits, and the asset list as
  its legend (share and swatch per row); the pay screen's meter uses the same colours.
Evidence: every screen at 390 px through the preview (three look rounds, no console errors). The taste inspector scripts were
not run (third-party code); the critique was done on the screenshots against its rules.

### DEC-037: The app as designed on the canvas: QR code and Pix key, one engine (2026-10-23, T-025)
Context: The human disliked T-024 and asked for a full refactor via Claude Design, inspired by modern global-account apps (Arc,
Wise, Revolut), then: "i may want to pay a QR Code or send to a pix key. you need to consider both scenarios." The canvas
https://claude.ai/artifact/CZcd1mf5QpfraQpwSdggjx (11 boards, the Vants design system installed) was approved: "implement it".
Decision:
- **Two ways in, one flow:** QR code (camera or copia e cola) → amount only when the code has none → split → review → receipt;
  Pix key → amount → split → review (with "confira a chave": no name is known before paying) → receipt. A QR code / Chave Pix
  switch at the top; Home's actions are Pagar QR, Chave Pix, Extrato. The backend already paid keys (quote + payout); nothing
  new in the rail.
- **Keys:** `@vants/pix` `key.ts` detects the kind as typed (11 digits are a CPF when the check digits hold, else a mobile),
  normalises to the directory's form and masks for display; the API enforces it (`INVALID_PIX_KEY`), the app uses the same
  code. Keys paid before are offered from the history.
- **Amount:** bank-style entry from the cents on the app's keypad (or a keyboard), with R$ 50/100/200 shortcuts, capped by
  `GET /app/limits` (what the float covers now).
- **Look (the canvas):** the balance as one centred Bricolage figure with grey cents, round quick actions, soft white cards
  (24 px) on the pale ground, one colour per asset (green only for the vault), merchant initials, step dots in the flow header,
  a pinned action dock, a receipt card with timed steps, "Pago com 1 assinatura" breakdown, copy and share. Merchant names from
  QR codes are shown in title case.
Evidence:
- Tests: pix keys 17; API 21 (key quote and refusal, limits, list picks and month summary); gates test ✓ (234),
  test:integration ✓ (101).
- Every screen and both flows at 390 px through the preview, no console errors.
- Live (2026-10-23): a R$ 5,40 Pix to the key "(11) 98765-4321" (stored `+5511987654321`) from XLM, 1 signature, completed in
  12.6 s, E2E `SANDBOX6551F451002041B28112F70C7`; reconcile 0.
Consequences: the canvas is the reference for the UI; changes start there.

### DEC-038: Investing and adding money: actions are one signed transaction too; Etherfuse server-side, sandbox only (2026-10-23, T-026)
Context: The human asked (2026-10-23) to "integrate onramp via etherfuse. and investiments on defindex", with "never use
cripto jargon, very friendly". Keys for both APIs were already in `earlier-prototype/.env.local`; they were copied into the
git-ignored `.env` without being printed.
Decision:
- **Actions.** Investing, taking out and accepting an asset are `app_actions` (migration 7): the server builds the transaction
  (`money-tx.ts`), stores its hash and deadline, and `/app/actions/:id/submit` accepts only that hash, signed, before the
  deadline, exactly like an exit (INV-09). The status is read from Stellar RPC `getTransaction`.
- **Investing.** The DeFindex testnet USDC vault (Blend USDC) and XLM vault (native) are the offer (`INVEST_VAULTS`); deposit
  with `invest=true` and a 0.5% minimum; withdraw burns the shares that cover the amount (rounded up), never more than held.
  The yield shown is DeFindex's `GET /vault/{id}/apy?network=testnet`, labelled as DeFindex's and never as a promise. The XLM
  vault is valued in the portfolio (via the XLM price) but is not payable for Pix yet.
- **Adding money.** `@vants/adapter-etherfuse` (sandbox host only; the config and the client refuse any other host). The
  person's details go to Etherfuse once; Vants stores the customer and bank-account ids, name and e-mail. Quotes are held per
  account for their 2 minutes so the order is placed at the price shown; an order needs the asset's trustline first, offered
  as one action. Targets: Circle testnet USDC (spendable for Pix at once) and TESOURO (shown as an estimate at the quoted
  BRL rate, not payable).
- **Honesty about the sandbox.** Etherfuse's sandbox gives no Pix code for BRL orders (it answers with STP deposit details) and
  stops at `funded`; the app says so ("o código do Pix ainda não chegou do parceiro", "no modo de teste, o parceiro às vezes
  não conclui esta etapa") and links Etherfuse's status page.
Evidence:
- Tests: Etherfuse client 4, config 20, portfolio 8 (TESOURO estimate, XLM vault), money routes 6 (integration: deposit,
  submit checks, status to done, over-balance, redeem shares, profile → quote → trustline → order → simulate, expired and
  foreign quotes), summary words 1.
- Live (2026-10-23, `pnpm money:smoke`, a fresh Friendbot account over the public URL): invest 10 lumens, confirmed in 7.3 s
  (`0eaf0476…`), take 4 out in 2.1 s (`32349e38…`), 6 left invested; Etherfuse details once (3.2 s), R$ 50 → 9.8764943 USDC
  (fee R$ 0,10), accept dollars in 5.5 s (`008c5be1…`), order `be075ac2…` created and simulated paid → `funded`, no delivery
  within 4 minutes, no Pix code from the sandbox (`docs/evidence/t-026-money-2026-10-23031922.json`).
Consequences: the ramp is demo-grade until Etherfuse's sandbox delivers; production would need Etherfuse's production
onboarding (real documents, not the placeholder JPEG), a webhook instead of polling, and a decision on who pays the reserve.

### DEC-039: Plain words, photographs and motion (2026-10-23, T-026)
Context: The same request: a visual refactor with the taste skill (read as a reference, not installed or run), motion, the
missing pages, "full width images, people, a very professional style", and the Vants voice from the other Vants projects.
Decision:
- **Voice** (PRODUCT.md "Voice"): Dólar digital, Lumens, Dólar que rende / Lumens que rendem, Tesouro, "confirmar na
  carteira", "registro público", "Modo de teste". The server's summaries say the same (`words.ts`: "12,5 dólares digitais",
  "70,1234567 lumens", all 7 decimals kept so what's read is what's signed).
- **Pages:** four tabs (Início, Investir, Pagar, Atividade); new Investir, vault detail, Adicionar dinheiro (4 steps), Ajuda
  (eight questions and the photo credits) and a not-found page; Home gains Adicionar and a full-width band into Investir.
- **Photographs** (PRODUCT.md "Photography"): five Wikimedia Commons photographs, downloaded (≈2.5 MB), credited in a caption
  and on Ajuda; words on a neutral fade only over calm pictures, otherwise below them (a busy chalkboard made the overlay
  unreadable at first).
- **Motion:** view transitions between pages (fade out, rise in), a one-time balance count-up, staggered list entrances, a slow
  settle on hero photographs, a hover zoom on the invest band; all ease-out, none on layout properties, all off with
  `prefers-reduced-motion`.
- Money figures moved from Geist Mono to Manrope with tabular numbers; Mono stays for ids and codes.
- **Serving after a rebuild** (found by the human, 2026-10-23: "Failed to load module script … MIME type of text/html"): the
  API read `index.html` once at start, so after `pnpm build` it kept naming deleted bundles and answered them with the app.
  It now reads `index.html` per request, answers a missing `assets/*` with 404, and serves `.jpg`/`.webp` with their type.
- **Camera went black** (the human, 2026-10-23: "my camera blinks but turn black after"): the scanner's effect depended on
  the camera's step, so "starting" → "on" re-ran it and its cleanup stopped the scanner the moment the camera came on. It now
  depends only on whether the camera is wanted. Checked with Chrome's fake camera: before, no live track at 0.8/2.5/5 s;
  after, a live 1280 px track throughout, and a BR Code fed as the camera's video is read and opens the split.
- **No MetaMask module:** the wallet list is spelled out without MetaMask's Stellar Snap, whose constructor tries to restore
  a session on load ("Failed to restore Stellar MetaMask session: Transport request timed out"); `defaultModules`'
  `filterBy` ran after construction, too late.
Evidence: every new page and both new flows screenshotted at 390 px through the preview (no console errors); router tests 2.
Consequences: the Claude Design canvas predates T-026; the app is now ahead of it.

### DEC-040: A payment visibly in progress; one bar to split it (2026-10-23, T-026)
Context: The human (2026-10-23): "When the payment is being processing we need a loading indicator. It is not clear to the
user that the payment is being processed", and "I want a better way to chose how much come from each source. a novel way.
better UX. also remove sources that cannot be used or put them at the bottom".
Decision:
- **In progress:** while a payment is on its way the receipt's mark has a turning ring, a live line says what is happening
  ("Confirmando na rede", "Recebemos, preparando o Pix", "Enviando o Pix ao banco", "Devolvendo para a sua carteira") with the
  time since confirming, the current step of the progress bar sweeps, and any working button shows a spinner
  (`aria-busy`). With reduce motion on, the ring and sweep stop; the words and the timer stay.
- **The mix:** one bar is the whole payment, a coloured segment per source; the handle on a segment's right edge drags money
  to or from its neighbour (snapping to whole reais, never past a ceiling or below zero; `allocation.ts` `setDivider`), steps
  with the arrow keys (R$ 1, R$ 10 with Shift) and is a slider for assistive tech. A tap on an amount types it exactly.
  Three one-tap suggestions (`suggest`): "Manter rendendo" (dollars, then lumens, the investment only if needed; the screen
  opens with it), "Mais simples" (the fewest sources) and "Dividir igual" (equal shares, water-filled under ceilings); each
  combines only positions that can share one payment.
- **Sources:** those that can join are listed next; a dollar from another issuer is offered as "Trocar" (it replaces the
  chosen dollar, so the payment stays one confirmation); those that can't pay (no reliable price, a balance too small) sit in
  a closed "Não dá para usar neste Pix" section at the bottom, with the reason.
- **Polish after the human's screenshots** (R$ 2,00 to a CPF key: white amounts unreadable on the light segments, handles
  covering amounts and hanging past the bar's end): amounts sit top-left in ink chosen per fill (`inkOn`), handles are round
  knobs on the seams at the bar's lower edge, the end knob shows only while part of the bill is uncovered, empty shares leave
  the bar, the missing amount and one "Completar" (`complete`: chosen dollars first, the investment last) sit under the bar,
  and the review's "Sai de" puts each source's units on a second line.
Evidence: allocation tests 14 (dragging between neighbours and at the tail, the three suggestions, partial cover, completing); the split
driven in the preview (each suggestion, a pointer drag to 25 %, Shift+→ adds R$ 10, a swap keeps the bill complete) and the
in-progress receipt at 390 px, no console errors.

### DEC-041: Young, modern people in the photographs; warm neutrals (2026-10-23, T-026)
Context: The human (2026-10-23): "use the taste skill to find and use better photos. The photos of street markets are not the
image im trying to pass. i want to pass the ideia of young and modern people. also, double check the colors. the white seems
too white. the color do not seem to blend well".
Decision:
- **Photographs:** six CC0 Unsplash photographs from Wikimedia Commons replace the São Paulo market set: a young man smiling on
  a city street (welcome), two friends laughing (Home's band into investing), a young woman at her laptop in a café
  (Investir), a young woman with her phone (Adicionar dinheiro), a coffee toast (Ajuda), a young woman by a skyline
  (not found). Searched the open collections (Openverse returned mostly candid Flickr snapshots; Unsplash's API needs a key;
  Commons holds Unsplash's CC0-era photos). They are stand-ins: no screen names, quotes or presents the people as Vants users.
  Investir's title moved below its photo (readability).
- **Colour:** the neutral ramp moved from blue-tinted near-white (hue 218, page 98.5 %, surfaces 99 %) to warm paper (hue
  ~80, page 97.3 %, surfaces 99.2 %, warmer lines and greys); shadows and photo fades use a warm dark. The brand blue and the
  yield green are unchanged.
Consequences: before a public launch these photographs should be replaced by Vants' own, model-released ones (Q13).

### DEC-042: Paying a Pix from lumens invested (2026-10-23, T-026)
Context: The human (2026-10-23): "Why i cant use Lumens invested to pay? Lumens invested should worth at least their values in
Lumens?" They are; the XLM vault was valued but marked not payable, and the app called that "Sem preço confiável".
Decision:
- **No contract change.** The router's `pay` already withdraws from any vault into the payer's account, swaps XLM on Soroswap
  (exact output) and transfers: the lumens taken out simply feed the swap.
- **Planner:** a lumens-vault pick (`VaultWithdraw` with `lumensFor7`) joins the router's ONE swap with any lumens from the
  wallet; still one vault per payment (`mixed_routes`), and the app's split allows one investment at a time (a second one is
  offered as "Trocar").
- **Builder:** quotes the AMM, then withdraws exactly the lumens the swap may spend for the vault's share (shares rounded up,
  never more than held), so the vault keeps the rest invested; before any swap it checks the payer holds a trustline to the
  payment's dollar (`needs_trustline`, explained in the app). A lumens-vault payment prefers a dollar the account holds.
- **What it can pay vs what it's worth:** lumens invested are shown at the market's estimate (the order book), but can only be
  swapped on Soroswap, whose testnet price is far worse (10 Circle USDC cost ≈ 93.6 XLM, 10 Blend USDC ≈ 44.2 XLM on
  2026-10-23). The portfolio adds `payableUsd` (the AMM's quote for all the lumens invested, less 2% for the slippage
  allowance), used by the planner and the split's ceilings; the app says "a troca automática paga menos que o mercado" when
  the two differ by more than 10%.
- "Usar" on a covered bill now means "use this one": the source goes first and takes what it can, the others shrink.
Evidence: planner tests 3, portfolio 1, API 1 (lumens-vault pick → router, in the held dollar), allocation 4; live
(`pnpm lumens:smoke`, 2026-10-23): invest 60 lumens, then R$ 5,40 paid from "Lumens que rendem" alone — take out 9.458 XLM,
swap to 1 USDC, pay — 1 signature, 1 operation, completed in 14.5 s (E2E `SANDBOX0F2C23DC2B7F406992927F8D0`) and again in
9.8 s with `payableUsd` live (US$ 44.32 worth, US$ 5.28 payable; E2E `SANDBOX655E06E70C2F4ABCA7FF2C799`).

### DEC-043: Lumens invested come out first when the AMM pays below the market (2026-10-23, T-026)
Context: The human (2026-10-23): "can we unyeld the pool instead of only pay it using swaps from soroswap? this way we avoid
the liquidity issues". DEC-042's one-transaction route swaps on Soroswap because a Soroban transaction holds one operation and a
contract can't reach the classic order book; on testnet that pool pays a fraction of the market.
Decision:
- **Two ways, chosen per position.** The portfolio compares the AMM's quote for the lumens invested with the order book's: within
  3% → one router transaction (DEC-042); otherwise the position is `unyield` and pays at the market's value, less 3%.
- **Unyield = two confirmations.** In the app, "Revisar pagamento" first asks to confirm "Resgatar N lumens" (the existing
  `/app/redeem` action: just the lumens the share needs at the market price, + 3%, never more than invested), then pays the same
  share from the wallet's lumens on the classic route (order book, DEC-031's path payment). The split says "2 confirmações"; the
  rest of what comes out stays in the wallet. If the payment can't be built after the lumens are out, the app says so ("Os lumens
  já estão na sua carteira … Nada foi pago").
- The planner refuses a lumens-vault pick marked `unyield` (`unyield_first`), so a client can't take the poor AMM route by
  mistake. DEC-031's one signature still holds for every other payment.
Evidence: portfolio 1, planner 1, app (unyield conversion) 3; live (`pnpm lumens:smoke`, 2026-10-23): the vault worth US$ 36.03
could pay US$ 34.95 (vs US$ 5.28 through the AMM); a direct pick was refused (`unyield_first`); "Resgatar 1,174465 lumens" then
"Pagar 1 dólar digital à Vants, usando até 1,1515699 lumens" (vs 9.458 lumens through Soroswap), completed 9.7 s after the
second confirmation, E2E `SANDBOXA9F253A1B06A4434A4E9076FC`.

### DEC-044: One design system for every screen, after an impeccable critique (2026-10-23, T-026)
Context: The human (2026-10-23): "Most of the times it still look like a hackathon project, ai slop. use impeccable skill and
taste skill to do a full review of every page". The impeccable critique (an independent design-director review of all 20
screens against the impeccable and taste references, plus the `impeccable` 4.7.0 detector on source and rendered pages)
scored 23/40 and called it AI-generated: a landing-page template on task screens (photo + sentence-title), process leaking
(credits, ids, 7-decimal lines), cream + Bricolage + soft cards everywhere, 9 radii, 7 button styles, 4 selected states, 4 ways
to type an amount, decorative motion; the detector found 24 issues on 12 pages (cream palette on every page, low contrast,
11px text, stragglers). The human chose: photos on Welcome only, a neutral off-white ground, Split as an automatic plan with
"Alterar", everything in scope.
Decision (styles.css rebuilt; DEC-041's photographs and warm palette superseded):
- **Colour:** neutral ramp (hue 250, chroma ≤ 0.01; page 97.1%, surfaces 99.4%); blue only for primary/active/links; green
  only for yield; amber only for in-progress and checks; sources coloured in the neutral ramp + green.
- **Type:** Manrope for UI, Bricolage for the hero amount and 28px titles only; scale 12/14/16/20/28/40; system monospace for
  ids (Geist Mono removed).
- **Shell:** a top bar on every tab (name, one "Modo de teste" chip, help, wallet); every pay path counts 4 steps.
- **Components:** lists on the page, one raised surface (receipt); radii 12/20/full; 3 button styles and a readable disabled
  state; one selected idiom (ink outline); statuses as ink + check, amber pill only while moving; asset marks "$", star, "R$".
- **One amount pattern:** the keypad (Pix, investing, taking out, adding money).
- **Screens:** Welcome (one Rio photo, two lines, wallet), Início (one primary action; Adicionar leads when empty;
  investments show their rate and open their page), Investir (total, options with rates), Adicionar (amount first, live price,
  grouped masked details, one-line Pix code with "Copiar"), Pagar (camera on entry, paste goes straight on, key type detected),
  Split (plan + "Alterar" editor), Revisar (who/amount, "Sai de", terms, exact lines under "O que sua carteira vai mostrar"),
  Comprovante (one surface; ids under "Detalhes técnicos"; an enabled exit while processing), Atividade (by day + deposits),
  Conta (the wallet first, address shortened, credits, inline-confirmed disconnect), Ajuda, not-found.
- Copy: "Enviar … para a Vants pagar o Pix"; "Confirmado" for the signed step; "Código do Pix" for the E2E id.
Evidence: detector on the same 12 pages 24 → 0 findings (after a steady amount caret); source scan 0; all 20 screens at 390px
in the preview, no console errors; gates green.
Consequences: Q13 (own photography) still applies to the one welcome photo; human support contact is still missing from
Ajuda (no channel exists yet).

### DEC-045: The app on Vercel, the backend on one Google Cloud VM, one public domain (2026-10-23, T-027)
Context: The human (2026-10-23): "now deploy it and host on vercel", then "host it on gcloud the backend. frontend on vercel".
The API and the worker are long-running Node processes with a pg-boss queue, a Postgres database and signing keys; they do not
fit Vercel Functions. SEP-10 binds the login to one host: the challenge's home domain is `PUBLIC_BASE_URL`'s host, and the app
checks it against `location.host` (DEC-032).
Decision:
- **One public domain:** `https://vants.example.com` is `PUBLIC_BASE_URL`. Vercel serves the static app
  (`deploy/web.sh` builds `@vants/web` and writes `vercel.json`) and rewrites `/app`, `/auth`, `/.well-known`, `/ingress` and
  `/v0` to the VM, so stellar.toml, SEP-10 and the app API all answer on the domain the wallet sees.
- **Backend:** one image (`Dockerfile`, Node 24.18.1, production deps of `@vants/api` and `@vants/worker`) run as two services
  under Docker Compose with Postgres 18.6 and Caddy (HTTPS at `<backend-ip>.sslip.io`, static IP `vants-ip`) on GCE e2-small
  `vants-1` (us-central1-a, project `<gcp-project>`). Pattern from Pier's `deploy/`.
- **Exactly one worker.** Two workers would race the sagas (double payouts are guarded, but refunds and books would fight). The
  local api and worker were stopped before the VM's started; run them locally again only after `docker compose stop worker`
  on the VM.
- **Secrets:** `deploy/push.sh` writes `/opt/vants/.env` (mode 600) once, from the local `.env`'s keys plus the public URL and
  a random Postgres password, and never prints it; later pushes keep it. Testnet and sandbox keys only.
- **Data:** `deploy/copy-db.sh` moved the local database once (42 payments, the pg-boss queue) with `pg_dump | pg_restore`.
- **Redeploy:** backend `PROJECT_ID=<gcp-project> PUBLIC_BASE_URL=https://vants.example.com deploy/push.sh`
  (image tagged with the git short sha); app `API_HOST=<backend-ip>.sslip.io deploy/web.sh --prod`.
- **Webhooks:** the Pier subscription's webhook still points at the old ngrok URL; the worker's Pier pull (every 30 s) finds
  incoming payments without it. Rerunning `pnpm pier:setup` issues a new webhook secret that the VM's `.env` would then need.
  The Hodle sandbox sends no event webhooks (DEC-027).
Evidence: `pnpm app:smoke` over `https://vants.example.com` (stellar.toml → SEP-10 → portfolio → exit → one signature
→ completed in 27 s, paid by the VM's worker): `docs/evidence/t-027-deploy-app-2026-10-23T10-16-42.740Z.json`.
Consequences: about US$ 13 a month (e2-small plus the static IP) while the VM runs; the sslip.io host and the
`*.vercel.app` name are stand-ins for Vants' own domain (one custom domain on Vercel would replace both in `PUBLIC_BASE_URL`).

### DEC-046: Link previews from the welcome screen (2026-10-23, T-028)
Context: The human (2026-10-23): "Ok, but now lets focus on OG tags. Images, description, everything. then deploy it again".
The app had one description meta, an SVG as the iOS touch icon (iOS ignores it), a cream manifest background left over from
DEC-041, and no Open Graph or X tags, so a shared link showed a bare URL.
Decision:
- **One card, 1200×630** (`apps/web/og/card.html` → `public/og.jpg`, 100 KB JPEG so WhatsApp loads it): the welcome screen's
  words, logo, neutral ground and Rio photograph (people in frame on the right), Bricolage headline, Manrope lede. Edit the
  HTML, not the image.
- **Tags:** title "Vants: pague qualquer Pix com a sua carteira"; description in the app's voice (no crypto words); `og:type`,
  `site_name`, `locale pt_BR`, `url`, `title`, `description`, `image` (+ `secure_url`, type, 1200×630, alt) and
  `twitter:card summary_large_image` with the same title, description, image and alt; `canonical`.
- **Absolute URLs:** crawlers need them; a 4-line Vite plugin writes `%PUBLIC_URL%` from `PUBLIC_BASE_URL`, defaulting to the
  hosted domain (DEC-045), so a custom domain is one variable.
- **Icons and chrome:** `apple-touch-icon.png` 180, `icon-192.png`, `icon-512.png` (also maskable: the mark sits inside the
  safe zone on a full-bleed square), the SVG kept for browsers; `theme-color` and the manifest's colours = the page ground
  `#f4f5f7` (light only, DEC-036); `format-detection telephone=no` so amounts and keys are never dialled.
Evidence: production `https://vants.example.com/` returns the tags with absolute URLs; `/og.jpg` 200 `image/jpeg`
102 172 bytes; touch and manifest icons 200; page and image 200 for `facebookexternalhit`, `WhatsApp`, `Twitterbot` and
`Slackbot-LinkExpanding` user agents.
Consequences: previews cache per URL on each platform (WhatsApp and X keep the first fetch for days); the photograph stays a
stand-in (Q13).

### DEC-047: Tesouro trades and pays on the order book (2026-10-23, T-029)
Context: The human (2026-10-23): "on my Seu Dinheiro tab i dont see the TESOURO. Also, i cant use TESOURO to pay a pix.
Solve that". Their wallet (`GDJKP4…`) holds a TESOURO trustline and 0 TESOURO, though its R$ 300 Etherfuse order says
"completed": the sandbox completes onramp orders without any Stellar payment (no `confirmedTxSignature` on that order; on
others it is a base58 Solana-style signature, never a testnet hash), and no ramp account ever received TESOURO. The app
listed Tesouro only when held, and never as payable (DEC-038: an outside estimate, `payable: false`). Meanwhile the issuer
mints TESOURO and CETES every two hours to `GBPAFJ3C…`, which keeps two-sided offers against Circle testnet USDC
(about 0.2307 USDC per TESOURO, ~24.6k USDC deep on the bid).
Decision:
- **Valued on the book:** a `swapAssets` asset (TESOURO) is worth what a strict-send of all of it delivers in the first
  funding dollar now, `pricing: "estimated"`, and is payable; with no path, the old outside estimate shows it, not payable.
- **Paid like lumens:** the planner treats any estimated classic position as a swap leg (`from` is now any asset); the
  classic route sells it with `pathPaymentStrictReceive` (alone: straight to the deposit, no dollar trustline needed; mixed:
  to self, and a missing dollar trustline is refused up front as `needs_trustline`). With a vault it is `mixed_routes`:
  the router swaps on a Soroban AMM and can't reach the order book. The app's Split applies the same rule (`orderBook`
  sources never share a payment with a vault) and ranks Tesouro with money that earns (used last).
- **Bought and sold in the app:** `POST /app/tesouro` (`buy`/`sell`, `amountBrl`, or `sell` `all`) builds one classic path
  payment: buy an exact amount of TESOURO worth the reais now, paid with the dollar if it covers it, else lumens; sell
  for the dollar where the wallet accepts it, else lumens; 1% slippage either way. A first buy asks the wallet to accept
  Tesouro (`/app/ramp/trustline`). Investir → Tesouro and the Tesouro row on Início open the page (keypad in reais).
- **Honest test mode:** Adicionar → Tesouro says the sandbox confirms Pix purchases without delivering, and links to the
  Tesouro page.
Evidence: `pnpm tesouro:smoke` over `https://vants.example.com` with the test payer: accepted Tesouro (`b6f59070…`),
bought 24.068333 TESOURO with ≤ 6.398 lumens (`904e2abd…`), portfolio `valueUsd 5.55, payable`, then a R$ 5,40 code paid from
Tesouro alone, one signature and one operation, completed 18.7 s after signing:
`docs/evidence/t-029-tesouro-2026-10-23T10-47-28.279Z.json`. Tests: planner 3, portfolio 1, allocation 2, routes 3.
Consequences: Tesouro's price and depth are whatever Etherfuse's testnet market maker quotes; the R$ figure shown for a unit
comes from that dollar quote at Vants' rate, not from Etherfuse's BRL quote. Q14: does Etherfuse production deliver TESOURO
on Stellar for onramp orders (and on which network does the sandbox think it delivers)?

### DEC-048: Grouped panels and money marks (2026-11-02, T-030)
Context: The human (2026-11-02): "lets do a refactor for vants ui. I still fell that is not professional enough. use impeccable
skill". Screenshots of the 13 preview screens at 390 px (mobile emulation over CDP; headless Chrome's own window can't go
below ~500 px on macOS, so plain `--screenshot` captures clip) showed craft gaps, not identity gaps: section titles at body
size, gray glyph discs for money (a star for lumens), amounts in different columns (chevrons on some rows), three label
styles for key/value facts, a cluttered top bar (test chip, help, wallet), and a green display headline on Tesouro. Asked
whether to keep DEC-044's "lists on the page, one raised surface" or move to grouped panels, the human chose grouped panels.
Decision (identity kept: the design-system colours, Manrope/Bricolage, the voice):
- **Panels:** `.rows`, `.facts`, `.breakdown`, `.panel`, `.payee` and the receipt are near-white panels (16 px corners, a
  hairline ring) on a page stepped down to oklch 96.3 %; dividers inset to the text (68 px after a mark); rows hover/press with
  a tint instead of an underline. The dock is white like the tab bar.
- **Headers:** section titles 18/650 ink; group labels (a day, "Sai de") 13/600 muted; tab titles 24 Bricolage.
- **Money marks:** an ink disc with "$" for dollars, an outlined planet for lumens (drawn for Vants, not Stellar's logo), "R$"
  for Tesouro; a small green arrow badge when the money earns (vaults and Tesouro), replacing green glyphs.
- **Top bar:** one outlined "Modo de teste" chip with an amber dot and one account button; help moves to Conta (it was
  already a row there).
- **Screens:** Início drops chevrons from the money list and mutes "≈"; empty states sit in panels; the vault and Tesouro
  pages open with a mark + rate row (no green headline); keypad amounts sit midway between header and keypad; Welcome keeps
  one lede line plus three promises already made in its copy (QR or key in one confirmation, money stays with you, refunds
  on failure); Conta shows "Conectada até 9 de nov., 11:29"; Ajuda's questions are one panel.
Alternatives: keep DEC-044's flat lists and fix craft only (offered; the human chose panels); per-asset brand colours (blue is
reserved for actions and green for yield in PRODUCT.md, so marks stay in the neutral ramp).
Consequences: DEC-044's "lists on the page; one raised surface" and its gray glyph marks are superseded; PRODUCT.md "Colour
and type" updated. No API, copy-of-record or flow change. Evidence: before/after captures of every preview screen and the
QR → Sai de → Revisar flow at 390 px, no console errors, no horizontal overflow; format, lint, 273 unit tests, build and
secretlint green.
Deployed 2026-11-02 on the human's instruction: `API_HOST=<backend-ip>.sslip.io deploy/web.sh --prod` (Vercel
`<deployment>`; the first `vercel deploy` answered "Not authorized", a plain retry succeeded). The public
domain serves the new stylesheet, `/.well-known/stellar.toml` 200 and `/app/portfolio` 401 without a token through the
rewrites; Welcome renders at 390 px with no console errors. Frontend only: the backend VM is unchanged.

### DEC-049: A full-screen payment photograph on Welcome and brand-ink moments (2026-11-02, T-031)
Context: After T-030 the human (2026-11-02): "the images are still not giving me the professional look. maybe we can use full
screen images or videos. also do ou believe the logo or colors should change?". Recommended: full-screen media on Welcome only
(task screens keep no photos), the logo and palette kept, the brand ink used with commitment at brand moments; "Go ahead".
A first cut used a Pexels loop of palm trees on Ipanema (following PRODUCT.md's T-026 brief of a Brazilian leisure setting).
The human: "why beaches? we are creating a financial app", chose everyday payment footage over a product demo or type only,
and, as the free libraries had no Pix-QR-at-a-counter clip and paid ones can't be browsed by the agent, "use default payment
footage or image".
Decision:
- **Photograph:** "A person using mobile to make a contactless payment at a café counter", Tima Miroshnichenko (Pexels,
  2021-01-19, 3901×5852; SOURCES.md): a hand holding a phone to the reader at a wooden counter, the barista behind, no face
  in frame (no implied endorsement). Cropped from the top so the phone sits in the upper half, 1200×1404 JPEG (126 KB),
  imported through Vite (hashed, immutable cache). It shows a contactless tap, not a Pix QR scan: a stand-in for the moment
  of paying until Vants has its own photography (Q13).
- **Welcome:** the photograph fills the screen (`object-fit: cover`), an ink scrim (light at the top for the logo, rising
  from 36 % to 97 % at the bottom) carries the reversed logo, a quiet test chip, the 36 px headline, the lede, the three
  promises (green-300 icons) and a white "Conectar carteira".
- **Receipt:** the result card is brand ink with light type; the paid check is the full yield green, in-flight amber, failed
  red-300; finished progress steps are white (green stays for the check and for money that earns).
- **Link preview:** `og/card.html` rebuilt: the photograph on the left, the brand ink on the right with the reversed logo and
  the welcome words; `public/og.jpg` 64 KB (q76); the OG/X image alt describes the photo.
- **PRODUCT.md:** the photography brief is now the moment of paying in everyday commerce, not a leisure setting.
- **Kept:** the logo and the palette (not the bottleneck; a logo change is a brand decision for a designer).
Alternatives: the Ipanema loop (rejected by the human: leisure, not money); a product demo from the real UI or type only
(offered; the human chose payment imagery); Pexels payment videos (Covid-era masks, a Cyrillic food-truck sign, EU travel
certificates, card terminals, Apple Wallet on screen); Pexels photos with a third-party brand on the counter, Apple Wallet
card art, or a face and a logo; paid stock (Adobe, Shutterstock, Getty, Storyblocks) needs the human to choose and license.
Consequences: The rooftop photo (`rio-miramar.jpg`) is removed; Q13 (own photography, ideally a Pix QR scan at a Brazilian
counter) still applies. Evidence: preview at 390 px and 1280 px, no console errors; format, lint, 273 unit tests, build,
secretlint green.
Deployed 2026-11-02 on the human's instruction ("ok, i liked it. deploy it"): `API_HOST=<backend-ip>.sslip.io
deploy/web.sh --prod` (Vercel `<deployment>`). The public domain serves the same bundle as the local
build, the photograph and `og.jpg` (byte-identical); `/.well-known/stellar.toml` 200 and `/app/portfolio` 401 without a token
through the rewrites; Welcome renders at 390 px with no console errors. Frontend only: the backend VM is unchanged.

### DEC-050: Our own contrast gate over the real screens (2026-11-02, T-032)
Context: The human sent a screenshot of "Adicionar dinheiro" after a Pix: "viram 4,69 dólares digitais" and the step labels
were near-invisible. Cause: T-031 gave the receipt's result card light text for its brand-ink background with rules scoped
to `.receipt`; the adding-money status reuses `.receipt` on the light page (no `.surface`), so it inherited light-on-light
(measured 1.21:1). The human: "double check every page so this dont happen again. check for contrast and readability".
Decision:
- **Fix:** every dark-card rule is scoped to `.surface.receipt`.
- **Gate:** `pnpm check:contrast` (`apps/web/test/contrast.ts`): Vite's dev server (the app's own dependency) and the
  installed Chrome over the DevTools protocol, no new packages. 28 scenarios drive the preview through every screen and the
  states inside flows (sources, editing, review, Pix-key amount and review, adding money: amount, Pix code, Pix received,
  Tesouro; receipts paid, in flight, refunded; empty account), open every `<details>`, then measure each visible text run,
  input value and placeholder against what is behind it: computed colours composited up the tree (any CSS colour converted
  by a canvas, opacity included), or, when a photograph, video or gradient is under it, the rendered pixels with the text
  hidden (10th-percentile pixel). Thresholds WCAG 2.2 AA: 4.5:1, 3:1 for large text (≥ 24 px or ≥ 18.66 px bold) and for
  progress marks that carry state (1.4.11); nothing under 12 px. Disabled controls are not exempt. Exit 1 lists each failure
  with its ratio, colours and place. `ONLY=<name>` runs a subset.
- **Proof:** with the T-031 stylesheet the gate fails the two adding-money states at 1.21:1 (the screenshot's text) and
  1.01:1 / 1.72:1 (the step marks); with the fix: 614 runs and marks on 28 screens, 0 failures.
Alternatives (CLAUDE.md #11): axe-core (MPL-2.0, outside the permissive allowlist of #8, so an "ask"; and it reports text
over images as "needs review" instead of measuring it), pa11y (LGPL-3.0, Puppeteer), Lighthouse (Apache-2.0, runs axe, one
URL at a time, no flows), Playwright + axe (a new dev dependency and browser download). None measures text on the welcome
photograph or drives the flows without new packages.
Consequences: §8 gains the gate for tasks touching `apps/web`; it needs Chrome (`CHROME_PATH`). New screens or states should
be added to its scenario list in the same task.

### DEC-051: One activity feed (2026-11-02, T-033)
Context: The human: "the activity is only listing offramps and forgeting about investments and other kinds of activities".
Atividade read `GET /app/exits` (Pix payments) and listed the last Pix deposits in a separate block under them; signed
actions (`app_actions`: invest, redeem, Tesouro trades, trustlines) had no listing at all.
Decision:
- **`GET /app/activity?limit&before`:** payments (`exits`, signed), actions (`app_actions`, status ≠ built) and Pix deposits
  (`ramp_orders`) merged newest first. One cursor `<created_at>|<id>` for the three tables: each is read `limit + 1` past
  it (`listExitsBefore`, `listActions`, `listRampOrdersBefore`), so the merged first `limit` are exact and `next` is set only
  when more remain. Items: `{type: "payment", exit}`, `{type: "action", action}` (kind, status, detail as built, the vault's
  id, asset and name), `{type: "deposit", order}` (the `/app/ramp` shape). Actions still `submitted` are settled from the
  network first (`txStatus`, as `GET /app/actions/:id`). The month line stays "Pix pagos em <mês>" (completed payments).
- **Atividade:** one list by day. Each row follows the payment rows: the money or payee as the title (the vault's name,
  "Tesouro", "Dólar digital"), the time and what happened as the subline ("investiu", "resgatou", "comprou", "vendeu tudo",
  "carteira pronta para receber", "adicionado com Pix"), the amount in the unit it was made in (US$ for the dollar, lumens,
  R$ for Tesouro and Pix) and a short status (Concluído / Processando / Não concluído; Aguardando Pix / Enviando / Na
  carteira). Rows open the vault, Tesouro or Adicionar page. The money mark is the same as Início's.
- `GET /app/exits` stays (Início's last payments).
Evidence: `money.int.test.ts` "Atividade (T-033)" on Postgres: order across kinds, the cursor's two pages, unsigned actions
left out, a submitted action settled to done, another account sees none of it, a bad cursor 400. Preview fixtures for every
kind; contrast gate on Atividade 70 checks, 0 failures; format, lint, 273 unit tests green.

### DEC-052: Money math audit (2026-11-02, T-034)
Context: The human asked to double-check every calculation and every figure shown. Two independent reviews read the money
code (backend: packages/domain, db, adapters, apps/api, apps/worker; app: apps/web), each finding confirmed with a numeric
example (scripts run against the real functions) and anything unconfirmed dropped.
Found correct (backend): quote pricing in integers, `assetAmount7` rounds up and covers value + fee (brute-forced over 6
rates × ~2,800 amounts × both fee models), `payoutDebit6 × 10 ≤ assetAmount7`, Hodle's fee; exact-deposit matching, every
refund ≤ what was received (over, under, late, wrong asset, failed payout, partial reversal rounded down); ledger postings
balance per asset and clearing returns to 0; refill spendable rounds down; float `available` and `maxPayableCents`; vault
shares (value rounds down, shares to withdraw round up); exit picks sum exactly to the quote, swap limits round the safe
way; portfolio totals count priced values once. (App): allocation fuzzed over 20,000 bills × portfolios × 3 strategies
(never over the bill, picks sum to the total, no slice over its room), formatting and the keypad, "Seu saldo", the month
total (completed Pix, without fee), unyield's rounding, labels and APY.
Decision (fixed, each with a test):
- **Receipt "Saiu de"** scaled the picks to the bill without the fee, so a R$ 100 + R$ 4 fee payment showed R$ 100 where
  Revisar showed R$ 104: now value + fee.
- **"Você tem investido" / vault prices** took the lumen price from the wallet's lumens, which disappear after "Tudo":
  1,000 XLM invested (US$ 300) showed R$ 0. Now the vault's own position first; lumen values in Investir carry "≈".
- **Split, invested lumens** were counted at the wallet price instead of the payable (AMM) price (≈ 33,3 vs ≈ 35,4
  lumens): the invested-lumens branch now runs first.
- **"Tudo"** used `Math.floor(max × 100)` (19.99 → 1998; 573 of the 9,999 two-decimal amounts under 100 lost a cent):
  `floorCents`, exact for all 9,999. On a vault, "Tudo" now sends the exact 7-decimal balance, so no dust stays invested.
- **Typed "12.50" in a split row** was R$ 1.250,00: with no comma, a trailing ".d"/".dd" is the decimal point.
- **Adding Tesouro** said "≈ 85,66 em títulos do Tesouro" (a unit count that read like reais): "unidades de Tesouro".
- **Tesouro trade size** in floats was one stroop short for 26,895 cent amounts up to R$ 20,000 at three rates (R$ 3,51 at
  5.4 → 6499999): `brlToUsd7`, cents × 10¹¹ ÷ rate micros, exact (tested over every cent to R$ 2,000 at three rates).
- **Ramp "receive"** used `Number(x).toFixed(7)` (rounded "0.12345678" up): cut to 7 decimals in integers, same padded form.
- **A reversal that returned 0 centavos** requested a 0 refund that `formatAmount7` can't send, holding the in-order refund
  queue (latent: reversals aren't wired yet): now recorded with no refund.
Not changed (asks): the books' drift rule and a missing USDH debit booked as 0 (Q15).
Evidence: unit tests (format, brlToUsd7, zero reversal) 278 green; integration 112 green; contrast gate 644 checks, 0 failures;
format, lint, build, secretlint green.
Deployed 2026-11-02 on the human's instruction ("deploy it"), with T-032 and T-033: backend `PROJECT_ID=<gcp-project>
PUBLIC_BASE_URL=https://vants.example.com deploy/push.sh` (`vants:95b4e67`, no migrations; api and worker restarted
clean), then `API_HOST=<backend-ip>.sslip.io deploy/web.sh --prod` (Vercel `<deployment>`, same bundle
as the local build). Live check through the public domain with the testnet test payer's SEP-10 login: `GET /app/activity`
200, 12 items newest first: 8 completed Pix plus an invest, a redeem, a Tesouro trade and a trustline that the old Atividade
never showed.

### DEC-053: One success moment, and where each flow ends (2026-11-02, T-035)
Context: The human: "the wow moment ... when someone invest, pay or get to the end of a flow ... motion, elegant but pretty.
also check where it redirects after". The ends were uneven: a Pix receipt with a 300 ms settle; investing, redeeming and
Tesouro reset the keypad under a one-line notice and stayed on the page; adding money showed a notice and "Voltar ao início".
Decision:
- **One signature** (`success.tsx`, `motion.ts`, styles "the success moment"): the result card in brand ink; a green mark
  settles (scale .4 → 1, ease-out-expo, 620 ms), its check draws itself as one stroke (pathLength 1, 460 ms), one ring and
  a second, later ring ripple out and fade (1.1 / 1.3 s), a green light rises behind the mark and settles to a glow; title,
  amount and detail rise from 10 px with a 4 px blur in a 70 ms stagger; the amount counts up from zero (ease-out-expo,
  900 ms); the last progress step fills. Transform, opacity, stroke and blur only; nothing loops; a 12 ms vibration where
  phones have one. Screen readers get the final amount at once (the counting digits are hidden from them). With reduced
  motion everything is simply there.
- **Only when it happens on screen:** the receipt celebrates when the payment it first loaded unpaid turns paid (straight
  from paying, or a payment in flight); one opened later from Atividade, already paid, is calm. Adding money celebrates
  when the order lands while it's open. Investing, redeeming and Tesouro celebrate on the wallet's confirmation settling.
- **Where it leads:** Pix paid: Compartilhar / Concluir → Início (unchanged). Invested or Tesouro bought: Ver atividade /
  Ver investimentos → Investir, where the total now includes it. Redeemed or Tesouro sold: Ver atividade / Concluir →
  Início, where the balance shows the money back. Money added: Pagar um Pix / Concluir → Início. The header's back goes
  where Concluir goes. Results that are the whole page (investing, Tesouro) sit in the middle of the screen.
- **Hero amounts are money on one line:** money added shows US$ 19,75 (dollars) or R$ (Tesouro), the units in the detail.
- **Preview:** a dev-only signing stub (`import.meta.env.DEV`, absent from the production bundle: checked), a stubbed Pix
  submit, and `?completes` (the payment in flight is paid, and a Pix deposit lands, 2.5 s after first being followed) so
  every end can be seen; React StrictMode's double effect ruled out counting requests.
Alternatives: confetti or particles (decorative, loud for a money app; the impeccable reference bans bounce/elastic and
decoration); a full-screen takeover (a modal as first thought); celebrating every receipt view (replays on old receipts).
Evidence: frame-by-frame captures of the pay, invest and add-money ends; contrast gate 713 checks on 32 screens including the
four success states, 0 failures; format, lint, 278 unit tests, build, secretlint green.

### DEC-054: The human accepts T-001 to T-035; main fast-forwards (2026-11-02)
Context: the work sat on 30 stacked task branches in `review`, with `main` at the spec commit, when the repository moved to a private GitHub remote. The human asked to merge everything into `main` without reviewing each PR: "merge into main. i dont want to do it manually. just acept everything".
Decision: every task in `review` is set to `done` by that instruction, T-021 included (its D2 run with a real wallet is recorded in §8, 2026-10-23). Every task branch is an ancestor of the last one, so `main` fast-forwards to it: no merge commits, no conflicts, history unchanged. T-090 (evidence run) stays `todo`. Open questions in §11 stay open.
Alternatives: one PR per task, merged in order (the default workflow): rejected by the human for this backlog.
Consequences: §9 statuses. Later tasks branch from `main` again.

### DEC-055: Stage the Vercel upload outside the repository (2026-11-02, T-038)
Context: once the repository had a GitHub remote (DEC-054), `deploy/web.sh` uploaded from `.vercel-deploy/` inside it, so the Vercel CLI attached the commit and its author. Vercel set the production deployment to `BLOCKED` with a link to "troubleshoot project collaboration: team configuration": on a Hobby account it blocks a deploy whose commit author it cannot match to the account. Uploading the same build from a folder outside git deployed normally (`<deployment>`, T-035 live).
Decision: the script stages the upload in a `mktemp -d` folder, removed on exit. The project link stays in `.vercel-link/`.
Alternatives: rewriting every commit's author email (rewrites published history); adding the commit email to the GitHub and Vercel accounts (the human's accounts: theirs to choose, and it would also work); connecting the Vercel project to the GitHub repo (deploys on every push, a scope change).
Consequences: §8 deploy notes unchanged in use (`API_HOST=… deploy/web.sh --prod`).

### DEC-056: Read chain state side by side, share reads in flight, keep only estimates (2026-11-02, T-039)
Context: `GET /app/invest` and `GET /app/portfolio` took 7–17 s on the hosted backend while the VM was idle. Timed inside the API container: the public testnet RPC (`soroban-testnet.stellar.org`) answers most `simulateTransaction` calls in about 130 ms but stalls some for 2–3 s (name lookup 1–7 ms, connect about 60 ms; identical calls sent in pairs stalled together in 5 of 10 pairs, so the stalls come in waves). `readPortfolio` awaited every quote, share and vault read one after another (about 8 in a row), `/app/invest` read the whole portfolio again before its own vault reads, and the app opens both at once, so each stall was paid several times over.
Decision: `readPortfolio` reads every balance and every vault side by side (each vault's shares and totals together, the lumens vault's two quotes together), keeping position order; a vault's totals failing only fails the read when the account holds shares in it. `GET /app/invest` starts its vault reads together with the portfolio. A small `shared()` helper (`apps/api/src/app/reuse.ts`) makes concurrent reads of the same thing run once; only estimates are kept after the read: quotes 15 s, a vault's yield 5 min. The account, its shares and a vault's totals are never kept, because redeeming and the exit plan build transactions from them. Measured from a laptop against live testnet, a portfolio and invest load: 16–19 s before, 5.4–6.4 s after (first load about 11 s for both, with nothing warm yet).
Alternatives: `lru-cache` 11.5.3 (already in the lockfile, has fetch coalescing with a ttl): its license, BlueOak-1.0.0, is outside the list CLAUDE.md allows without asking, and the helper is about 50 lines. Hedged requests (a second copy after 500 ms): both copies stalled in half the pairs tried, for doubled load on a public server. Simulating with `new Account(reader, "0")` instead of fetching the treasury account first (as `DefindexReader` already does): Raven did not ground that simulation ignores the sequence number, so `quoteXlmAmm` keeps its lookup ([VERIFY: does simulateTransaction check the source account's sequence number]); its 15 s reuse removes most of those calls anyway.
Consequences: §3.2 `apps/api` reads unchanged in shape. The remaining time is the testnet RPC's own stalls, about one stall per step on the critical path (account, then shares and totals, then the lumens vault's quote).

### DEC-057: Keep the portfolio on the device, refresh it in the background and after every action (2026-11-02, T-040)
Context: even after T-039 the portfolio takes about 2 s on a good testnet day and much longer on a bad one, and Home showed placeholders until it arrived, on every visit. The human asked to keep a local copy, update it on every action, and refresh it in the background when reaching Início.
Decision: `apps/web/src/store.ts` keeps the last `/app/portfolio` and `/app/invest` answers per account in localStorage (`vants.cache.<name>.<account>`), next to the session (the same device and the same privacy trade-off as DEC-035: someone with the device sees balances, never funds). Home and Investir show them at once and refresh in the background when opened (and when the tab comes back); the refresh button turns while it runs; screens refreshing together share one request; a failed refresh keeps the last value with a calm notice ("mostrando o último saldo"). Every action refreshes both right away and again 6 s later, after the next ledger: an action confirming (invest, redeem, Tesouro, accepting an asset, in `Confirm`), a Pix payment submitted (`Review`), a payment finishing or being refunded while its receipt is open, money added landing. Sign-out removes every saved value. An answer that arrives after the account changed is dropped. Paying and investing never read from the cache: the server re-reads balances when it builds a transaction. The preview starts each load with an empty cache (`?cached` keeps it) and gains `?slow` (portfolio and invest take 4 s).
Alternatives: TanStack Query (a new dependency for two queries; the store is about 150 lines with tests); sessionStorage (lost on every visit, which is what the human asked to fix); optimistic balance edits after an action (a second copy of the money maths in the web app, and wrong until the ledger closes anyway).
Consequences: §7: balances of the signed-in account are stored in the browser until sign-out.

### DEC-058: Investing and taking out run as flows, like a Pix (2026-11-02, T-041)
Context: the human found the investing and taking-out experience unclear and asked for a clear flow with steps, inspired by Pagar Pix. Each option's page mixed the information (rate, what you have) with the action: an "Investir | Resgatar" switch above the keypad, then a confirmation with a title and two lines.
Decision: each option (both vaults, Tesouro) opens on an overview: its mark, the rate and where it comes from, what you have there (in reais, with the unit as a second line), what the wallet can put in, how taking out works; Resgatar and Investir are the dock's two actions (Investir alone with nothing invested; "Adicionar com Pix" with nothing to invest, for dollars and Tesouro). Each action is a flow under the same header as a Pix (back, "Investir"/"Resgatar", step dots): 1 the amount on the keypad with 25% / Metade / Tudo (Tudo sends the exact balance, T-034), 2 the review, then the success moment (T-035). Tesouro's first purchase adds "Deixe sua carteira receber Tesouro" as step 2 of 3 (also when the server answers TRUSTLINE_REQUIRED). The review shows the amount (≈ reais under it), where the money leaves from and where it lands (two rows joined by a path with its direction), a year at today's rate as an estimate (vaults, investing), what stays invested (taking out part), the terms, the deadline, and the wallet's lines one tap away, with "Confirmar e investir US$ 12,50" as the action. The pieces with arithmetic (steps, quick amounts, the exact "Tudo", the estimate) are in `apps/web/src/move.ts` with tests; the screens in `screens/Move.tsx`; `Invest.tsx` describes each option. Same server calls and checks as before; no fee is stated (none is known for certain beyond the network's).
Alternatives: keeping one page with the switch and only adding steps (the switch still asks for a direction before anything is shown); a bottom sheet for the amount (a new pattern; Pix uses full screens).
Consequences: the contrast gate covers the overview (with and without money to invest), the amount, the reviews (dollars in and out, lumens, Tesouro, receiving Tesouro first) and the success moments.

### DEC-059: One vocabulary for waiting (2026-11-02, T-042)
Context: the human asked for loading that is clear, consistent and follows good practice, so people know to keep waiting while an operation runs or a page changes. Testnet's RPC often takes 2 to 15 s (T-039). Before: static grey placeholders (a slow screen looked frozen), nothing said after the first second, the wallet → send → record sequence lived in a button label and a notice that could sit below the fold, the way back stayed open while a transaction was being sent, sign-in said "Abrindo a carteira" while waiting for the person to confirm, a QR read by the camera showed no change while it was priced, and the busy button was faded to 85% (its words fell under AA).
Decision: four kinds of wait, one look each (`apps/web/src/wait.ts`, `ui.tsx`). (1) Content loading: placeholders shaped like the content (lists, the option overview, the review, the receipt) with a soft sweep of light (transform only; with reduced motion they breathe in opacity instead), the name of what loads for screen readers, round marks round. (2) An action that asks the server: the button keeps its own look at full strength, names the work ("Calculando o preço", "Preparando") and turns; the dock knows (`Dock busy`). (3) An operation with the wallet and the network: its steps in the dock, always in view (`OpSteps`: "Confirmar na sua carteira" marked as the person's turn, then "Enviar à rede", "Registrar na rede"; a Pix: confirm, send, then the receipt follows it); the deadline hides once it is sent; the way back is locked while it is being sent and recorded (`navLock`), and opens again after 30 s, when the words say the operation is with the network and Atividade will show how it ended. (4) Any wait past 5 s says it is still working and what is safe ("Nada saiu da sua carteira" while preparing; "Sua operação já foi enviada" once sent; where to look for the wallet), and past 30 s what to do. Sign-in names each step (opening the wallet, preparing access, "Confirme na carteira", entering). A QR read by the camera dims the picture and shows the working button. The preview's `?slow` now slows every call (`?slow=8` for 8 s), the wallet takes 3 s, and actions are recorded 12 s after they are first followed.
Alternatives: a global top progress bar driven by every request (background refreshes and receipt polling would keep it running and teach people to ignore it); spinners in the middle of content (they hide what is coming; placeholders show it); a blocking overlay during operations (hides the review the person just confirmed); timers with fake percentages (the network gives no progress to report).
Consequences: the contrast gate covers a screen still loading after 5 s, the wallet's turn and a slow recording; the busy button's 85% fade is gone (`design/ds.css`), and secondary, ghost and inverse buttons keep their own look while busy.

### DEC-060: Design system A, "Comprovante" (2026-11-03, T-043, T-044)
Context: the human found the app still looked like a hackathon project with AI tells, and set aside every earlier visual rule (the design system artifact, the teal/green/amber palette, Bricolage and Manrope, light-only, the logo and the photograph). Three directions were drawn as mockups (T-043), reworked once for a stronger identity, and checked with tasteskill v2 (`design-taste-frontend`, app rules, run from a local copy; achromatic-ledger style, seed 1296168851). The human chose A, without its PAGO stamp.
Decision: everything reads as printed. Archivo only (OFL, self-hosted latin and latin-ext subsets, variable width and weight): condensed at 800 for money and titles, normal width for text. Receipt paper, ink, and carimbo blue (oklch 47% 0.215 266) for the one primary action, the dollars that pay first and a paid receipt. A screen's answer sits on a full-width ink slab (the balance with what it is made of, a rate). Lists and facts are ledgers on the page: a 2px ink rule on top, hairlines, dotted leaders from label to value; no cards, no shadows at rest, 3px corners. The receipt and every success are a paper slip whose top band states the status in words, coloured by it (blue paid, ink on its way, grey returned, red failed); it replaces the stamp, which the human didn't want. Status is a word with a small mark, never a filled pill. Motion is state only: the paid band prints in from the left and its tick draws; the glow, rings and counting numbers of T-035 are gone; placeholders breathe in opacity (T-042 still holds: they visibly move). New wordmark: the V of Vants drawn as the tick of "pago". Welcome is the ink page with no photograph (the Pexels stand-in and its credit are removed from the app).
Alternatives: B (goiaba coral and maroon, soft tiles) and C (lamp yellow on warm black) were drawn and kept on the canvas; the human chose A. For the paid mark, a rotated rubber stamp (rejected by the human), a large tick on its own (the generic success screen) and a dark card with a glow (the old AI tell). Keeping Manrope/Bricolage (rejected with the old rules); Geist or Inter (the taste skill's "kit" faces).
Consequences: `design/tokens.css`, `design/ds.css`, `styles.css` and the shared pieces in `ui.tsx` and `success.tsx` restyled with the same class names; markup changed only where the design did (Home, Review, the investment overview, the receipt, the success slip, Welcome, Account). The link-preview card (`og/card.html`, `og.jpg`) still shows the old look and photograph: a follow-up. PRODUCT.md's visual sections rewritten; DESIGN.md added. Supersedes the visual parts of DEC-044, DEC-048, DEC-049 and DEC-053.

### DEC-061: Welcome keeps a photograph, printed with a hard edge (2026-11-03, T-045)
Context: T-044 made Welcome an ink page without a photograph; the human found the top half empty and asked for a dark image. The taste inspector had warned about the same 368px blank stretch, and it was explained away instead of fixed.
Decision: the T-031 photograph (Pexels, a hand paying with a phone at a café counter) fills the top of Welcome, darkened in CSS (brightness 0.6, saturation 0.7) so it sits in the ink, with a hard edge where the ink begins; the logo and test mode sit on it. No scrim or gradient: in direction A a photograph is printed, like on a slip.
Alternatives: the photograph full screen under an ink gradient scrim (T-031's layout; it fails direction A's no-gradient rule and the taste inspector's gradient check); the ink page alone (T-044; empty above the fold).
Consequences: `src/photos/` and the image credit in Conta are back; PRODUCT.md and DESIGN.md updated. The link-preview card still shows the older layout (follow-up from DEC-060).

### DEC-062: WalletConnect through the kit's own module, testnet only (2026-11-03, T-046)
Context: the human asked for WalletConnect, so a phone wallet can connect to the app open on another screen (a desktop browser), beyond the in-wallet browsers and extensions the kit already reaches.
Decision: use Stellar Wallets Kit 2.7.1's `WalletConnectModule` (installed source read: it wraps `@walletconnect/sign-client` 2.23 and Reown AppKit 1.8.21, requests `stellar_signXDR` and optionally `stellar_signAndSubmitXDR`, `stellar_signAuthEntry`, `stellar_signMessage`, on the chains `stellar:pubnet` or `stellar:testnet`, defaulting to pubnet). Vants passes `allowedChains: [testnet]` always (INV-07), metadata (Vants, the page's origin, its icon) and AppKit theming in direction A. It is offered only when the build has a Reown project id (`VITE_WALLETCONNECT_PROJECT_ID`, 32 hex; public, not a secret), and it is imported dynamically so AppKit stays out of the main bundle. The kit starts asynchronously now (`start()` returns a promise every caller awaits); signing waits up to 10 s for the WalletConnect client after a reload; a lost or expired session becomes "A conexão com a sua carteira caiu…".
Alternatives: wiring `@walletconnect/sign-client` directly (duplicates what the kit already does and keeps in its session store); Reown AppKit's own Stellar adapter (`[VERIFY: whether AppKit 1.8 has a Stellar adapter]`, a second wallet layer beside the kit).
Consequences: the human creates a Reown project and adds the web domain (and localhost for development) to its allowlist; the id is passed at build time (README, `deploy/web.sh`). Which phone wallets accept `stellar:testnet` over WalletConnect is `[VERIFY: Freighter mobile and LOBSTR testnet support over WalletConnect]`, to be checked with the real id; Raven had no source for it (2026-11-03). With the human's id (2026-11-03, `apps/web/.env.local`, git-ignored): on localhost the picker's WalletConnect opens Reown's modal with a pairing and its wallet directory, Freighter (listed as Varial), LOBSTR and Scopuly first, then EVM wallets that can't sign for Stellar; limiting the list (`includeWalletIds`) left it loading forever and `allWallets: "HIDE"` had no effect, so the kit's defaults stay. No console errors. A phone scan is still to do.

### DEC-063: Pier adapter over the REST API, without the published SDK (2026-11-04)
Context: the adapter used three things from the SDK: list and create subscriptions, read a page of events, and verify a webhook.
Decision: `PierGateway` calls `/v1/subscriptions` and `/v1/subscriptions/:id/events` directly with `x-api-key`; `verifyPierWebhook` uses `standardwebhooks`. Supersedes the second Stellar SDK accepted in DEC-015.
Alternatives: keeping the SDK; replacing Pier itself (a larger change, still open).
Consequences: one Stellar SDK in the lockfile. The hosted Pier service is still needed, with its address and key in the environment.

### DEC-064: A deposit needs the named asset's own contract (2026-11-05, T-047)
Context: `parseTransfer` takes the asset's name from the event's topic. Any contract can emit a `transfer` naming real USDC, and an unknown muxed id or a wrong-asset match then refunded real USDC from the treasury. Whether Pier's `payment` filter lets such events through is not known (its source is not in this repository), so the check does not rely on it.
Decision: the deposit matcher ignores, with a log line, an event whose `contractId` is not the SAC of the asset it names (`sacMatchesAsset` in `@vants/adapter-stellar`). The check is in the worker because adapters never import each other (§3.8).
Alternatives: filtering in `parseTransfer` (the Pier adapter can't import the Stellar one); an allowlist of funding assets (would stop refunding real wrong-asset deposits, which D5 requires).
Consequences: strengthens INV-01 and INV-10. The event stays in the inbox as received and processed, with no other record.

## §11 Open questions

| #  | Question | Blocks |
|----|----------|--------|
| Q1 | ~~Register the Hodle webhooks~~ **Done 2026-10-22** by the human: all five events → `https://<tunnel>.ngrok-free.dev/ingress/hodle/<EVENT>` (ngrok dev domain, stable across restarts), secrets in `HODLE_WEBHOOK_SECRETS`. T-007 found that the sandbox sends **no** PAYOUT_* or DEPOSIT_* event for the USDH test-wallet payout or a settled sandbox deposit (DEC-027). So the design's fallbacks stay: payouts rely on the final 202 (watchdog off), and the refill credit (D6, T-016) is confirmed by the balance poll. See Q11. | — |
| Q2 | **Ask Hodle to enable `WALLET_PAYOUT_API` on the sandbox key.** That unlocks `GET /api/wallet/payout/:id` for reconciliation after Hodle's 3 webhook retries run out. | INV-03 strength (not blocking) |
| Q3 | ~~Which Pier~~ **Resolved 2026-10-22:** the deployed Pier (DEC-012). Still needed from the human: a **Pier team API key** (dashboard at `<PIER_API_URL>/dashboard/`, GitHub sign-in) in `PIER_API_KEY`. | T-008 needs the key |
| Q4 | ~~Repository~~ **Resolved 2026-10-22:** a new project at `this repository` (the human's choice), local git. Still open: a remote (GitHub) and when. | — |
| Q5 | ~~Mini-app auth~~ **Resolved 2026-10-22:** "follow Stellar best practices on LOBSTR and how other wallets use apps", so SEP-10 through the wallet's `signTransaction` (DEC-011). Open detail: does LOBSTR sign SEP-10 `client_domain` challenges as a host wallet? `[VERIFY with LOBSTR]` | — |
| Q6 | **Unattributed deposits** (unknown muxed id). Testnet default implemented in T-011 (DEC-025): auto-refund to the sender, memo `vants:rf:<mux>:u<n>`. A transfer with *no* muxed id is recorded but never refunded (it may be our own top-up). In production, senders can be exchanges or omnibus accounts, so the policy needs your call before mainnet. | Mainnet only |
| Q7 | **Wallets for D2.** Freighter and xBull on testnet are proposed. Whether LOBSTR works on testnet through WalletConnect is `[VERIFY]`; if it does, add it to D2. | T-021 |
| Q8 | **Fee model in demos.** Show the sandbox fee (0) or model Hodle's default (R$ 1.50 + 2.5%) so the economics are visible? | T-010, T-021 copy |
| Q9 | ~~License~~ **Resolved:** proprietary, all rights reserved (`LICENSE`). | — |
| Q10 | ~~Pier's SDK pins an older Stellar SDK~~ **Resolved** by DEC-063: the adapter no longer uses the SDK. | — |
| Q11 | **Ask Hodle:** does the sandbox emit PAYOUT_SUCCESSFUL / DEPOSIT_ASSET_SUCCESS at all (e.g. only for BRL Pix payouts behind `WALLET_PAYOUT_API`, cf. Q2), and is `X-Webhook-Id` stable across retries (a better dedupe key than the body ids)? Until answered, real Hodle event bodies stay unverified and D4's Hodle replay half stays simulated. | D4 (Hodle half), T-016 credit path, the payout watchdog |
| Q13 | **Photography for launch.** The welcome screen uses one CC0 Unsplash photograph of real people as a stand-in (DEC-044). CC0 covers the copyright, not the people's image rights; a launch needs Vants' own model-released photography (or licensed stock with releases). | Public launch |
| Q14 | **Etherfuse delivery of TESOURO.** The sandbox marks onramp orders completed without a Stellar payment (DEC-047). Confirm with Etherfuse that production delivers TESOURO on Stellar, and how a delivery is reported (`confirmedTxSignature` as a Stellar hash?). | Ramp in production |
| Q12 | **WalletConnect project id** (cloud.reown.com, free) to enable LOBSTR mobile and other WalletConnect wallets in the mini app. Desktop LOBSTR (extension), Freighter and xBull work without it. | LOBSTR mobile in D2 |
| Q15 | **Books alarm on a growing gap (T-034 audit).** `books.ts` raises `ReconciliationDrift` only when the same non-zero difference repeats (§3.7's wording); a gap that grows every run (e.g. payouts whose USDH debit is missing and booked as 0 by `hodle-events.ts` / the Hodle client's `?? "0"`) reads `mismatch` forever and never alarms, while `float:hodle` is overstated and quotes pass that the float can't cover. Proposed: alarm on any non-zero difference on two runs in a row, and treat a missing debit as unknown (pending/review), never 0. Changing the rule is yours. | Mainnet pilot; INV-06 strength |
