#!/bin/sh
set -e

if [ -z "$D1_DATABASE_ID" ]; then
  echo "Error: D1_DATABASE_ID environment variable is not set" >&2
  exit 1
fi

TMPFILE=$(mktemp /tmp/wrangler-XXXX.toml)
sed "s/__D1_DATABASE_ID__/${D1_DATABASE_ID}/g" "$(dirname "$0")/wrangler.toml" > "$TMPFILE"

npx wrangler deploy --minify --config "$TMPFILE"
