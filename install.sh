#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PORT="${MESHPAGEPUB_PORT:-8000}"
HOST="${MESHPAGEPUB_HOST:-0.0.0.0}"
MODE="${MESHPAGEPUB_MODE:-service}"
for arg in "$@"; do
  case "$arg" in
    --foreground) MODE=foreground ;;
    --service) MODE=service ;;
    --help|-h)
      printf 'Usage: %s [--service|--foreground]\n' "${0##*/}"
      printf 'Default: install and start a per-user systemd service (Linux) or LaunchAgent (macOS).\n'
      printf 'MESHPAGEPUB_HOST and MESHPAGEPUB_PORT configure the bind address and port.\n'
      exit 0 ;;
    *) printf 'meshpagepub: unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done
[[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT >= 1 && PORT <= 65535)) || { printf 'meshpagepub: port must be between 1 and 65535\n' >&2; exit 2; }
[[ "$HOST" != *[$'\n\r ']* ]] || { printf 'meshpagepub: host must not contain whitespace\n' >&2; exit 2; }

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

systemd_path_value() {
  local value="$1"
  value=${value//\\/\\x5c}
  value=${value// /\\x20}
  value=${value//#/\\x23}
  value=${value//%/%%}
  printf '%s' "$value"
}

systemd_quote() {
  local value="$1"
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//%/%%}
  value=${value//\$/\$\$}
  printf '"%s"' "$value"
}

xml_escape() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

install_systemd_service() {
  command -v systemctl >/dev/null 2>&1 || fail "systemd is required for service mode. Use --foreground to run in this terminal."
  systemctl --user show-environment >/dev/null 2>&1 || fail "The systemd user service manager is unavailable. Log in to a user session or use --foreground."
  local node_bin unit_dir unit_file
  node_bin="$(command -v node)"
  unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
  unit_file="$unit_dir/meshpagepub.service"
  mkdir -p "$unit_dir"
  {
    printf '%s\n' '[Unit]' 'Description=MeshPage Publisher' 'After=network.target' '' '[Service]' 'Type=simple'
    printf 'WorkingDirectory=%s\n' "$(systemd_path_value "$ROOT")"
    printf 'ExecStart=%s %s --host %s --port %s\n' "$(systemd_quote "$node_bin")" "$(systemd_quote "$ROOT/server.js")" "$(systemd_quote "$HOST")" "$(systemd_quote "$PORT")"
    printf '%s\n' 'Restart=on-failure' 'RestartSec=3' 'Environment=NODE_ENV=production' '' '[Install]' 'WantedBy=default.target'
  } > "$unit_file"
  systemctl --user daemon-reload
  systemctl --user enable --now meshpagepub.service || fail "Could not start the user service. Check: systemctl --user status meshpagepub.service"
  info "Installed and started systemd user service."
  info "Manage it with: systemctl --user status|restart|stop meshpagepub.service"
}

install_launch_agent() {
  command -v launchctl >/dev/null 2>&1 || fail "launchd is required for macOS service mode. Use --foreground to run in this terminal."
  local node_bin agent_dir plist label
  node_bin="$(command -v node)"
  label="com.eastmesh.meshpagepub"
  agent_dir="$HOME/Library/LaunchAgents"
  plist="$agent_dir/$label.plist"
  mkdir -p "$agent_dir" "$HOME/Library/Logs"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$label</string>
<key>ProgramArguments</key><array>
<string>$(xml_escape "$node_bin")</string>
<string>$(xml_escape "$ROOT/server.js")</string>
<string>--host</string><string>$(xml_escape "$HOST")</string>
<string>--port</string><string>$(xml_escape "$PORT")</string>
</array>
<key>WorkingDirectory</key><string>$(xml_escape "$ROOT")</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$(xml_escape "$HOME/Library/Logs/meshpagepub.log")</string>
<key>StandardErrorPath</key><string>$(xml_escape "$HOME/Library/Logs/meshpagepub-error.log")</string>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist" || fail "Could not start the launch agent. Check: launchctl print gui/$(id -u)/$label"
  info "Installed and started launch agent. It starts when you log in."
  info "Manage it with: launchctl kickstart -k gui/$(id -u)/$label (restart), or launchctl bootout gui/$(id -u)/$label (stop)."
}

print_url() {
  printf '\nMeshPage Publisher is ready.\n'
  printf 'Open: http://%s:%s/\n' "$HOST" "$PORT"
  printf 'The server listens on the selected interface; allow TCP port %s in the host firewall if needed.\n' "$PORT"
  printf 'Web Serial/Bluetooth require a Chromium-based browser in a secure context (localhost or HTTPS).\n'
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

print_url
case "$(uname -s)" in
  Linux)
    if [[ "$MODE" == foreground ]]; then
      info "Running in foreground. Press Ctrl+C to stop."
      exec node server.js --host "$HOST" --port "$PORT"
    fi
    install_systemd_service
    ;;
  Darwin)
    if [[ "$MODE" == foreground ]]; then
      info "Running in foreground. Press Ctrl+C to stop."
      exec node server.js --host "$HOST" --port "$PORT"
    fi
    install_launch_agent
    ;;
  MINGW*|MSYS*|CYGWIN*)
    [[ "$MODE" == foreground ]] || fail "Windows service installation is not supported by this Bash installer. Run install.sh --foreground in WSL, or install a Windows service wrapper."
    exec node server.js --host "$HOST" --port "$PORT"
    ;;
esac
printf '%s\n' "Open $HOST:$PORT from the client browser."
