# Collaborative Real-Time Whiteboard & Meeting Notes

A Miro-style whiteboard where teams draw shapes and sticky notes on an infinite
canvas, co-edit meeting minutes, and see each other's cursors live — then
generate action items with a (mock) AI assistant and export a shareable PDF
meeting summary.

- **Real-time canvas** — Yjs CRDT keeps every client converged with no lost
  updates (proven by tests: concurrent edits from multiple clients merge and
  produce byte-identical documents).
- **Live presence** — everyone's cursor and name tag move in real time.
- **Meeting minutes** — collaborative, markdown-style notes panel.
- **Permissions** — workspaces with owner / editor / viewer roles.
- **Share & history** — public view-only links and snapshot-based version
  restore.
- **Offline tolerance** — Yjs updates buffer in IndexedDB and replay on
  reconnect.
- **Export** — server-generated PDF summary + mock-AI action-item extraction.

---

## Architecture

```
┌─────────────┐        ┌─────────────┐
│  client      │  http │  server      │  mongoose  ┌─────────┐
│  (React,     │◄─────►│  (Express,   │◄──────────►│ MongoDB │
│   Vite, Konva│  ws   │   Socket.IO, │             └─────────┘
│   + Yjs)     │◄─────►│   Yjs)       │  optional   ┌─────────┐
└─────────────┘        └─────────────┘◄───────────►│  Redis  │
                      (3 docker services)           └─────────┘
```

### Why Yjs + an ops log

Every board is a Yjs document: the `shapes` map (canvas objects) and the
`minutes` text are CRDTs. Clients send binary Yjs updates over Socket.IO; the
server merges them, persists each one as a **BoardOp**, and broadcasts to the
room.

- The latest **snapshot** plus every newer incremental op are replayed to
  reconstruct a board (loads in O(snapshot)).
- A snapshot is persisted every **50 ops** to keep history compact.
- Boards are versioned with an atomic `currentVersion` counter (used for
  restore and sync).

### Redis (optional)

Redis backs two things: refresh-token rotation and cross-instance pub/sub
fan-out. If `REDIS_URL` is empty the server uses an **in-memory fallback**
(expiring key/value store + in-process pub/sub) so the whole platform runs with
just **MongoDB + server + client** — three containers. Set a real `REDIS_URL`
only when scaling to multiple server instances.

### Security

- JWT access tokens (`15m`) + httpOnly refresh cookie (`30d`) with rotation.
- Refresh tokens live in Redis/fallback and are revoked on logout/rotation.
- Email verification via SMTP (falls back to console transport in dev).
- Every mutating Socket.IO event re-verifies the user's role via the database.

---

## Quick start

### Option A — Docker (3 containers) — what an interviewer will run

```bash
cp .env.example .env
docker compose up --build
```

| Service | URL                 |
| ------- | ------------------- |
| Client  | http://localhost:3000 |
| Server  | http://localhost:4000 |
| MongoDB | localhost:27017     |

Seed demo data (optional, run locally or `docker compose exec server npm run seed`):

```bash
npm run seed
# owner@whiteboard.local / demo1234  (owner)
# collab@whiteboard.local / demo1234  (editor)
```

### Option B — Local development (no Docker)

Prerequisites: Node 18+, MongoDB running on `localhost:27017` (Redis optional).

```bash
npm install
cp .env.example .env          # root, for docker-compose (if you use it)
cp server/.env.example server/.env

# terminal 1 — backend (http://localhost:4000)
npm run dev:server

# terminal 2 — frontend (http://localhost:5173)
npm run dev:client

# seed demo users/boards
npm run seed
```

Open http://localhost:5173 and log in with `owner@whiteboard.local / demo1234`.
Open a second browser window (or incognito) as the collaborator to watch
real-time sync and cursors.

---

## Testing

Tests run against a **real local MongoDB** (the same stack an interviewer
runs) using a dedicated `whiteboard_test` database that is dropped on each run.
Redis is exercised via the in-memory fallback unless `REDIS_URL` is set.

```bash
npm test                     # from repo root, or:
npm test --workspace server
```

38 integration tests cover auth, workspaces, boards, notes, export/AI, and
realtime sync (3 concurrent clients converge; concurrent edits merge; viewer
writes rejected; reconnect delivers missed state; presence broadcast/cleanup).

---

## Project layout

```
├── client/                  # React 18 + Vite + Zustand + Konva + Yjs
│   └── src/
│       ├── lib/             # api, socket wrapper, BoardDoc (Yjs), offline queue
│       ├── components/board/# canvas, toolbar, presence, notes, modals, AI panel
│       ├── pages/           # Login, Register, Dashboard, Board
│       └── store/           # zustand stores (auth, board, presence)
├── server/                  # Express + Socket.IO + Mongoose + Yjs
│   └── src/
│       ├── config/          # env
│       ├── controllers/     # auth, workspaces, boards, notes, export, ai
│       ├── lib/             # database, redis (with in-memory fallback), logger
│       ├── middleware/      # auth, rbac, error handling
│       ├── models/          # User, Workspace, Board, BoardOp, Note, Invitation
│       ├── services/        # tokens, access/RBAC
│       ├── socket/          # document (Yjs cache/apply/snapshot), presence, io
│       ├── tests/           # 38 integration tests
│       └── seed.ts          # demo data seeder
├── docker/                  # nginx.conf
├── postman/                 # API collection
├── docs/API.md              # full REST + WebSocket reference
└── docker-compose.yml       # mongo + server + client
```

---

## Environment variables

| Variable          | Default                              | Notes                                              |
| ----------------- | ------------------------------------ | -------------------------------------------------- |
| `PORT`            | `4000`                               | Server port                                        |
| `MONGO_URI`       | `mongodb://localhost:27017/whiteboard` | MongoDB connection string                        |
| `REDIS_URL`       | _(empty)_                            | Empty ⇒ in-memory fallback; set for multi-instance |
| `CLIENT_ORIGIN`   | `http://localhost:5173`              | CORS origin (use `http://localhost:3000` in Docker)|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev defaults  | Change in production                 |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `15m` / `30d` |              |
| `SMTP_*`          | _(unset)_                            | Mail transport; console fallback in dev           |

---

## Feature walkthrough

1. **Draw** — pick a tool (pen, rectangle, ellipse, line, arrow, sticky), pick a
   stroke color and width, and draw. `V/H/P/R/O/L/A/S` switch tools, `Ctrl+Z/Y`
   undo/redo, `Del` removes the selection, double-click a shape to edit its text.
2. **Collaborate** — open the board in two tabs. Shapes, stickies, minutes and
   cursors all sync live; every change also survives a refresh.
3. **Minutes** — open the right panel and type. Bold (`**`), italic (`*`) and
   bullet (`-`) helpers are on the toolbar.
4. **Share** — "Share" creates a public view-only link (can be revoked).
5. **Versions** — snapshots of the board history; restore any of them.
6. **AI & export** — "Generate action items" extracts next steps from minutes
   (mock LLM), and "Export PDF" downloads a server-generated meeting summary.

Full API reference: [docs/API.md](docs/API.md).
Postman collection: `postman/whiteboard-collab.postman_collection.json`.

## Keyboard shortcuts

| Key                 | Action                     |
| ------------------- | -------------------------- |
| `V` / `H` / `P` / `R` / `O` / `L` / `A` / `S` | select / pan / pen / rect / ellipse / line / arrow / sticky |
| `Ctrl+Z` / `Ctrl+Shift+Z` (or `Ctrl+Y`) | undo / redo            |
| `Del` / `Backspace` | delete selected shape       |

## License

MIT
