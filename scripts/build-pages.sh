#!/usr/bin/env bash
# Assemble GitHub Pages output:
#   dist/            hub (this repo root)
#   dist/champions/  Vite build, base /acg-tools/champions/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
VITE_BASE="${VITE_BASE:-/acg-tools/champions/}"

rm -rf "$DIST"
mkdir -p "$DIST/data" "$DIST/champions"

cp "$ROOT/index.html" "$ROOT/app.js" "$ROOT/app-extra.js" "$ROOT/modules.js" \
  "$ROOT/style.css" "$ROOT/overrides.css" "$ROOT/modules.css" "$ROOT/season.json" \
  "$DIST/"
cp "$ROOT/data/"*.json "$DIST/data/"
if [[ -f "$ROOT/.nojekyll" ]]; then
  cp "$ROOT/.nojekyll" "$DIST/.nojekyll"
else
  touch "$DIST/.nojekyll"
fi

cd "$ROOT/apps/champions"
if [[ "${NPM_CI:-}" == "1" ]]; then
  npm ci
else
  npm install
fi
VITE_BASE="$VITE_BASE" npx vite build
cp -a dist/. "$DIST/champions/"

echo "pages output: $DIST"
echo "champions base: $VITE_BASE"
