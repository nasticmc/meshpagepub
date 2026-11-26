# Collaboration mode plan

## Goal

Add anonymous real-time collaboration for MeshPage pages.

- A user creates a shared page and receives a long, unguessable share code/link.
- Anyone with that code can join and edit; there are no accounts or logins.
- Each collaborator chooses a temporary display name for presence only.
- Shared pages expire seven days after their last **content edit**.
- Existing browser-local saved pastes, JSON import/export, and the 130-byte per-message allowance remain available.

## Product scope

### Shared-page workflow

1. A user chooses **Share current page**.
2. The app creates a shared copy of the current title and messages.
3. The app shows a copyable share link and code.
4. A collaborator opens the link or enters the code, then supplies a temporary display name.
5. Both users can edit text, add/remove/reorder messages, use emoji insertion, and see changes in real time.
6. The shared page expires seven days after its last document change.
7. Users may save a local copy or export JSON at any time.

### Explicit non-goals for v1

- Accounts, passwords, email, or identity verification.
- Ownership transfer or account recovery.
- Version history, comments, or audit logs.
- Fine-grained permissions; possession of the share code grants edit access.
- End-to-end encryption.
- Character-level collaborator cursor rendering. Presence should initially show names and the message being edited.

## Architecture

The existing application is a static Node server with browser-local persistence. Collaboration requires a backend with durable shared-page storage and a WebSocket endpoint.

```text
Browser editor
  ├─ Local pages: browser localStorage
  └─ Shared pages: HTTPS API + WSS collaboration connection
                         │
                         ├─ Node application server
                         ├─ SQLite database
                         ├─ Yjs document/update persistence
                         └─ hourly expiry cleanup
```

### Collaboration engine

Use Yjs for shared document state and WebSocket-based synchronization.

Why:

- Simultaneous edits converge rather than overwriting each other.
- Ordered message lists and text fields can be represented as collaborative data.
- Reconnects can receive persisted state and resume synchronization.
- Presence data can remain ephemeral instead of being stored with the page.

### Shared document model

One shared Yjs document represents one page.

```js
{
  schemaVersion: 1,
  title: "Weekly mesh update",
  messages: [
    { id: "msg_uuid", text: "First message" },
    { id: "msg_uuid", text: "Second message" }
  ]
}
```

Rules:

- Every message has a stable UUID; array position is not identity.
- The message collection is a collaborative ordered array.
- Message text and title are collaborative text values.
- Add/remove/reorder operations mutate the collaborative document.
- Overflow splitting runs as one transaction: replace the overflowing text with its first chunk, then insert continuation messages immediately after it.
- Every resulting message must remain at or below 130 UTF-8 bytes.

## Access and share codes

### Code requirements

- Generate at least 128 bits of cryptographically random entropy.
- Encode the code in a URL-safe form and place it in `/share/:code`.
- Store only a keyed hash of the code in SQLite.
- Do not log raw codes or message bodies.
- Treat possession of the link/code as edit authority.

### Abuse limits

Initial limits:

- 10 connected collaborators per page.
- 100 messages per page.
- 32 KB total visible message text per shared page.
- Maximum individual WebSocket update size.
- Rate-limit share creation and invalid-code attempts by IP.
- Require the known MeshPage browser origin for WebSocket connections.

## Persistence model

Use SQLite outside the deployed source checkout.

```sql
shared_pages (
  id TEXT PRIMARY KEY,
  code_hash BLOB UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  last_edited_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  title_snapshot TEXT,
  state_blob BLOB NOT NULL,
  schema_version INTEGER NOT NULL
)
```

Implementation notes:

- Persist compacted Yjs document state after a short debounce following a content mutation.
- Update `last_edited_at` and `expires_at` only for document changes, not joins, presence changes, previews, or reconnects.
- Store no collaborator names in durable page state unless a future feature requires it.
- Back up SQLite separately from application assets.

## HTTP and WebSocket interface

### `POST /api/shared-pages`

Create a shared copy of a local page.

```json
{
  "title": "Weekly mesh update",
  "messages": ["First message", "Second message"]
}
```

The server validates shape and normalizes over-limit legacy/imported content into 130-byte message chunks.

```json
{
  "code": "m_example",
  "shareUrl": "/share/m_example",
  "expiresAt": "2026-12-03T12:00:00Z"
}
```

### `GET /api/shared-pages/:code`

Return safe metadata needed for join UI:

```json
{
  "title": "Weekly mesh update",
  "expiresAt": "2026-12-03T12:00:00Z",
  "expired": false
}
```

### `WSS /collab/:code`

The collaboration connection must:

1. Verify the share code and expiry before accepting the connection.
2. Load persisted document state.
3. Synchronize document updates and ephemeral presence.
4. Persist changes and extend expiry after content mutations.
5. Reject or close expired rooms with a clear reason.

## Frontend changes

### Pages panel

Keep local saves visible and add collaboration controls.

```text
PAGES
[ Save local ] [ Import ]

Local saved pastes
  Weekly check-in · 2 messages  [Load] [Export]

Collaboration
[ Share current page ] [ Join with code ]
```

### Shared-page state

When a shared page is open, display:

