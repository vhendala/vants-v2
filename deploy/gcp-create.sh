#!/bin/bash
# One-time Google Cloud setup for the hosted testnet backend (T-027, DEC-045): a project, billing, and one e2-small VM
# (Pier holds the account's free e2-micro). It creates billable resources: run by a human or on their instruction.
#   PROJECT_ID=vants-testnet-xxxx BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX deploy/gcp-create.sh
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}" "${BILLING_ACCOUNT:?set BILLING_ACCOUNT}"
ZONE="${ZONE:-us-central1-a}"
VM="${VM:-vants-1}"
cd "$(dirname "$0")"

gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1 || gcloud projects create "$PROJECT_ID" --name="Vants testnet"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
gcloud services enable compute.googleapis.com --project="$PROJECT_ID"

gcloud compute firewall-rules describe vants-web --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud compute firewall-rules create vants-web --project="$PROJECT_ID" \
    --allow=tcp:80,tcp:443 --target-tags=vants-web --description="Vants API (Caddy HTTPS)"

gcloud compute instances describe "$VM" --zone="$ZONE" --project="$PROJECT_ID" >/dev/null 2>&1 ||
  gcloud compute instances create "$VM" --project="$PROJECT_ID" --zone="$ZONE" \
    --machine-type=e2-small \
    --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB --boot-disk-type=pd-standard \
    --tags=vants-web \
    --metadata-from-file=startup-script=vm-startup.sh

gcloud compute instances describe "$VM" --zone="$ZONE" --project="$PROJECT_ID" \
  --format="value(networkInterfaces[0].accessConfigs[0].natIP)"
