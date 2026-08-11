#!/usr/bin/env bash
# Deploys the public site only (not worker/, not docs) to the Worker that
# serves gudanah.com.
#
# gudanah.com is a Workers Custom Domain (not Cloudflare Pages) bound to a
# Worker named "gudanahats" — that binding + its TLS cert already exist in
# the Cloudflare account, so this just pushes a new asset-only version to
# that same Worker name. `wrangler deploy` doesn't honor .gitignore-style
# ignore files for --assets either, so this copies exactly the public files
# into a clean temp directory and deploys that. Requires `wrangler login`
# once first.
set -euo pipefail

SITE_FILES=(index.html styles.css app.js favicon.svg robots.txt sitemap.xml)
WORKER_NAME="gudanahats"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(mktemp -d)"
trap 'rm -rf "$DEPLOY_DIR"' EXIT

cp "${SITE_FILES[@]/#/$SCRIPT_DIR/}" "$DEPLOY_DIR/"

npx wrangler deploy \
  --name="$WORKER_NAME" \
  --assets="$DEPLOY_DIR" \
  --compatibility-date="$(date -u +%Y-%m-%d)"
