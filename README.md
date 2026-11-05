# Vants PoC

A proof of concept on Stellar testnet: paying Brazilian Pix codes from Stellar assets. The Pix side is simulated by the Hodle
sandbox, so no real money moves. Every configuration refuses mainnet and production endpoints (`INV-07` in the spec).

It has two parts, built on one backend:

- **Vants Pay (the rail).** A wallet or app asks for a quote for a Pix BR Code or a Pix key, then sends testnet USDC to a muxed
  deposit address. Vants detects the deposit through Pier, pays the Pix from a float held at Hodle, and notifies the integrator by
  webhook. Any deposit that cannot fund a payment (short, late, unknown or the wrong asset) is refunded.
- **The mini app.** A person connects a Stellar wallet, sees their balances and DeFindex vault positions, picks what to pay from,
  signs one transaction, and gets a receipt. It also adds money by Pix, invests in vaults and Tesouro, and lists all activity.
  The mini app is a client of the rail.

Status: the task board in [`docs/SPEC.md`](docs/SPEC.md) §9 says where each piece of work stands. The evidence run that would
back public claims (T-090) has not been done yet. See §2 of the same file for what this project may and may not claim.

## Repository

| Path | What it is |
|------|------------|
| `apps/api` | Fastify: the Vants Pay REST API (`/v0`), the mini app's backend (`/app`, SEP-10 login at `/auth`) and the webhook ingress (`/ingress`) |
| `apps/worker` | pg-boss consumers: the payment, exit, refund and float-refill sagas, the integrator notifier and the reconcilers |
| `apps/web` | The mini app: React 19 and Vite, Stellar Wallets Kit for connecting and signing |
| `packages/domain` | Pure state machines, pricing and ledger posting rules (no I/O) |
| `packages/db` | Postgres migrations, repositories, the outbox and inbox, the ledger |
| `packages/pix` | BR Code parsing and validation |
| `packages/config` | Environment validation; rejects anything that is not testnet or sandbox |
| `packages/adapters/*` | `hodle`, `pier`, `stellar`, `defindex`, `etherfuse`, `cctp` |
| `contracts/exit-router` | Soroban contract that turns a person's picks into one signed transaction (soroban-sdk 29.0.1) |
| `deploy/` | Scripts for the hosted testnet: the backend on a Google Cloud VM, the web app on Vercel |
| `docs/` | `SPEC.md` (the source of truth), `SOURCES.md` (every checked external fact), `evidence/` (recorded test runs) |

The architecture, the payment flow and every design decision are in [`docs/SPEC.md`](docs/SPEC.md): §3 for the architecture and
§10 for the decision log. [`PRODUCT.md`](PRODUCT.md) covers the product and the visual direction.

## Requirements

- Node 24.18.1 (`.nvmrc`) and pnpm 11.21.0 (`corepack enable`)
- Docker, for the local Postgres and the integration tests
- Rust and cargo, only for the contract tests
- Chrome, only for the contrast check

## Getting started

```sh
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env     # fill in the testnet and sandbox keys; never commit .env
pnpm db:up               # Postgres 18.6 on localhost:5433
pnpm api                 # :3100
pnpm worker
```

Every key in `.env.example` is for testnet or a sandbox. The API needs a public URL for Pier and Hodle webhooks
(`PUBLIC_BASE_URL`; a tunnel such as ngrok works for local runs). `pnpm pier:setup` creates the Pier subscription for the treasury,
and `pnpm integrator:create <name>` issues an API key.

The mini app:

```sh
cd apps/web
npx vite                 # http://localhost:5173, forwards /app, /auth and /.well-known to the API on :3100
```

`http://localhost:5173/preview.html` runs the app against mock data, with no backend or wallet. Query parameters pick a state:
`?signedout`, `?empty`, `?profile`, `?funded` and `?completes` (flows reach their success screen).

## Checks

| Check | Command |
|-------|---------|
| Format | `pnpm format:check` |
| Lint | `pnpm lint` |
| Unit tests | `pnpm test` |
| Build | `pnpm build` |
| Secrets | `pnpm check:config` |
| Integration (needs Docker) | `pnpm test:integration` |
| Contract | `pnpm test:contracts` |
| UI contrast (needs Chrome) | `pnpm check:contrast` |
| End to end on testnet | `pnpm e2e`, with `pnpm api` and `pnpm worker` running |

The full list, with when each one runs and its recorded results, is in `docs/SPEC.md` §8.

## Deploying the testnet demo

```sh
PROJECT_ID=<gcp project> PUBLIC_BASE_URL=<web domain> deploy/push.sh   # backend: API, worker, Postgres, Caddy on the VM
API_HOST=<backend host> deploy/web.sh --prod                           # web app on Vercel, forwarding API routes to the VM
```

WalletConnect (phone wallets connecting to the app on another screen) is on when the web build has a Reown project id:
`VITE_WALLETCONNECT_PROJECT_ID=<id> API_HOST=<backend host> deploy/web.sh --prod` (or the same variable in a git-ignored
`apps/web/.env.local` for `vite`). The id is a public client id, not a secret; the web domain must be on its allowlist in
the Reown dashboard. Without it, WalletConnect is simply not offered.

`deploy/gcp-create.sh` creates the VM once. These scripts create billable resources and copy keys to the VM, so run them only
when you mean to.

## Working in this repository

Agents and people follow [`CLAUDE.md`](CLAUDE.md): work comes from the task board in `docs/SPEC.md` §9, one task per branch
(`t-<id>-<slug>`), tests first, all checks green, and a decision record for each implementation choice.

## License

Proprietary. All rights reserved. See [`LICENSE`](LICENSE).
