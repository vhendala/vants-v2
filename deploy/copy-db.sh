#!/bin/bash
# One-time move of the local PoC database to the VM (T-027): the ledger, payments, exits, sessions and ramp customers keep
# their history. Run with the local api and worker STOPPED and before the VM's api/worker first start, so exactly one
# worker ever owns the deposits and payouts.
#   PROJECT_ID=vants-testnet-xxxx deploy/copy-db.sh
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"
ZONE="${ZONE:-us-central1-a}"
VM="${VM:-vants-1}"
cd "$(dirname "$0")/.."
ssh_vm() { gcloud compute ssh "$VM" --zone="$ZONE" --project="$PROJECT_ID" --command="$1"; }
LOCAL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-)"
docker compose exec -T postgres pg_dump --no-owner --no-privileges --format=custom "$(echo "$LOCAL" | perl -pe 's/(127\.0\.0\.1|localhost):\d+/localhost:5432/')" \
  | ssh_vm "cd /opt/vants && sudo docker compose up -d postgres >/dev/null && sleep 5 &&
      sudo docker compose exec -T postgres pg_restore --no-owner --no-privileges --clean --if-exists -U vants -d vants"
echo "copied the local database to $VM"
