#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${MESHPAGEPUB_PORT:-8000}"
HOST="${MESHPAGEPUB_HOST:-0.0.0.0}"

fail() { printf 'meshpagepub: %s\n' "$*" >&2; exit 1; }
info() { printf 'meshpagepub: %s\n' "$*"; }

node_is_ready() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && \
    node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1
}

install_node_linux() {
  if command -v apt-get >/dev/null 2>&1; then
    info "Installing Node.js and npm with apt…"
    if [[ $EUID -eq 0 ]]; then apt-get update && apt-get install -y nodejs npm
    elif command -v sudo >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y nodejs npm
    else fail "Node.js 18+ is required. Install it with: apt-get update && apt-get install -y nodejs npm (requires administrator access)."; fi
  elif command -v dnf >/dev/null 2>&1; then
    info "Installing Node.js and npm with dnf…"
    if [[ $EUID -eq 0 ]]; then dnf install -y nodejs npm
    elif command -v sudo >/dev/null 2>&1; then sudo dnf install -y nodejs npm
    else fail "Node.js 18+ is required. Install it with: dnf install nodejs npm (requires administrator access)."; fi
  elif command -v pacman >/dev/null 2>&1; then
    info "Installing Node.js and npm with pacman…"
    if [[ $EUID -eq 0 ]]; then pacman -Sy --needed --noconfirm nodejs npm
    elif command -v sudo >/dev/null 2>&1; then sudo pacman -Sy --needed --noconfirm nodejs npm
    else fail "Node.js 18+ is required. Install it with: pacman -Sy nodejs npm (requires administrator access)."; fi
  else
    fail "Could not identify a supported Linux package manager. Install Node.js 18+ and npm, then rerun this script."
  fi
}

install_node_macos() {
  command -v brew >/dev/null 2>&1 || fail "Node.js 18+ is required. Install Homebrew from https://brew.sh, then run: brew install node"
  info "Installing Node.js with Homebrew…"
  brew install node
}

ensure_prerequisites() {
  if node_is_ready; then return; fi
  if command -v node >/dev/null 2>&1; then info "Found Node.js $(node --version), but version 18+ and npm are required."
  else info "Node.js is not installed."; fi
  case "$(uname -s)" in
    Linux) install_node_linux ;;
    Darwin) install_node_macos ;;
    MINGW*|MSYS*|CYGWIN*) fail "Install Node.js 18+ for Windows from nodejs.org (or run: winget install OpenJS.NodeJS.LTS), reopen the terminal, and rerun install.sh." ;;
    *) fail "Unsupported operating system. Install Node.js 18+ and npm, then rerun this script." ;;
  esac
  node_is_ready || fail "Prerequisite installation finished, but Node.js 18+ and npm are still unavailable in PATH. Open a new terminal or install them manually, then rerun."
}

ensure_prerequisites
cd "$ROOT"
[[ -f package-lock.json ]] || fail "package-lock.json is missing. Run npm install in $ROOT to generate it."
info "Installing locked npm dependencies…"
npm ci --no-audit --no-fund
info "Building the browser application…"
npm run build

if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1 && ! command -v microsoft-edge >/dev/null 2>&1 && ! command -v open >/dev/null 2>&1; then
  info "No desktop browser detected on this host. Use a Chromium-based browser on the client device."
fi

printf '\nMeshPage Publisher is ready.\n'
printf 'Open: http://%s:%s/\n' "$HOST" "$PORT"
printf 'The server listens on the selected interface; allow TCP port %s in the host firewall if needed.\n' "$PORT"
printf 'Web Serial/Bluetooth require a Chromium-based browser in a secure context (localhost or HTTPS).\n'
printf 'Press Ctrl+C to stop the server.\n\n'
exec node server.js --host "$HOST" --port "$PORT"
