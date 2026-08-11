#!/usr/bin/env bash
# Deploys gudanah.com (public/ + site-worker.js, per wrangler.toml at repo
# root). Requires `wrangler login` once first.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
npx wrangler deploy
