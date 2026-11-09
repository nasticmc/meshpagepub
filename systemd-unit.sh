#!/usr/bin/env bash

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

meshpagepub_systemd_scope() {
  local uid="${1:-$EUID}"
  [[ "$uid" =~ ^[0-9]+$ ]] || return 2
  if (( uid == 0 )); then
    printf 'system'
  else
    printf 'user'
  fi
}

render_meshpagepub_unit() {
  local scope="$1" node_bin="$2" root="$3" host="$4" port="$5"
  case "$scope" in
    system)
      printf '%s\n' '[Unit]' 'Description=MeshPage Publisher' 'Wants=network-online.target' 'After=network-online.target' '' '[Service]' 'Type=simple' 'User=root'
      ;;
    user)
      printf '%s\n' '[Unit]' 'Description=MeshPage Publisher' 'After=network.target' '' '[Service]' 'Type=simple'
      ;;
    *)
      printf 'meshpagepub: invalid systemd scope: %s\n' "$scope" >&2
      return 2
      ;;
  esac
  printf 'WorkingDirectory=%s\n' "$(systemd_path_value "$root")"
  printf 'ExecStart=%s %s --host %s --port %s\n' \
    "$(systemd_quote "$node_bin")" "$(systemd_quote "$root/server.js")" \
    "$(systemd_quote "$host")" "$(systemd_quote "$port")"
  printf '%s\n' 'Restart=on-failure' 'RestartSec=3' 'Environment=NODE_ENV=production' '' '[Install]'
  if [[ "$scope" == system ]]; then
    printf '%s\n' 'WantedBy=multi-user.target'
  else
    printf '%s\n' 'WantedBy=default.target'
  fi
}
