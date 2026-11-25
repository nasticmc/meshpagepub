# MeshPage Editor

Browser-based MeshPage editor for composing and arranging message pages. It does not connect to radios or publish messages. Pages are saved in browser storage and can be imported or exported as JSON.

## Install and launch

The installer checks for **Node.js 18+ and npm**. If they are missing or too old, it attempts to install them using apt (Debian/Ubuntu), dnf (Fedora/RHEL-family), pacman (Arch), or Homebrew (macOS); Linux installation may request administrator access through `sudo`. It then runs `npm ci` and builds the browser bundle. By default, Linux installs run as root create a boot-scoped **systemd system service**; non-root Linux installs create a **systemd user service** that starts with that user's login session. macOS installs a **LaunchAgent**. Services restart the server after failure. For an always-on Linux server, install as root so the service remains up across logouts and reboots. On Windows, install Node.js 18+ with `winget install OpenJS.NodeJS.LTS` (or from nodejs.org), then use WSL and run `./install.sh --foreground`.

Open the **Network URL** printed at install time (for example `http://192.168.1.225:8000/`) from a browser on the same LAN. Saved pages use that browser's local storage. Import/export JSON to move pages between browsers or devices.

To run in the foreground instead of installing a service, use `./install.sh --foreground`. Service management:

```sh
# Linux system service (root installation)
systemctl status meshpagepub.service
systemctl restart meshpagepub.service
systemctl stop meshpagepub.service

# Linux user service (non-root installation)
systemctl --user status meshpagepub.service
systemctl --user restart meshpagepub.service
systemctl --user stop meshpagepub.service

# macOS (LaunchAgent)
launchctl print gui/$(id -u)/com.eastmesh.meshpagepub
launchctl kickstart -k gui/$(id -u)/com.eastmesh.meshpagepub
launchctl bootout gui/$(id -u)/com.eastmesh.meshpagepub
```

Optional bind settings apply to both service and foreground modes:

```sh
MESHPAGEPUB_PORT=8080 MESHPAGEPUB_HOST=0.0.0.0 ./install.sh
```

`0.0.0.0` exposes the editor to reachable interfaces. Restrict access with your host firewall and trusted Wi-Fi. To keep it local only, set `MESHPAGEPUB_HOST=127.0.0.1`.

For development, run `npm test` in another terminal. You can also start the app without reinstalling dependencies using `npm start`.

## Use

1. Use **Add message** or the per-message **+** control to add messages. Remove controls, the reorder handle, and up/down buttons arrange the page. The handle supports touch/mouse dragging and keyboard arrow keys when focused.
2. Message fields start on one line and grow with the text. Each message is capped at **130 UTF-8 bytes**; the live byte count and input limit preserve complete Unicode characters. Newlines are retained. Each message editor includes a searchable emoji picker. **Preview** offers compact (360 × 640), standard (390 × 844), and large (430 × 932) phone viewport presets.
3. Name the page, then **Save** to store the current messages locally. The saved-paste list provides **Load** and per-paste **Export** actions. **Import** adds pages from JSON; imported text over 130 bytes is split into additional messages when loaded. Saved pages stay in this browser unless exported.

## Tests

`npm test` exercises installer scope/unit generation, editor-only UI controls, local page save/load/import/export affordances, message ordering, UTF-8-safe truncation, emoji insertion, and phone preview message data. The editor has no radio connection or publishing flow.
