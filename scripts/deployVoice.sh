#!/usr/bin/env bash
# Deploys the voice server to Fly.io: secrets from .env, Moss's model baked in, one machine.
#   scripts/deployVoice.sh
# One-time setup: brew install flyctl && fly auth login && fly apps create <name> (and set it in fly.toml).
set -euo pipefail
cd "$(dirname "$0")/.."
command -v fly >/dev/null || { echo "Install the Fly CLI first: brew install flyctl" >&2; exit 1; }
APP=$(sed -n 's/^app = "\(.*\)"$/\1/p' fly.toml)

# Every key in .env except the local-only ones; on Fly the public URL is the app's own.
{ grep -vE '^[[:space:]]*(#|$)' .env | grep -vE '^(NGROK_[A-Z_]*|PUBLIC_BASE_URL|PORT|TWILIO_POINT_WEBHOOK)='
  echo "PUBLIC_BASE_URL=https://$APP.fly.dev"
} | fly secrets import --stage -a "$APP"

# Bake in the Moss model this machine already downloaded, so a new deploy answers calls at once.
trap 'rm -rf .model-cache' EXIT
rm -rf .model-cache
src=$(ls -d node_modules/.pnpm/@huggingface+transformers@*/node_modules/@huggingface/transformers/.cache/moss-minilm 2>/dev/null | head -1 || true)
if [ -n "$src" ]; then
  mkdir -p .model-cache && cp -r "$src" .model-cache/
else
  echo "warning: Moss's model isn't cached locally (run the voice server once); the first boot will download it" >&2
fi

# Exactly one machine: a call's webhook and its media stream must reach the same process.
fly deploy --ha=false -a "$APP"
