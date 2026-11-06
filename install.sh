#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${MESHPAGEPUB_PORT:-8000}"
HOST="${MESHPAGEPUB_HOST:-0.0.0.0}"

fail() { printf 'meshpagepub: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Node.js is required. Install Node.js 18+ and rerun this script."
command -v npm >/dev/null 2>&1 || fail "npm is required but was not found."
node -e 'if (Number(process.versions.node.split(".")[0]) < 18) process.exit(1)' || fail "Node.js 18 or newer is required."

cd "$ROOT"
if [[ ! -f package-lock.json ]]; then
  fail "package-lock.json is missing; run npm install in $ROOT to generate it."
fi
printf 'Installing locked dependencies…\n'
npm ci --no-audit --no-fund

# Install a lightweight Chromium browser when one is not already available.
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then
  printf 'Chromium is needed for the USB/Bluetooth browser APIs. Install Chromium with your OS package manager.
'
fi

printf '\nMeshPage Publisher is ready.\n'
printf 'Open: http://%s:%s/\n' "$HOST" "$PORT"
printf 'USB/Bluetooth browser access requires localhost or HTTPS.\n'
printf 'Press Ctrl+C to stop the local server.\n\n'
exec node server.js --host "$HOST" --port "$PORT"
