# API Reference

Base URL: `http://localhost:4000/api` (dev) or `http://localhost:3000/api` (Docker/nginx).

Auth: most endpoints require `Authorization: Bearer <accessToken>`. Logging in
also sets a refresh cookie (`wb_refresh`, httpOnly) used by `POST /auth/refresh`.

All responses are wrapped:

```json
{ "success": true, "data": { ... } }          // 2xx
{ "success": false, "error": { "code": "...", "message": "...", "details": {} } }
```

---

## Auth

| Method | Path                  | Auth | Description |
| ------ | --------------------- | ---- | ----------- |
| POST   | `/auth/register`      | –    | `{ name, email, password }`. Sends verification email. |
| GET    | `/auth/verify-email?token=...` | – | Verify email address. |
| POST   | `/auth/login`         | –    | `{ email, password }` → `{ accessToken, user }` + refresh cookie. |
| POST   | `/auth/refresh`       | cookie | Rotate refresh token → new `accessToken`. |
| POST   | `/auth/logout`        | cookie | Revoke refresh token, clear cookie. |
| GET    | `/auth/me`            | Bearer | Current user profile. |

---

## Workspaces

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| POST   | `/workspaces` | Bearer | `{ name, description? }` → workspace (creator = owner). |
| GET    | `/workspaces` | Bearer | List my workspaces. |
| GET    | `/workspaces/:workspaceId` | Bearer | Workspace detail + members. |
| PATCH  | `/workspaces/:workspaceId` | owner | Update name/description. |
| DELETE | `/workspaces/:workspaceId` | owner | Delete workspace. |
| POST   | `/workspaces/:workspaceId/members` | owner | `{ userId, role: "editor"\|"viewer" }`. |
| PATCH  | `/workspaces/:workspaceId/members/:userId` | owner | `{ role }`. |
| DELETE | `/workspaces/:workspaceId/members/:userId` | owner | Remove member. |
| POST   | `/workspaces/:workspaceId/invitations` | owner | `{ email, role }` → invites by email. |
| GET    | `/workspaces/:workspaceId/invitations` | owner | List pending invitations. |
| DELETE | `/workspaces/:workspaceId/invitations/:invitationId` | owner | Cancel invitation. |

**Roles:** `owner` > `editor` > `viewer`. Editors and viewers are listed in
`members`; the workspace creator is always the `owner`.

---

## Boards

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| POST   | `/boards` | Bearer | `{ workspaceId, title, description? }` → board. |
| GET    | `/boards` | Bearer | List boards. Query: `workspace`, `search`, `starred=true`, `sort=updated\|created`. |
| GET    | `/boards/:boardId` | Bearer | Board detail + notes + Yjs `document` (snapshot + ops for replay). |
| PATCH  | `/boards/:boardId` | editor+ | Update title/description. |
| DELETE | `/boards/:boardId` | editor+ | Delete board. |
| POST   | `/boards/:boardId/star` | Bearer | Star (toggle) for current user. |
| DELETE | `/boards/:boardId/star` | Bearer | Unstar. |
| POST   | `/boards/:boardId/touch` | Bearer | Mark recently viewed. |
| POST   | `/boards/:boardId/share` | editor+ | Create public view-only link → `{ token, expiresAt }`. |
| DELETE | `/boards/:boardId/share` | editor+ | Revoke share link. |
| GET    | `/boards/:boardId/versions` | Bearer | List snapshots `{ version, user, createdAt }` (newest first). |
| POST   | `/boards/:boardId/versions/:version/restore` | editor+ | Restore a snapshot (writes a new version). |
| POST   | `/boards/:boardId/export/pdf` | Bearer | Streams a PDF meeting summary (pdfkit). |
| POST   | `/boards/:boardId/ai/action-items` | Bearer | Mock LLM: extracts action items from minutes. |
| GET    | `/boards/public/:token` | none | Public board data via share link (view-only). |

---

## Notes (sticky + minutes)

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| GET    | `/boards/:boardId/notes` | Bearer | List notes. Query: `kind=sticky\|minutes`. |
| POST   | `/boards/:boardId/notes` | editor+ | `{ kind, content, x?, y?, width?, height?, color? }`. |
| PATCH  | `/boards/:boardId/notes/:noteId` | editor+ | Update `content`/position/color. |
| DELETE | `/boards/:boardId/notes/:noteId` | editor+ | Delete note. |

---

## Invitations

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| POST   | `/invitations/:token/accept` | Bearer | Accept an email invitation → joins workspace. |

---

## WebSocket (Socket.IO) — realtime sync

Connect at `http://localhost:4000` (or `http://localhost:3000`) with
`auth: { token: "<accessToken>" }`, transports `["websocket"]`.

### Client → Server events

| Event | Payload | Notes |
| ----- | ------- | ----- |
| `board:join` | `boardId` | Joins the room; server replies `board:state` with full Yjs snapshot. |
| `board:update` | `{ boardId, update: "<base64 Yjs update>", baseVersion, clientId }` | Mutating op; ack `{ ok, version }`. |
| `board:snapshot` | `boardId` | Force a snapshot; ack `{ ok, version }`. |
| `cursor:move` | `{ boardId, x, y }` | Broadcast to room (except sender). |
| `presence:request` | `boardId` | Server replies current presence list. |
| `board:leave` | `boardId` | Leaves room; presence removed. |
| `auth:refresh` | `token` | Refresh socket identity mid-session. |

### Server → Client events

| Event | Payload | Notes |
| ----- | ------- | ----- |
| `board:state` | `{ boardId, version, snapshot, role, mySocketId, myUserId }` | Sent on join. |
| `board:update` | `{ boardId, version, baseVersion, clientId, update, userId, origin }` | Broadcast op from another client. |
| `presence:update` | `{ boardId, presence: [{ socketId, userId, name, avatarColor, x, y }] }` | Cursor/join/leave changes. |
| `board:error` | `{ code, message }` | e.g. `FORBIDDEN` for viewer writes. |

### Document format

The Yjs doc has two shared types:

- `shapes` — a `Y.Map<Shape>` where each value is
  `{ id, type: "pen"|"rect"|"ellipse"|"line"|"arrow"|"sticky", x?, y?, width?, height?, points?, stroke?, strokeWidth?, fill?, color?, text?, createdAt? }`.
- `minutes` — a `Y.Text` holding the meeting notes (diff-synced for
  conflict-free co-editing).

Snapshots are stored as `BoardOp` documents (`kind: "snapshot"`) with
incremental ops (`kind: "op"`) replayed on top; a new snapshot is written every
50 ops.

---

## Demo data (seed)

```bash
npm run seed
```

| Email | Password | Role |
| ----- | -------- | ---- |
| `owner@whiteboard.local` | `demo1234` | owner |
| `collab@whiteboard.local` | `demo1234` | editor |

The seeder creates a shared workspace, a pre-populated board (sticky notes,
shapes, minutes) and a blank board.
