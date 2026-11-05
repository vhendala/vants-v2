#!/bin/bash
# Builds the backend image for linux/amd64, copies it to the VM (no registry), and (re)starts Postgres, the API, the worker
# and Caddy (T-027, DEC-045). The first run writes /opt/vants/.env on the VM from the local .env (the testnet/sandbox keys),
# with PUBLIC_BASE_URL set to the public (Vercel) domain; secrets are copied, never printed, and the file is mode 600.
#   PROJECT_ID=vants-testnet-xxxx PUBLIC_BASE_URL=https://vants.example.com deploy/push.sh
# SERVICES=postgres starts only the database (the first deploy: copy the data with deploy/copy-db.sh, then run again).
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}" "${PUBLIC_BASE_URL:?set PUBLIC_BASE_URL (the Vercel domain)}"
ZONE="${ZONE:-us-central1-a}"
VM="${VM:-vants-1}"
VERSION="$(git rev-parse --short HEAD)"
cd "$(dirname "$0")/.."
ssh_vm() { gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT_ID" --command="$1"; }

IP="$(gcloud compute instances describe "$VM" --zone="$ZONE" --project="$PROJECT_ID" \
  --format="value(networkInterfaces[0].accessConfigs[0].natIP)")"
HOST="${IP//./-}.sslip.io"

# A new VM installs Docker from its startup script: wait for it.
ssh_vm "until command -v docker >/dev/null && sudo docker info >/dev/null 2>&1; do sleep 5; done"
docker buildx build --platform linux/amd64 -t "vants:$VERSION" --load .
docker save "vants:$VERSION" | gzip -1 | ssh_vm "gunzip | sudo docker load"
gcloud compute scp deploy/compose.yaml deploy/Caddyfile "$VM:/tmp/" --zone="$ZONE" --project="$PROJECT_ID"

if ! ssh_vm "sudo test -f /opt/vants/.env"; then
  # The backend's environment: the keys the API and worker read, from the local .env (never the local DATABASE_URL or
  # the smoke tests' payer key), plus what only the VM has.
  ENVFILE="$(mktemp)"
  chmod 600 "$ENVFILE"
  KEYS="STELLAR_RPC_URL STELLAR_HORIZON_URL TREASURY_SECRET TREASURY_ACCOUNT HODLE_SANDBOX_BASE_URL HODLE_SANDBOX_API_KEY
    HODLE_WEBHOOK_SECRETS PIER_API_URL PIER_API_KEY PIER_WEBHOOK_SECRET PIER_SUBSCRIPTION_ID BASE_SEPOLIA_RPC_URL
    EVM_TEST_PRIVATE_KEY IRIS_API_URL INTEGRATOR_KEY_PEPPER EXIT_ROUTER_CONTRACT_ID WEB_AUTH_SIGNING_SECRET JWT_SECRET
    DEFINDEX_API_KEY DEFINDEX_BASE_URL ETHERFUSE_API_KEY ETHERFUSE_BASE_URL"
  for k in $KEYS; do grep -E "^$k=" .env >> "$ENVFILE" || true; done
  {
    echo "PUBLIC_BASE_URL=$PUBLIC_BASE_URL"
    echo "VANTS_HOST=$HOST"
    echo "VANTS_VERSION=$VERSION"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  } >> "$ENVFILE"
  gcloud compute scp "$ENVFILE" "$VM:/tmp/vants.env" --zone="$ZONE" --project="$PROJECT_ID"
  rm -f "$ENVFILE"
  ssh_vm "sudo mkdir -p /opt/vants && sudo mv /tmp/vants.env /opt/vants/.env && sudo chmod 600 /opt/vants/.env"
fi

ssh_vm "set -euo pipefail
sudo mv /tmp/compose.yaml /tmp/Caddyfile /opt/vants/
cd /opt/vants
PREVIOUS=\$(sudo sed -n 's/^VANTS_VERSION=//p' .env)
sudo sed -i 's/^VANTS_VERSION=.*/VANTS_VERSION=$VERSION/' .env
sudo docker compose up -d --remove-orphans ${SERVICES:-}
for tag in \$(sudo docker images vants --format '{{.Tag}}'); do
  [ \"\$tag\" = \"$VERSION\" ] || [ \"\$tag\" = \"\$PREVIOUS\" ] || sudo docker rmi \"vants:\$tag\" >/dev/null || true
done
sudo docker image prune -f >/dev/null"
echo "deployed vants:$VERSION to https://$HOST (public: $PUBLIC_BASE_URL)"
