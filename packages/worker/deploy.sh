#!/bin/sh
set -e

require_var() {
  if [ -z "$(eval echo \$$1)" ]; then
    echo "Error: $1 environment variable is not set" >&2
    exit 1
  fi
}

require_var D1_DATABASE_ID
require_var CF_ACCESS_AUD
require_var CF_TEAM_DOMAIN
require_var R2_ACCOUNT_ID
require_var R2_ACCESS_KEY_ID
require_var R2_SECRET_ACCESS_KEY
require_var R2_BUCKET_NAME

TMPFILE=$(mktemp /tmp/wrangler-XXXX.toml)
sed "s/__D1_DATABASE_ID__/${D1_DATABASE_ID}/g" "$(dirname "$0")/wrangler.toml" > "$TMPFILE"

npx wrangler deploy --minify --config "$TMPFILE"

echo "Setting runtime secrets..."
echo "$CF_ACCESS_AUD"        | npx wrangler secret put CF_ACCESS_AUD        --config "$TMPFILE"
echo "$CF_TEAM_DOMAIN"       | npx wrangler secret put CF_TEAM_DOMAIN        --config "$TMPFILE"
echo "$R2_ACCOUNT_ID"        | npx wrangler secret put R2_ACCOUNT_ID         --config "$TMPFILE"
echo "$R2_ACCESS_KEY_ID"     | npx wrangler secret put R2_ACCESS_KEY_ID      --config "$TMPFILE"
echo "$R2_SECRET_ACCESS_KEY" | npx wrangler secret put R2_SECRET_ACCESS_KEY  --config "$TMPFILE"
echo "$R2_BUCKET_NAME"       | npx wrangler secret put R2_BUCKET_NAME        --config "$TMPFILE"
echo "Secrets set successfully."