```text
SHARED PAGE
Weekly mesh update
Sam, Alex connected
Expires in 6 days
[ Copy share link ] [ Save local copy ] [ Leave shared page ]
```

Add clear connection states:

- Connecting
- Connected
- Reconnecting — changes will sync when connected
- Invalid share code
- This shared page has expired
- Page unavailable

### Routing

Add `/share/:code`.

Opening a share link must:

1. Display page metadata if available.
2. Ask for a temporary display name.
3. Connect to collaboration only after the user submits the name.
4. Render the existing editor in shared mode.

The editor must make local mode and shared mode explicit. Saving a shared page locally is a deliberate copy action, not an automatic local overwrite.

## Presence

Presence is not persisted. Initial data:

```js
{
  name: "Alex",
  color: "#...",
  activeMessageId: "msg_uuid"
}
```

V1 behavior:

- Show connected names.
- Show which message another collaborator is currently editing.
- Remove presence when a connection closes.
- Do not persist names or presence history.

## Expiry and cleanup

### Expiry rule

```text
expires_at = last_edited_at + 7 days
```

A document edit extends the expiry. Viewing, joining, reconnecting, or updating presence does not.

### Cleanup job

Run hourly:

1. Find pages with `expires_at <= now`.
2. Evict the room from active memory.
3. Close active connections with an expiry reason.
4. Delete persisted page state and metadata.
5. Record only aggregate operational information, never page contents or raw codes.

The server must check expiry both before connection and before persistence, so a stale connection cannot revive an expired page.

## Delivery phases

### Phase 1 — Service foundation

- Refactor `server.js` into an application server while preserving static serving.
- Add SQLite schema, migrations, backup location, and health endpoint.
- Add HTTP shared-page creation/metadata endpoints.
- Add WebSocket upgrade path and reverse-proxy WebSocket configuration.
- Add code hashing, rate limiting, expiry checks, and hourly cleanup.

**Acceptance:** valid code can retrieve metadata; invalid or expired code cannot connect; existing local editor remains functional.

### Phase 2 — Collaborative data model

- Add Yjs and WebSocket provider dependencies.
- Implement document adapter for title, ordered messages, and message text.
- Bind local edits to document updates and remote updates to the editor UI.
- Implement transactional add/remove/reorder/overflow splitting.
- Persist and recover document state across server restarts.

**Acceptance:** two isolated browser sessions can edit simultaneously, reorder messages, reconnect, and converge without losing text.

### Phase 3 — Collaboration UX

- Add Share current page, Join with code, copy link/code, leave, and save-local-copy controls.
- Add name prompt, presence indicator, connection status, and expiry messaging.
- Ensure local and shared modes cannot silently overwrite each other.
- Verify desktop and 390×844 mobile layouts.

**Acceptance:** a first-time user can create, join, edit, and export a shared page without instructions.

### Phase 4 — Tests and hardening

Unit tests:

- Share code generation and hash verification.
- Seven-day expiry calculations.
- 130-byte UTF-8 boundary and overflow transactions.
- Collaborative array reorder/add/remove behavior.
- Local-mode compatibility.

Integration tests:

- Two concurrent WebSocket clients.
- Simultaneous edits to one message.
- Reconnect and persisted-state recovery.
- Invalid/expired share codes.
- Expiry cleanup and room closure.
- Rate-limit behavior.

Browser tests:

- Real typing from two browser contexts.
- Overflow continuation visible to both collaborators.
- Shared/local mode transitions.
- Presence changes.
- Narrow viewport geometry and touch controls.

### Phase 5 — Production rollout

1. Read-only preflight the current New-Haven service, reverse proxy, WebSocket support, and storage path.
2. Back up existing static assets, service configuration, and database location.
3. Deploy application server, static bundle, schema, and proxy changes together.
4. Verify public HTTPS and WSS behavior with two real browser sessions.
5. Verify restart recovery, expiry rejection, and unchanged unrelated services.
6. Keep a rollback package for the prior static-only deployment.

## Rollback plan

- Preserve the previous static app bundle and service configuration before rollout.
- Keep the SQLite database separate from the application release directory.
- If the collaboration backend fails, roll back the service/static release while retaining the database untouched for investigation.
- Do not roll back by deleting shared-page data.

## Decisions locked for v1

| Topic | Decision |
| --- | --- |
| Authentication | None |
| Edit authority | Possession of share code/link |
| Collaborator identity | Temporary display name only |
| Page expiry | Seven days after last content edit |
| Shared-page persistence | SQLite + persisted collaborative state |
| Sync model | Yjs + WebSocket |
| Presence | Names and active message only |
| Max collaborators | 10 |
| Max page size | 100 messages / 32 KB visible text |
| History | None in v1 |
| Existing local pages | Remain browser-local and unchanged |

## Open implementation checks

Before coding, verify:

1. New-Haven reverse proxy supports WebSocket upgrade headers and timeouts.
2. The service can write to a dedicated non-root data directory.
3. The deployment process can update server dependencies and static assets atomically.
4. Backups include SQLite state without exposing raw share codes in logs.
5. The public host enforces HTTPS/WSS end-to-end.
