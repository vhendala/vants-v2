# Vants PoC: Sources

Every external fact the spec depends on, with the date it was checked. Stellar facts come from the Raven MCP (§0).
"Spike" means measured in `the earlier spike` (logs and results there).

## Facts

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | Soroban transactions hold one operation | "Smart contract transactions (InvokeHostFunctionOp, …) can only have one operation per transaction" | docs | Raven `stellarDocs.search_docs`, https://developers.stellar.org/docs/learn/fundamentals/transactions/operations-and-transactions |
| 2026-10-22 | Contract invocations carry no memo; SAC `transfer` takes a MuxedAddress | "a transaction that invokes a contract must set MEMO_NONE"; since Protocol 23 (CAP-67) the SAC `transfer` `to` is a `MuxedAddress` (G… or M… with a 64-bit id); only `transfer` accepts it | Protocol 23 | Raven `stellarDocs.search_docs`, https://developers.stellar.org/docs/tokens/stellar-asset-contract#sending-to-a-muxed-address |
| 2026-10-22 | Transfer events carry the muxed id / memo | CAP-67 unified events: payment ops and SAC transfers emit the same event; `toMuxedInfo` is set for an M… destination and/or a transaction memo (non-contract txs) | Protocol 23 | Raven `stellarDocs.search_docs`, https://developers.stellar.org/docs/build/guides/transactions/send-and-receive-c-accounts ; token-transfer-processor docs |
| 2026-10-21 | Memo id appears as `to_muxed_id` in the transfer event (measured) | XLM G→G with memo id `123456789` → event value `{ amount, to_muxed_id: 123456789 }`; muxed destination → same field | Protocol 29, RPC 30.0.0 | Pier `docs/SOURCES.md` (measured on testnet) |
| 2026-10-19 | SDF testnet RPC emits classic payment events | Yes (EMIT_CLASSIC_EVENTS on) | — | Pier `docs/SOURCES.md`, SPEC §11 Q12 |
| 2026-10-22 | Anchor Platform SEPs | SEP-1, 6, 10, 12, 24, 31 (receive), 38, 45 | docs | Raven `stellarDocs.search_docs`, https://developers.stellar.org/docs/platforms/anchor-platform#supported-seps |
| 2026-10-22 | Stellar Wallets Kit | Live; xBull, Freighter, Albedo, Rabet, Ledger, Trezor, WalletConnect, HOT behind one interface; published on JSR as `@creit-tech/stellar-wallets-kit` | — | Raven `scout.searchProjects`, `lumenloop.search_content_semantic` |
| 2026-10-22 | LOBSTR dApp access | Through WalletConnect; no public mini-app platform found | — | Raven `scout.searchProjects` (lobstr, walletconnect); LOBSTR App Store listing; lobstr.co homepage |
| 2026-10-22 | CCTP on Stellar | Domain 27; Stellar-sourced transfers execute at Standard (finality 2000), fee 0; inbound to Stellar must use `CctpForwarder` (testnet `CA66Q2WF…`, mainnet `CBZL2IH7…`) | — | Raven `skills.stellar-dev.cross-chain` (cctp.md); Iris fees endpoint; spike Track B |
| 2026-10-22 | DeFindex testnet contracts | Vault `CBMVK2JK6NTOT2O4HNQAIQFJY232BHKGLIMXDVQVHIIZKDACXDFZDWHN` (asset BlendUSDC SAC `CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU`, `USDC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56`), factory `CDSCWE4G…` | testnet.contracts.json | https://github.com/defindex-io/stellar-contracts/blob/main/public/testnet.contracts.json ; spike `defindex:vault` |
| 2026-10-22 | DeFindex vault methods | `deposit(amounts_desired, amounts_min, from, invest)`, `withdraw(withdraw_shares, min_amounts_out, from)`, `balance(from)`; shares = total_supply × amount / total_amount | docs | https://docs.defindex.io/advanced-documentation/direct-contract-calls/vault-methods |
| 2026-10-22 | Circle testnet USDC (CCTP) | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`, SAC `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | — | spike `src/cctp/addresses.ts` (Circle docs, 2026-09-29) |
| 2026-10-22 | Blend testnet faucet | `GET https://ewqw4hx7oa.execute-api.us-east-1.amazonaws.com/getAssets?userId=G…` returns a JSON-quoted, issuer-signed tx to co-sign (1000 USDC, 5000 BLND, wETH, wBTC) | — | blend-capital/blend-ui `src/contexts/wallet.tsx`; spike `defindex:setup` |
| 2026-10-22 | Hodle sandbox host and keys | `https://sandbox-api.hodle.com.br`; keys `hodle_test_…`; a live key is rejected there | docs | https://docs.hodle.com.br/docs/sandbox |
| 2026-10-22 | Hodle sandbox stables | USDH `0x1c7af3c850c1d1d8d97d40db0acdd0195c6323f7` (6 dec), BRLH `0x4ec5f42ee07d5d1cfe431ec7059df4df556d44a8` (18 dec), Base Sepolia 84532, fixed 1 USD = 5.4 BRL, truncated | docs | https://docs.hodle.com.br/docs/sandbox |
| 2026-10-22 | USDH payouts work without `WALLET_PAYOUT_API` (measured) | `POST /api/wallet/payout {asset:"USDH"}` → 202 `COMPLETED` (~2.3 s), `endToEndId` `SANDBOX…`, `X-Hodle-Sandbox: simulated`; `/api/wallet/keys` and `GET /api/wallet/payout/:id` → 403 | — | spike `hodle:brcode` |
| 2026-10-22 | Hodle sandbox accepts any `qrCode` (measured) | Amount mismatch, bad CRC, truncated and arbitrary text all `COMPLETED`; `value` required even for codes with an amount | — | spike `hodle:brcode` (validation-* cases) |
| 2026-10-22 | `externalId` replay (measured) | Same transactionId, no second debit; `alreadyProcessed` absent (docs promise it) | — | spike `hodle:brcode` replay |
| 2026-10-22 | Concurrent payouts collide (measured) | 2nd → `422 SANDBOX_SETTLEMENT_FAILED` (EVM nonce) | — | spike `hodle:brcode` concurrent |
| 2026-10-22 | Funding the sandbox float | `POST /api/deposit/asset {value, asset:"USDH"}` → `trackId`; `POST /avenia/webhook {event:{subscription:"TICKET",data:{type:"DEPOSIT-SUCCESS",ticket:{id}}}}` with the test key → `{settled:true}`; idempotent | docs + measured | https://docs.hodle.com.br/docs/sandbox ; spike |
| 2026-10-22 | Hodle webhook signing | `X-Hodle-Signature = hex(HMAC_SHA256(secret, "<X-Hodle-Timestamp>.<raw body>"))`; reject > 5 min; constant-time compare; one webhook per event, each with its own 64-hex secret; `WEBHOOK_TEST` sent at registration before the secret is shown | docs | https://docs.hodle.com.br/docs/webhooks |
| 2026-10-22 | Hodle webhook retries | Payout/KYC events: 3 retries at 10 s, 60 s, 5 min, then never again (read state via GET). Deposit events: every minute until 2xx, in order per deposit, dedupe on `data.eventId` | docs | https://docs.hodle.com.br/docs/webhooks#retry-policy |
| 2026-10-22 | Hodle default payout fee | R$ 1.50 + 2.5% of value on stablecoin networks; custom per-account pricing possible | docs | https://docs.hodle.com.br/docs/wallet-payout#fees |
| 2026-10-22 | Hodle upstream | Sandbox calls go to "Avenia's own sandbox" | docs | https://docs.hodle.com.br/docs/sandbox |
| 2026-10-22 | Pier API | `POST /v1/subscriptions {filter, network?, webhook?}`; payment filter `{type:"payment", account, direction}`; pull `GET /v1/subscriptions/:id/events?after=&limit=` (ordered, gap-free within retention); webhooks Standard Webhooks; push is at least once, unordered; dedupe by `pier-event-id`; retention ≥ 7 days | v1 | Pier `docs/llms.txt`, `docs/SPEC.md` §5 |
| 2026-10-22 | Pier SDK | `Pier's SDK` 0.1.0 on npm (`subscriptions.create`, `events`, `stream`, `verifyWebhook`) | 0.1.0 | `npm view`; Pier `packages/sdk/src/index.ts` |
| 2026-10-22 | Pier hosted instance | GCP VM at an ephemeral IP (sslip.io name); domain not registered | — | Pier SPEC §11 Q5, Q19 |
| 2026-10-22 | `@stellar/stellar-sdk` latest | 17.3.0 (2026-10-21, "Protocol 30"); 17.2.1 (2026-10-01); lts-16 16.4.1; engines `node >= 22.12.0` | 17.3.0 | `npm view @stellar/stellar-sdk dist-tags time engines` |
| 2026-10-22 | SDK 17.3.0 WebAuth exports | `buildChallengeTx`, `readChallengeTx`, `verifyChallengeTxSigners`, `verifyChallengeTxThreshold`, `gatherTxSigners`, `verifyTxSignedBy`, `InvalidChallengeError`; no SEP-45 helpers | 17.3.0 | `npm pack @stellar/stellar-sdk@17.3.0`, `lib/esm/webauth/*.d.ts` (inspected, not executed) |
| 2026-10-22 | SDK 17.3.0 SEP-10 fixes | #1788: verifiers now reject a `client_domain` op with no source (the check was skipped before); #1791: the server signature no longer counts as the client-domain signature; `build()` rejects Soroban txs with a memo or muxed source (#1811, #1835); contract clients reject muxed addresses for `Address` params | 17.3.0 | https://github.com/stellar/js-stellar-sdk/releases/tag/v17.3.0 (via `gh api`) |
| 2026-10-22 | SEP-10 | Challenge/response web auth for accounts; `GET /auth?account[&memo][&home_domain][&client_domain]` → challenge XDR; `POST /auth {transaction}` → JWT; supports muxed/memo users; discovered via `stellar.toml` `WEB_AUTH_ENDPOINT` + `SIGNING_KEY` | sep-0010 | Raven `scout.searchResearch` (sep), `stellarDocs.search_docs` (Anchor Platform SEP-10 guide) |
| 2026-10-22 | SEP-45 | Web auth for contract accounts (C…) using Soroban authorization entries; `WEB_AUTH_FOR_CONTRACTS_ENDPOINT`, `WEB_AUTH_CONTRACT_ID` with `web_auth_verify` | — | Raven `stellarDocs.search_docs` (Anchor Platform SEP-45 guide) |
| 2026-10-22 | SEP-53 / SEP-43 / SEP-60 | SEP-53 Sign and Verify Messages: Final, v1.0.0 (updated 2026-06-18). SEP-43 Standard Web Wallet API: `signTransaction`, `signAuthEntry`, `signMessage`. SEP-60 Wallet Provider Discovery: draft v0.1.0 (2026-09-30) | — | Raven `scout.searchResearch` source=sep |
| 2026-10-22 | Stellar Wallets Kit v2 | JSR `@creit-tech/stellar-wallets-kit`; static API (`init`, `authModal()`, `signTransaction`); `defaultModules()`; WalletConnect, Ledger and Trezor added explicitly; npm updates "will eventually stop" | v2 | Raven `skills.stellar-dev.dapp` (wallet-integration) |
| 2026-10-22 | LOBSTR app connectivity | WalletConnect (mobile); open-source signer browser extension with a "Log in with LOBSTR" SDK; Offer Hub (SCF #44) ships Wallets Kit login with Freighter, LOBSTR and xBull | — | Raven `lumenloop.search_content_semantic` (github.com/Lobstrco/lobstr-browser-extension; youtube Offer Hub demo, 2026-09-01) |
| 2026-10-22 | Deployed Pier health | `GET https://<pier-host>/health` → 200 `{status:"ok", ingestLagSeconds:4, matcherBacklog:0}`; `/llms.txt` served | — | curl |
| 2026-10-22 | Spike timings | Scan → paid p50 3.5 s (debit confirmed) / 2.4 s optimistic; DeFindex withdraw 3.9 s; CCTP burn → mint p50 10.8 s | — | spike `float:pay`, `defindex:vault`, `REPORT.md` |
| 2026-11-03 | Archivo font | Variable font, axes wdth 62–125 and wght 100–900; SIL Open Font License 1.1, "Copyright 2020 The Archivo Project Authors"; Google Fonts serves it as unicode-range subsets (latin, latin-ext used) | v25 (fonts.gstatic.com path) | https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900 and https://github.com/google/fonts/tree/main/ofl/archivo (fetched 2026-11-03) |
| 2026-11-03 | Stellar Wallets Kit WalletConnect module | `WalletConnectModule({ projectId, metadata, allowedChains?, signClientOptions?, appKitOptions? })`; chains `stellar:pubnet` (default) / `stellar:testnet`; required method `stellar_signXDR`, optional `stellar_signAndSubmitXDR`, `stellar_signAuthEntry`, `stellar_signMessage`; sessions kept in the kit's `wcSessionPaths` (localStorage) | 2.7.1 (deps `@walletconnect/sign-client` 2.23.0, `@reown/appkit` 1.8.21) | installed source `node_modules/@creit.tech/stellar-wallets-kit/esm/sdk/modules/wallet-connect.module.{js,d.ts}` (read 2026-11-03); Raven had no WalletConnect-on-Stellar source |

### Facts checked in T-001

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | pg-boss transactional send | `SendOptions = JobOptions & QueueOptions & ConnectionOptions`; `ConnectionOptions { db?: IDatabase }`; `IDatabase.executeSql(text, values?) → Promise<{ rows }>`; README: "Create jobs in an existing db transaction" | 12.38.0 | installed `dist/types.d.ts`, README |
| 2026-10-22 | Fastify raw body | `addContentTypeParser(…, { parseAs: 'buffer' }, …)` supported | 5.12.7 | installed `types/content-type-parser.d.ts` |
| 2026-10-22 | Installed API checks | stellar-sdk 17.3.0: `WebAuth.{buildChallengeTx, readChallengeTx, verifyChallengeTxSigners, verifyChallengeTxThreshold, gatherTxSigners, verifyTxSignedBy}`, `MuxedAccount`, `StrKey.isValidMed25519PublicKey`; pier-sdk 0.1.0: `Pier, PierError, filters, topic, verifyWebhook`; standardwebhooks 1.1.1: `Webhook#sign/verify`; viem 2.57.8: `createPublicClient, parseEventLogs, erc20Abi` | as listed | imported from each owning package under Node 24.18.1 |
| 2026-10-22 | pnpm minimum release age | pnpm 11.21.0 rejected releases newer than the cutoff 2026-10-21T21:09Z (viem 2.57.10, ox 0.14.57) and auto-added exemptions for exact pins | 11.21.0 | `pnpm install` output |
| 2026-10-22 | Transitive Stellar SDK | `Pier's SDK` 0.1.0 depends on `@stellar/stellar-sdk` 17.2.0 | 0.1.0 | `pnpm why @stellar/stellar-sdk` |
| 2026-10-22 | Postgres image | `postgres:18.6` is the newest 18.x tag | 18.6 | Docker Hub tags API |

### Facts checked in T-002

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | pg-boss transactional workers | `work(name, { transactional: true }, (jobs, tx: IDatabase) => …)`: the handler and the job's completion run in one database transaction; `transactionTimeoutSeconds` defaults to `expireInSeconds` + 5 | 12.38.0 | installed `dist/types.d.ts` (`WorkOptions`, `TransactionalWorkHandler`); proven by `backbone.int.test.ts` |
| 2026-10-22 | pg-boss fan-out | `subscribe(event, queue)`, `publish(event, data, SendOptions)` where `SendOptions` includes `{ db }` | 12.38.0 | installed `dist/index.d.ts`; proven by `backbone.int.test.ts` |
| 2026-10-22 | pg-boss queues | Queues must be created (`createQueue`); names match `/^[\w.\-/]+$/`; `retryDelayMax` only with `retryBackoff: true`; `notify` enables LISTEN/NOTIFY wake-ups; polling interval ≥ 0.5 s | 12.38.0 | installed `dist/attorney.js`, `dist/types.d.ts`; the `retryDelayMax` rule hit in the first test run |
| 2026-10-22 | pg-boss export | Named export `PgBoss` (class); 'error' events must have a listener | 12.38.0 | installed `dist/index.d.ts` |
| 2026-10-22 | node-pg-migrate | `runner({ databaseUrl, dir, direction, migrationsTable, advisoryLockMode, log })`; SQL files with `-- Up Migration` / `-- Down Migration` | 9.0.0 (2026-07-17) | installed `dist/bundle/index.d.ts`; Pier `packages/log/migrations/` |

### Facts checked in T-006

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | Hodle webhook test delivery | `WEBHOOK_TEST` is sent at registration, before the dashboard shows the secret; answer 2xx and take no action | docs | https://docs.hodle.com.br/docs/webhooks#the-registration-test-delivery |
| 2026-10-22 | Hodle payout webhook ids | `PAYOUT_SUCCESSFUL` carries `transactionId`, `externalId` (our idempotency key, `null` for non-API payouts), `txHash`, `endToEndId`, `quote.assetAmount`; `PAYOUT_FAILED`'s documented example carries only `invoice` (the on-chain tx id), `pixKey`, `valueInBrl`, `errorCode`; `PAYOUT_REFUNDED` dedupes on `reversalTicketId` / `refundTxId` | docs | https://docs.hodle.com.br/docs/webhooks |
| 2026-10-22 | Hodle deposit webhook dedupe | `data.eventId`, the same on every retry; deposit events retry every minute until 2xx, in order per deposit | docs | https://docs.hodle.com.br/docs/webhooks#deposit-status-events |
| 2026-10-22 | Recorded sandbox exchanges | `packages/adapters/hodle/test/fixtures/*.json`: payout 202 COMPLETED, 400 `SANDBOX_INSUFFICIENT_BALANCE`, 422 `SANDBOX_SETTLEMENT_FAILED`, 400 validation, wallet read, USDH deposit, settle | — | spike logs (`spike/logs`, 2026-10-22) |
| 2026-10-22 | Pier team API key | The key `pier-cli login` stored (`~/Library/Preferences/pier-nodejs/config.json`, apiUrl = the deployed instance) authenticates: `GET /v1/me` → 200. Copied to `.env` `PIER_API_KEY` with the human's authorization (2026-10-22) | — | `GET /v1/me` |

### Facts checked in T-008

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | Pier transfer envelope (measured) | Classic XLM payment with memo id 42, and native-SAC `transfer` to `M…(treasury, 43)`: both `type: "contract"`, `contractId` = native SAC `CDLZFC3S…CYSC`, `decoded.topic = ["transfer", from G, to G (base), "native"]`, `decoded.value = { amount: "<stroops>", to_muxed_id: "<id>" }` | Pier v1, testnet P29 | `packages/adapters/pier/test/fixtures/envelopes.json` (probe `record-pier-envelopes.ts`, ledgers 5,336,366–5,336,367) |
| 2026-10-22 | Pier SDK surface | `subscriptions.{create,list,get,delete}`, `page(id,{after,limit})` → `GET …/events?after=&limit=`, `events`, `stream`, `verifyWebhook(body, headers, secret)` (Standard Webhooks, throws on failure); `list` reads `.subscriptions`; no destinations API (a webhook is added at creation) | 0.1.0 | installed `dist/index.js`, `dist/index.d.ts` |
| 2026-10-22 | Pier subscription status | New subscriptions are `pending` until the matcher activates them | Pier v1 | probe output |
| 2026-10-22 | SDK 17.3.0 XDR objects | Typed classes (e.g. `ScAddressMuxedAccount`) with `value`/`toXdrObject`; no `switch()`. `Address.fromString(M…).toScVal()` encodes a muxed account and round-trips | 17.3.0 | installed SDK, probe |
| 2026-10-22 | Live pull | Treasury subscription `9646a3f6-1276-432f-a6bb-4833eafdfd6b` on the deployed Pier; a 1.5 XLM memo-777 payment (`acbfd572…3247`) reached the local inbox via `pnpm pier:pull` | — | `pnpm pier:pull`, `psql` |

### Facts checked in T-009

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | SDK 17.3 byte values | `Transaction.hash()` returns `Uint8Array` (its `toString` ignores `"hex"`); a text `Memo.value` is bytes | 17.3.0 | live smoke failure (`unexpected hash length (118)` from RPC), unit test |
| 2026-10-22 | Contract transactions and memos | `TransactionBuilder.build()` rejects Soroban txs with a memo (17.3 changelog); refunds are therefore classic payments | 17.3.0 | release notes v17.3.0 |
| 2026-10-22 | Refund resubmission (measured) | Same envelope resubmitted after landing: `SUCCESS`, one payment on the ledger (`2f72b3a8…45b6`) | testnet | `packages/adapters/stellar/test/smoke-refund.ts` |

### Facts checked in T-010

No new Stellar facts: deposit addresses reuse DEC-004/DEC-023 (muxed `M…` + memo id), checked again by decoding with the SDK.

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | zod → JSON Schema | `z.toJSONSchema(schema, { io: "output" })` emits draft 2020-12, which OpenAPI 3.1 accepts as-is | zod 4.6.7 | zod 4 docs (JSON Schema), `openapi.ts` + test |
| 2026-10-22 | Fastify per-request state | Request decoration via `declare module "fastify"` + `onRequest` hook in an encapsulated plugin | fastify 5.12.7 | Fastify docs (Hooks, TypeScript) |
| 2026-10-22 | Postgres advisory locks | `pg_advisory_xact_lock(bigint)` is released at commit/rollback, so it serializes concurrent requests per Idempotency-Key | Postgres 18.6 | Postgres docs §9.28.10 |

### Facts checked in T-011

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | pg-boss queue policies | `stately`: one job per state (queued and/or active); `singleton`: one active; `exclusive`: one queued or active. A policy is fixed when the queue is created | pg-boss 12.38.0 | `node_modules/pg-boss/dist/types.d.ts` (`QueuePolicy`), backbone test (3 sends → 1 job) |
| 2026-10-22 | pg-boss cron | `schedule(name, cron)` stores the schedule in `pgboss.schedule`; minute resolution | pg-boss 12.38.0 | `dist/index.d.ts`, wiring test |
| 2026-10-22 | Envelope amounts read back | `TransactionBuilder.fromXDR(...).operations[0].amount` is always 7 decimals (`"1.5000000"`) | stellar-sdk 17.3.0 | saga tests |
| 2026-10-22 | Two envelopes, one sequence number | Only one of two envelopes with the same source sequence can land; a rebuilt envelope is safe only once the old one can't land (deadline passed), or it takes the next sequence and both land | protocol | DEC-023; reproduced by the fake ledger's "lands late" case |
| 2026-10-22 | Live payout and refund (measured) | Exact 1 USDC deposit → sandbox payout in 18 s; 0.5 USDC underpayment → refund `fa8f1571…6b2e` with memo `vants:rf:ru:1` in 40 s | testnet + Hodle sandbox | DEC-025 evidence, Horizon |

### Facts checked in T-012

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | Standard Webhooks API | `new Webhook(secret).sign(msgId, Date, payload)` and `.verify(payload, headers)`; verify rejects timestamps more than 5 min off the local clock | standardwebhooks 1.1.1 | `dist/index.d.ts`, notifier tests |
| 2026-10-22 | Pier ingress without a secret | With `PIER_WEBHOOK_SECRET` empty (pull-only subscription), the api answers 401 to every delivery; Pier push needs a public URL | — | `apps/api/src/ingress/pier.ts`, first G-B run |
| 2026-10-22 | `--env-file` precedence | Variables already in the process environment are not overridden by `node --env-file`, so a run can be given throwaway secrets without editing `.env` | Node 24.18.1 | G-B runner (secrets took effect) |
| 2026-10-22 | G-B timings (measured) | D1 deposit → payout 32 s, → webhook 35.4 s; D5 refunds 15–30 s after the deposit's ledger close (Pier pull every 30 s dominates) | testnet + Hodle sandbox | `docs/evidence/g-b-2026-10-22T22-39-27.023Z.json` |

### Facts checked in T-007

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | Hodle webhook validation ping | `POST` with `User-Agent: Webhook-Validation/1.0`, body `{"event":"WEBHOOK_TEST","data":{"test":true,"message":…}}`, headers `X-Hodle-Signature`, `X-Hodle-Timestamp`, `X-Webhook-Event`, `X-Webhook-Id` | sandbox | ngrok capture, `docs/evidence/t-007-validation-pings.json` |
| 2026-10-22 | Hodle signature scheme (measured) | `hex(HMAC_SHA256(secret, "<X-Hodle-Timestamp>.<raw body>"))` verifies on real deliveries; each event's secret verifies only its own URL's pings | sandbox | offline verification of the 5 pings |
| 2026-10-22 | Sandbox event webhooks | None sent for a USDH test-wallet payout (completed, 202) or a settled sandbox deposit, within 5 min | sandbox | `docs/evidence/t-007-2026-10-22T22-58-17.873Z.json` |
| 2026-10-22 | Pier subscriptions API | `create`, `list`, `delete`; no update, so a new webhook URL means a new subscription | Pier's SDK 0.1.0 | `dist/index.d.ts` |
| 2026-10-22 | Pier push latency (measured) | Webhook at the api about 2 s after the payment was submitted to Horizon | deployed Pier, testnet | api log, top-up `4d02feef…6053` |
| 2026-10-22 | ngrok free dev domain | `https://<three-words>.ngrok-free.dev`, the same URL after an agent restart | ngrok agent | restart test |

### Facts checked in T-015

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | Fee charged per transaction | `TransactionResult.feeCharged` (int64, "actual fee charged for the transaction"); in SDK 17.3 a `bigint` property on `getTransaction(...).resultXdr` | stellar-sdk 17.3.0 | `lib/esm/xdr/generated/transaction-result.d.ts` |
| 2026-10-22 | Failed transactions pay their fee | A transaction that reaches the ledger and fails (`txFAILED`) is applied for fee and sequence; invalid ones (rejected before the ledger) pay nothing | protocol | CAP-0022 (Raven: scout.searchResearch, github.com/stellar/stellar-protocol/blob/master/core/cap-0022.md, observed 2026-10-22) |
| 2026-10-22 | Classic refund fee (measured) | 100 stroops per refund envelope (base fee), seen as −400 stroops of XLM for 4 refunds | testnet | D7 run, `docs/evidence/d7-2026-10-22T23-20Z.json` |
| 2026-10-22 | Hodle sandbox debit per payout (measured) | R$ 2.70 payout debited exactly 0.500000 USDH (rate 5.4, fee 0), so the ledger's `debit6` from `stableAmount` matches the balance | sandbox | D7 run |

### Facts checked in T-016

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-23 | CCTP on Stellar testnet | TokenMessengerMinter `CDNG7HXA…RTHP`, MessageTransmitter `CBJ6MTCK…VVJY`, CctpForwarder `CA66Q2WF…VSZ`; domain 27 (`get_local_domain`); the testnet table lists no USDC contract | CCTP V2 | developers.circle.com/cctp/references/stellar-contracts (fetched 2026-10-23); Stellar docs defer to it (Raven: stellarDocs, developers.stellar.org/docs/tokens/cross-chain-transfers) |
| 2026-10-23 | CCTP live on Stellar | Announced 2026-05-19 | — | stellar.org/blog/foundation-news/circle-cctp-is-live-on-stellar (Raven: scout.searchResearch, sdf-blog) |
| 2026-10-22 | Hodle sandbox deposit response | Gives `fxRateAtTx` (5.4) and `fee` (0), not the USDH credited; R$ 5.40 credited exactly 1.000000 USDH | sandbox | fixture `deposit-usdh.json`, D6 run |
| 2026-10-22 | Soroban fees (measured) | SAC `approve` 25,571 stroops, `deposit_for_burn` 14,235 stroops (resource fees included), from `feeCharged` | testnet | D6 run |
| 2026-10-22 | CCTP Stellar → Base (measured) | Burn → attestation 6 s, mint 1.5 s, `feeExecuted` 0, minted = amount | testnet + Base Sepolia | D6 run |

### Facts checked in T-018

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-22 | Base reserve and subentries | One base reserve is 0.5 XLM; each subentry (trustline, offer, signer, data entry) adds one to the minimum balance | protocol | Raven: stellarDocs, developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts (observed 2026-10-22) |
| 2026-10-22 | Liabilities | Trustlines track buying and selling liabilities (amounts held by offers) | protocol | same page, "Trustlines" |
| 2026-10-22 | Path quotes | Horizon finds strict-send paths from a source asset and amount (`strictSendPaths`) | Horizon | Raven: stellarDocs, developers.stellar.org/docs/build/apps/example-application-tutorial/querying-data#findstrictsendpaths |
| 2026-10-23 | DeFindex testnet contracts | factory `CDSCWE4G…4A32`, `usdc_paltalabs_vault` `CBMVK2JK…ZDWHN`, `USDC_blend_strategy` `CALLOM5I…FSUY` | — | github.com/paltalabs/defindex `public/testnet.contracts.json` (fetched 2026-10-23) |
| 2026-10-23 | Pix key formats (DICT) | five kinds: CPF (11 digits, mod-11 check digits), CNPJ (14 digits, mod-11 with weights 5..2/6..2), e-mail (≤77 chars), phone `+55` + DDD + number, EVP (UUID); keys are stored without punctuation, e-mail and EVP in lower case | — | `[VERIFY: from memory of the BCB DICT and "Manual de Padrões para Iniciação do Pix"; not fetched]`; the Hodle sandbox accepted `+5511987654321` (live payout 2026-10-23) |
| 2026-10-23 | Soroswap testnet contracts | router `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`, factory `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY` (also `api.soroswap.finance/api/testnet/router`) | router wasm `4b95bbf9…824c` | github.com/soroswap/core `public/testnet.contracts.json` (fetched 2026-10-23) |
| 2026-10-23 | Soroswap router methods | `swap_tokens_for_exact_tokens(amount_out, amount_in_max, path, to, deadline)`, `router_get_amounts_in(amount_out, path)`; the input is taken from `to` under `to`'s authorization | deployed router | `stellar contract info interface` on the testnet router; OtterSec Soroswap audit (Raven `scout.searchResearch`, "RequiredForToken Transfer") |
| 2026-10-23 | Soroswap testnet pairs used by DEC-034 | XLM/Blend USDC `CBR76WMT6J733CCVBP23M2EL5QGP5HXLPEFNFZGZ7IB6QHOJAHP7YM3V` (reserves 1,765.3 USDC / 7,605.8 XLM); XLM/Circle USDC `CCBX3NZTCQLQFSPG7HBOKL4P2RVPOPVFHDNRTOSCCJWBTPL2GHEH7RQS` (419,397.8 USDC / 3,915,700.3 XLM) | — | factory `get_pair` + pair `get_reserves`, simulated on testnet 2026-10-23 |
| 2026-10-23 | DeFindex vault shares are a token | the vault exposes `transfer(from, to, amount)`, `balance`, `approve`, `allowance` (shares can be sent to another account) | vault `CBMVK2JK…ZDWHN` | `stellar contract info interface` on testnet |
| 2026-10-23 | A vault withdraw needs a trustline to the underlying | withdraw to an account without a Blend USDC trustline traps: SAC "trustline entry is missing for account" | testnet | simulated `withdraw` to `GCYGHQ…VPLOP`, 2026-10-23 |
| 2026-10-23 | DeFindex vault methods | `deposit`, `withdraw(withdraw_shares, min_amounts_out, from)`, `balance`; shares = total_supply × amount ÷ total_amount; no withdraw fee documented. `get_asset_amounts_per_shares(shares)` exists on the deployed vault | vault wasm `f345228d…` | docs.defindex.io (direct contract calls, vault methods); live simulation |

### Facts checked in T-019

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-23 | One contract call per transaction | A transaction carries a single `InvokeHostFunctionOp`, not combinable with classic operations; classic transactions carry up to 100 operations | protocol | Raven: stellarDocs, developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/stellar-transaction; …/cli/cookbook/tx-op-add (observed 2026-10-22) |
| 2026-10-23 | SAC transfer to a muxed address | Since Whisk, Protocol 23 (CAP-67), SAC `transfer`'s `to` is a `MuxedAddress`; the event's data becomes `{amount, to_muxed_id}`; `transfer` is the only SAC function that takes one | Protocol 23+ | Raven: stellarDocs, developers.stellar.org/docs/tokens/stellar-asset-contract#sending-to-a-muxed-address; github.com/stellar/stellar-protocol cap-0067 |
| 2026-10-23 | Testnet protocol | 29 | testnet | RPC `getNetwork` |
| 2026-10-23 | soroban-sdk | 29.0.1 (2026-10-12) is the latest stable; 30.0.0-rc.1 is a pre-release | — | crates.io versions API |
| 2026-10-23 | stellar-sdk muxed `Address` | `new Address("M…").toScVal()` encodes an `ScAddressMuxedAccount` | stellar-sdk 17.3.0 | local check |
| 2026-10-23 | SAC needs a trustline | Transfer to a G-address without a trustline fails ("trustline entry is missing"); `trust(addr)` creates one, and the account must exist | soroban-sdk 29.0.1 | router tests |
| 2026-10-23 | Exit router deployment | `CC3UZVNR…A25ZY`, wasm sha256 `2a1ca8db495419e2041b9e585ee5539c62aedbbc7ac1b635932f78b88571e3b3` | testnet | deploy tx `ea9ec288b81f78fb3f1c5534954c1955a86f05c9cd8f80dcca70f897a860a282` |
| 2026-10-23 | Single-signature payments (measured) | Router route 1 op / 1 signature, completed 9 s after landing; classic route 2 ops / 1 signature, 7 s | testnet | `docs/evidence/t-019-one-signature-2026-10-23T00-01-38.403Z.json` |

### Facts checked in T-020

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-23 | SEP-10 verification | Exclude the server's signature. Existing account: one or more signatures from its signers meeting the threshold (medium for fund-moving authority). Missing account: exactly one signature, by its master key | SEP-10 | github.com/stellar/stellar-protocol `ecosystem/sep-0010.md` (fetched 2026-10-23; Raven: scout.searchResearch, sep, "Verification") |
| 2026-10-23 | SEP-10 JWT | `iss`, `sub` (G…, G…:memo, or M…), `iat`, `exp` (server's choice), optional `client_domain`; one JWT per challenge | SEP-10 | same |
| 2026-10-23 | SEP-10 challenge | Timebounds now → now + 900 s recommended; `WEB_AUTH_ENDPOINT` and `SIGNING_KEY` in stellar.toml; `Access-Control-Allow-Origin: *` on auth endpoints, errors included | SEP-10 | same |
| 2026-10-23 | SDK WebAuth grace | `readChallengeTx` accepts a challenge up to 300 s past its maxTime (`validateTimebounds(tx, 60 * 5)`) | stellar-sdk 17.3.0 | `lib/esm/webauth/challenge_transaction.js` |
| 2026-10-23 | Mini-app flow (measured) | Login → one-signature exit → payment completed 11 s after submit, over the public URL | testnet | `docs/evidence/t-020-app-2026-10-23T00-12-37.114Z.json` |

### Facts checked in T-021

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-23 | Stellar Wallets Kit v2 API | Static `StellarWalletsKit.init({ modules, network })`, `authModal()`, `getAddress()`, `signTransaction(xdr, { networkPassphrase, address })`, `disconnect()`; `defaultModules()` = wallets needing no extra configuration (WalletConnect excluded) | 2.7.1 | npm README; `esm/sdk/kit.d.ts`, `esm/sdk/modules/utils.d.ts` |
| 2026-10-23 | Wallets Kit releases | npm and JSR latest 2.7.1, 2026-10-07 | — | registry.npmjs.org, jsr.io meta |
| 2026-10-23 | SEP-10 client duty | The client verifies the challenge's server signature and home domain before signing (`WebAuth.readChallengeTx`) | SEP-10 | sep-0010.md |

### Facts checked in T-026

| Date | Fact | Value | Version | Source |
|------|------|-------|---------|--------|
| 2026-10-23 | Etherfuse sandbox API | `https://api.sand.etherfuse.com`; `Authorization: <key>` (no "Bearer"); server-side only (no CORS) | — | `an Etherfuse demo` (EXAMPLE_RUN.md), `the earlier prototype` `lib/anchors/etherfuse`; measured |
| 2026-10-23 | Etherfuse onboarding | `POST /ramp/onboarding-url` needs `userInfo {email, displayName}`; a public key already registered → 409 "see org: <customerId>"; KYC identity refuses `idNumbers` outside Mexico ("idNumbers may only be provided when address.country is MX"); `POST /ramp/agreements/*` → 410 `endpoint_removed`; `POST /ramp/bank-account` with the person's CPF as Pix key | sandbox | measured (T-026 probes, `pnpm money:smoke`) |
| 2026-10-23 | Etherfuse BRL quotes | BRL → USDC (`USDC:GBBD47…`) ≈ 0.1975 USD per BRL, fee 20 bps, `requiresSwap: true`; BRL → TESOURO (`TESOURO:GC3CW7ED…`) 0.8566 per BRL; quotes last about 2 minutes | sandbox | measured |
| 2026-10-23 | Etherfuse sandbox orders | `POST /ramp/order/fiat_received` marks the Pix paid; status `created` → `funded`, then no delivery within 4–5 minutes (USDC and TESOURO); the BRL order carries `depositBankName: STP`, no Pix code, and a `statusPage` URL | sandbox | measured (order `be075ac2-e834-42c9-9607-565bd2cf6dfb`) |
| 2026-10-23 | DeFindex API | `GET https://api.defindex.io/vault/{id}/apy?network=testnet`, `Authorization: Bearer <key>`; testnet APY moves a lot between reads (USDC vault 11.49 → 8 → 13.91; XLM vault 17.42 → 10.66 → 7.29 in one night) | — | measured |
| 2026-10-23 | DeFindex XLM vault (testnet) | `CD72HOSTSKA2KA4RMVOKVARM7SXBJ7IV54NCPJEEY4ZWOXOQPVFC5SIJ`, asset the native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`; `deposit`/`withdraw` as the USDC vault | testnet | `earlier-prototype/README.md`; vault read live (`total_supply`, `fetch_total_managed_funds`) and deposit/withdraw measured |
| 2026-10-23 | Photographs, first set (replaced the same day, DEC-041) | São Paulo street trade from Wikimedia Commons (Otávio Nogueira CC BY 2.0; Mateus S. Figueiredo CC BY-SA 4.0; Daderot CC0; Wilfredor CC BY-SA 4.0); removed from the app | — | commons.wikimedia.org |
| 2026-10-23 | Photographs, second set (replaced by the review, DEC-044) | Six CC0 Unsplash photographs via Wikimedia Commons (Yingchou Han, Katie Treadway, Brooke Cagle ×2, Anthony Ginsbrook, Nathan Dumlao); removed | — | commons.wikimedia.org |
| 2026-10-23 | Photograph (replaced by T-031, DEC-049) | "Miramar Hotel, Rio de Janeiro, Brazil (Unsplash)", Nad Hemnani, CC0 | — | https://commons.wikimedia.org/wiki/File:Miramar_Hotel,_Rio_de_Janeiro,_Brazil_(Unsplash).jpg (API `extmetadata`) |
| 2026-11-02 | Pexels license | Free use and modification, no attribution required; not allowed: identifiable people in a bad light, implied endorsement by people or brands shown, selling unaltered copies, redistributing on stock sites, use in a trademark. No version or date on the page | — | https://www.pexels.com/license/ (fetched 2026-11-02) |
| 2026-11-02 | Welcome footage (rejected by the human the same day, DEC-049; removed) | "Relaxing Sunset at Ipanema Beach, Rio de Janeiro", Marcelo Aut, uploaded 2026-05-14, Pexels license; source 2160×3840 H.264 30 fps, 7.17 s; app copy re-encoded to 720×1280 H.264 CRF 28, 6.2 s crossfade loop, no audio (1.0 MB) + first-frame still (124 KB); OG band `og/ipanema-band.jpg` from the same source | — | https://www.pexels.com/video/relaxing-sunset-at-ipanema-beach-rio-de-janeiro-37595349/ |
| 2026-11-02 | Welcome photograph, current | "A person using mobile to make a contactless payment at a café counter" (page title "Person Holding Black Smartphone on Brown Wooden Table"), Tima Miroshnichenko, uploaded 2021-01-19, 3901×5852, Pexels license; app copy cropped (top 1287 px off) to 1200×1404 JPEG q80; OG panel `og/counter-payment.jpg` 600×630 from the same source | — | https://www.pexels.com/photo/person-holding-black-smartphone-on-brown-wooden-table-6545379/ |
| 2026-11-02 | Pexels downloads | `https://www.pexels.com/download/video/<id>/` redirects (no key) to `videos.pexels.com/video-files/<id>/<id>-<quality>_<w>_<h>_<fps>fps.mp4` | — | measured (curl -IL) |
| 2026-11-02 | Headless Chrome width on macOS | `--headless=new --window-size=390,…` still lays out ~500 px wide (screenshots clip); CDP `Emulation.setDeviceMetricsOverride` gives a true 390 px mobile viewport | Chrome (installed) | measured |
| 2026-10-23 | impeccable detector | `npx impeccable@4.7.0 detect --json [--viewport 390x844] <files or URLs>` (pbakaus/impeccable, the skill's own CLI): before the review 24 findings on 12 rendered pages (cream-palette ×12, low-contrast ×6, tiny-text ×4, straggler ×2), 1 in source (overused font: Geist Mono); after, 0 and 0 | 4.7.0 | measured |
| 2026-10-23 | Unsplash search | `unsplash.com/napi/search/photos` answers "Authorization required" without an API key; Openverse `/v1/images` works keyless | — | measured |
| 2026-10-23 | Soroswap testnet XLM pools | `router_get_amounts_in` for 10 out: Circle USDC ≈ 93.648 XLM, Blend USDC ≈ 44.228 XLM; the order book (Horizon strict-send) values XLM far higher (60 XLM ≈ US$ 52.62) | testnet | measured (simulation from the treasury account) |
| 2026-10-23 | Vercel rewrites proxy to an external origin | a `vercel.json` `rewrites` entry with an absolute `destination` (`https://<backend-ip>.sslip.io/...`) serves the backend under the Vercel domain: `/.well-known/stellar.toml` 200 and `/app/invest` 401 through `vants.example.com` | Vercel CLI, 2026-10-23 | observed (T-027); https://vercel.com/docs/rewrites |
| 2026-10-23 | Caddy gets a public certificate for an sslip.io name | `{$VANTS_HOST} { reverse_proxy api:3100 }` with `VANTS_HOST=<backend-ip>.sslip.io` serves HTTPS on first start (ACME, no DNS of our own) | `caddy:2.11.7-alpine` | observed (T-027); https://sslip.io |
| 2026-10-23 | GCE e2-small for the backend | 2 vCPU (shared), 2 GB; one VM runs Postgres, API, worker and Caddy under Docker Compose with 2 GB swap; static external IP `vants-ip` | us-central1-a | observed (T-027), `gcloud compute instances create` |
| 2026-10-23 | Open Graph image tags | `og:image` must be an absolute URL; `og:image:secure_url`, `:type`, `:width`, `:height`, `:alt` describe it; 1200×630 (1.91:1) is the large-card size | protocol | https://ogp.me/ ; https://developers.facebook.com/docs/sharing/webmasters/ |
| 2026-10-23 | X large card | `twitter:card=summary_large_image` with `twitter:title`, `twitter:description`, `twitter:image` (+ `:alt`); X falls back to `og:*` when a `twitter:*` tag is missing | docs | https://developer.x.com/en/docs/x-for-websites/cards/overview/summary-card-with-large-image |
| 2026-10-23 | iOS home-screen icon | Safari uses `<link rel="apple-touch-icon">` as a 180×180 PNG; an SVG there is ignored | docs | https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html |
| 2026-10-23 | Vite HTML transform | a plugin's `transformIndexHtml(html)` may return the rewritten HTML string; used for `%PUBLIC_URL%` | Vite 8 | https://vite.dev/guide/api-plugin#transformindexhtml ; observed in `dist/index.html` (T-028) |
| 2026-10-23 | Etherfuse sandbox doesn't deliver TESOURO on testnet | order `d9309ea8…` (R$ 300 → TESOURO, `blockchain: stellar`) `status: completed` with no `amountInTokens` or `confirmedTxSignature`; wallet `GDJKP4…` holds 0 TESOURO, its only TESOURO operation the trustline; other completed orders carry base58 88-character (Solana-style) signatures | sandbox | `GET /ramp/order/:id` on api.sand.etherfuse.com; Horizon testnet (T-029) |
| 2026-10-23 | TESOURO market on the testnet order book | issuer `GC3CW7…` pays TESOURO and CETES to `GBPAFJ3COSPSNDXZIPD36553DTM72W3R5WF2JU2L5SBGOLNR42ZORDTV` every ~2 h, which re-places offers: sells TESOURO for Circle USDC at 0.2308243, buys it with 24,667 USDC at 4.3344662 TESOURO per USDC; no TESOURO/XLM book (paths go through USDC) | testnet | Horizon `/accounts/GBPAFJ3C…/offers`, `/order_book` (T-029) |

### Resolved versions (T-001, DEC-013/DEC-014)

| Package | Version | Released | Where |
|---------|---------|----------|-------|
| Node | 24.18.1 | — | `.nvmrc`, `engines` |
| pnpm | 11.21.0 | — | `packageManager` |
| typescript | 7.0.2 | 2026-07-08 | root |
| @biomejs/biome | 2.6.2 | 2026-10-21 | root |
| vitest | 5.0.5 | 2026-10-15 | root |
| @types/node | 24.19.2 (matches the Node 24 runtime; 26.x is for Node 26) | — | root |
| secretlint + rule-preset-recommend + rule-pattern | 13.0.7 | 2026-10-03 | root |
| testcontainers, @testcontainers/postgresql | 12.2.1 | 2026-10-13 | root |
| @stellar/stellar-sdk | 17.3.0 | 2026-10-21 | api, adapter-stellar, adapter-defindex, adapter-cctp |
| fastify | 5.12.7 | 2026-10-13 | api |
| zod | 4.6.7 | 2026-10-12 | api |
| pg / @types/pg | 8.23.1 / 8.23.1 | 2026-09-30 / 2026-08-17 | db |
| pg-boss | 12.38.0 | 2026-10-13 | db |
| node-pg-migrate | 9.0.0 | 2026-07-17 | db (T-002) |
| fast-check | 4.10.2 | 2026-09-19 | root dev (T-003) |
| standardwebhooks | 1.1.1 | 2026-08-28 | worker |
| Pier's SDK | 0.1.0 | 2026-10-20 | adapter-pier |
| standardwebhooks (dev, for signing in tests) | 1.1.1 | 2026-08-28 | adapter-pier, api |
| viem | 2.57.8 (2.57.10 was inside pnpm's release-age window) | 2026-10-21 | adapter-cctp |
| react / react-dom | 19.3.1 | 2026-10-14 | web |
| @types/react / @types/react-dom | 19.3.0 | 2026-09-09 | web |
| vite | 8.3.5 | 2026-10-21 | web |
| @creit.tech/stellar-wallets-kit | 2.7.1 | 2026-10-07 | web |
| qr-scanner | 1.4.2 (MIT) | 2022-11-23 | web |
| @stellar/stellar-sdk (web) | 17.3.0 | 2026-10-21 | web (SEP-10 challenge check) |
| @vitejs/plugin-react | 6.1.2 | 2026-10-05 | web |
| postgres (Docker) | 18.6 | — | `compose.yaml` |
| soroban-sdk (Rust) | 29.0.1 | 2026-10-12 | `contracts/exit-router` (testnet protocol 29) |

## Copied code

| Date | Our path | Origin | License | Task |
|------|----------|--------|---------|------|
| 2026-10-22 | `packages/db/test/postgres.ts`, `packages/db/src/migrate.ts` | Pattern adapted from Pier `test/postgres.ts` and `packages/log/src/index.ts` `migrate()` (Pier repository, commit 122a6c1) | Apache-2.0 (Pier); same author | T-002 |
| 2026-10-22 | `packages/pix/src/emv.ts`, `guard.ts`, `emv.test.ts`, `guard.test.ts` | `the earlier spike` `src/pix/emv.ts`, `src/hodle/api.ts` (`checkBrCodeForPayout`), `test/emv.test.ts`, `test/hodle.test.ts` (uncommitted spike, same author) | same author | T-003 |
| 2026-10-23 | `packages/adapters/cctp/src/{addresses,units,iris,stellar,base}.ts`, `test/units.test.ts` | `the earlier spike` `src/cctp/{addresses,decimals,iris,stellarToBase}.ts`, `src/stellar/client.ts` (Soroban invoke and SAC helpers), `test/cctp.test.ts`, `test/decimals.test.ts` (uncommitted spike, same author); reshaped to build and sign envelopes without submitting, the spike's pending-file state dropped | same author | T-016 |
| 2026-10-23 | `packages/adapters/defindex/src/vault.ts`, `test/vault.test.ts` | `the earlier spike` `src/defindex/vault.ts` (reads and share maths) and `test/float-defindex.test.ts` ("DeFindex share maths") (uncommitted spike, same author) | same author | T-018 |
| 2026-10-23 | `apps/web/src/design/{tokens.css,ds.css,ds.tsx}`, `apps/web/public/fonts/*.woff2`, `apps/web/public/icon.svg` | The human's Vants design system (claude.ai artifact `QaWZRrMk8RsmxTWFRSpJrD`, version 1792715528-5714): `project/tokens.json` (generated into CSS), `components/bundle.css` (Logo, Button, Badge, live dot, fields), `components/bundle.js` (Logo paths, Icon set, component markup, ported to TSX), the three fonts, and the `vants-app-icon.svg` asset | the human's own design system; fonts: Bricolage Grotesque, Manrope and Geist Mono are SIL Open Font License 1.1 `[VERIFY: licence files not shipped in the artifact]` | T-023 |
| _(planned ports from `the earlier spike`: `src/pix/emv.ts`, `src/hodle/*`, `src/defindex/*`, `src/cctp/*`, `src/float/pricing.ts`; logged here when copied)_ | | | | |
| 2026-11-03 | `apps/web/public/fonts/Archivo-Variable-latin.woff2`, `Archivo-Variable-latin-ext.woff2`, `Archivo-OFL.txt` | Google Fonts, `fonts.gstatic.com/s/archivo/v25/` (the two subsets) and `github.com/google/fonts` `ofl/archivo/OFL.txt` | SIL Open Font License 1.1 (licence text shipped beside the fonts) | T-044 |
