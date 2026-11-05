#!/bin/bash
# Deploys the mini app to Vercel (T-027, DEC-045): a static build of apps/web plus rewrites that forward the API's routes to
# the backend VM, so the app, SEP-10 login, the /app API and the webhooks share ONE public domain (the Vercel one), which is
# also the backend's PUBLIC_BASE_URL (its SEP-10 home domain).
#   API_HOST=<backend-ip>.sslip.io deploy/web.sh [--prod]
# With VITE_WALLETCONNECT_PROJECT_ID=<Reown project id> in the environment, the build offers WalletConnect (T-046).
set -euo pipefail
: "${API_HOST:?set API_HOST to the backend HTTPS host}"
cd "$(dirname "$0")/.."
pnpm --filter @vants/web build
# The upload is staged outside the repository: inside it, the CLI attaches the git commit, and Vercel blocks a production
# deploy whose commit author it cannot match to the account (DEC-055).
ROOT="$PWD"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT
cp -R apps/web/dist/. "$OUT/"
rm -f "$OUT/preview.html"
API="https://$API_HOST"
cat > "$OUT/vercel.json" <<JSON
{
  "\$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    { "source": "/app/:path*", "destination": "$API/app/:path*" },
    { "source": "/auth", "destination": "$API/auth" },
    { "source": "/.well-known/:path*", "destination": "$API/.well-known/:path*" },
    { "source": "/ingress/:path*", "destination": "$API/ingress/:path*" },
    { "source": "/v0/:path*", "destination": "$API/v0/:path*" }
  ],
  "headers": [
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
  ]
}
JSON
# The project link (.vercel/project.json) is made once by `vercel link --project vants-app` in $OUT and kept in .vercel-link.
mkdir -p .vercel-link && [ -f .vercel-link/project.json ] || (cd "$OUT" && vercel link --yes --project vants-app >/dev/null && cp .vercel/project.json "$ROOT/.vercel-link/")
mkdir -p "$OUT/.vercel" && cp .vercel-link/project.json "$OUT/.vercel/"
(cd "$OUT" && vercel deploy --yes "$@")
