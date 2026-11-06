# MeshPage Publisher

Browser MVP for composing and publishing a sequence of posts to a MeshCore room-server node using a Companion Radio over USB serial or Bluetooth LE.

## Install and launch

Requires Node.js 18+ and npm. From a terminal in the cloned repository:

```sh
chmod +x install.sh
./install.sh
```

The installer installs the locked dependencies and starts the app listening on all network interfaces. Open the **Network URL** printed at startup (for example `http://192.168.1.225:8000/`) from another device on the same LAN. Open `http://127.0.0.1:8000/` on the host itself. Use a Chromium-based browser; browser USB/Bluetooth APIs work on localhost or HTTPS. Stop with Ctrl+C.

Optional bind settings:

```sh
MESHPAGEPUB_PORT=8080 MESHPAGEPUB_HOST=0.0.0.0 ./install.sh
```

`0.0.0.0` exposes the page to reachable interfaces. Restrict access with your host firewall and trusted Wi-Fi; the app has no web login and handles room credentials. To keep it local only, set `MESHPAGEPUB_HOST=127.0.0.1`.

For development, run `npm test` in another terminal. You can also start the app without reinstalling dependencies using `npm start`.

## Use

1. Connect to the Companion Radio over USB or BLE.
2. Select a room-server node from the radio's saved contacts (advertised room nodes), or enter its 64-character public key manually. Enter the room password and log in.
3. Use **Add message**, remove controls, drag-and-drop, or the up/down buttons to arrange the message list. The room-server firmware sets `MAX_POST_TEXT_LEN` to `160 - 9`, so each post is capped at **151 UTF-8 bytes**; the editor shows a live byte count and blocks oversized posts. Newlines count toward the limit and are preserved.
4. Save/load lists, choose a delay, and publish. The queue waits for each radio send command response and applies the selected delay before the next post.

Posts are MeshCore text messages to the room-server node. The room server may apply its own permissions and behavior. Clearing a room is deliberately unavailable: the documented simple room-server client protocol does not provide a history-delete operation; clearing local drafts is not server deletion.

## Tests

`npm test` exercises newline retention, public-key validation, room-server contact filtering, ordered delay behavior, and queue stop behavior without transmitting over radio. Hardware and real room-server login/posting require a compatible radio and room credentials.
