# MeshPage Publisher

Browser publisher for composing and publishing a sequence of posts to a MeshCore room-server node using a Companion Radio over USB serial, Bluetooth LE, or TCP on a local IPv4 network.

## Install and launch

The installer checks for **Node.js 18+ and npm**. If they are missing or too old, it attempts to install them using apt (Debian/Ubuntu), dnf (Fedora/RHEL-family), pacman (Arch), or Homebrew (macOS); Linux installation may request administrator access through `sudo`. It then runs `npm ci` and builds the browser bundle. By default, Linux installs and starts a **systemd user service**; macOS installs and starts a **LaunchAgent**. Both restart the server after failure and start on later user logins. Linux requires an available systemd user manager. On Windows, install Node.js 18+ with `winget install OpenJS.NodeJS.LTS` (or from nodejs.org), then use WSL and run `./install.sh --foreground`.

The machine hosting the server does not need a desktop browser. Open the **Network URL** printed at install time (for example `http://192.168.1.225:8000/`) from another device on the same LAN. Use a Chromium-based browser. **Viewing the page over plain HTTP on a LAN IP is fine, but Web Serial/Bluetooth generally require a secure context (localhost or HTTPS)**; to use a radio attached to the client device remotely, serve the page over HTTPS. If the radio is attached to the host, open `http://localhost:8000/` in a Chromium browser on that host.

To run in the foreground instead of installing a service, use `./install.sh --foreground`. Service management:

```sh
# Linux (systemd user service)
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

`0.0.0.0` exposes the page to reachable interfaces. Restrict access with your host firewall and trusted Wi-Fi; the app has no web login and handles room credentials. The TCP bridge also lets same-origin page requests open a connection from the server to a companion; it only accepts literal local IPv4 addresses in private, shared, loopback, or link-local ranges—not public addresses or hostnames. This also allows the `100.64.0.0/10` shared-address range. Use it only on a trusted LAN. To keep the page local only, set `MESHPAGEPUB_HOST=127.0.0.1`.

TCP mode is useful when the Companion Radio is reachable from the server over the local network. Enter its local IPv4 address and TCP port in **Connect radio / choose room**; the default is port `5000`. USB and Bluetooth continue to connect directly from the browser. TCP mode is server-side, so the machine running MeshPage Publisher must be able to reach the companion.

For development, run `npm test` in another terminal. You can also start the app without reinstalling dependencies using `npm start`.

## Use

1. Connect to the Companion Radio over USB, BLE, or TCP using its local IPv4 address and port (default `5000`).
2. Select a room-server node from the radio's saved contacts (advertised room nodes), or enter its 64-character public key manually. Enter the room password and log in.
3. Use **Add message**, remove controls, drag-and-drop, or the up/down buttons to arrange the message list. The room-server firmware sets `MAX_POST_TEXT_LEN` to `160 - 9`, so each post is capped at **151 UTF-8 bytes**; the editor shows a live byte count and blocks oversized posts. Newlines count toward the limit and are preserved.
4. Save/load lists, choose a whole-number delay in seconds, and publish. The queue waits for each radio send command response and applies the selected delay before the next post.

Posts are MeshCore text messages to the room-server node. The room server may apply its own permissions and behavior. Clearing a room is deliberately unavailable: the documented simple room-server client protocol does not provide a history-delete operation; clearing local drafts is not server deletion.

## Tests

`npm test` exercises newline retention, public-key validation, room-server contact filtering, ordered delay behavior and seconds conversion, queue stop behavior, TCP target validation, and the TCP bridge flow using a fake companion. No real radio transmission is performed. Hardware and real room-server login/posting require a compatible radio and room credentials.
