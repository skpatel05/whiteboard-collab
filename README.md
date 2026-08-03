# Collaborative Real-Time Whiteboard & Meeting Notes Platform

A Miro-style whiteboard where teams draw, add sticky notes, and co-edit meeting
minutes in real time, then export a shareable meeting summary.

> WIP — project scaffolding. Detailed setup, architecture diagram and API docs
> land in the final phase.

## Tech Stack

- **Frontend:** React 18, Vite, Zustand, TailwindCSS, React-Konva, Socket.IO client, Yjs
- **Backend:** Node.js, Express, Socket.IO, Mongoose, Redis (pub/sub), Yjs (CRDT)
- **Database:** MongoDB (Users, Workspaces, Boards, BoardOps, Notes, Invitations)
- **Auth:** JWT access + httpOnly refresh cookie, bcrypt, email verification
- **Deploy:** Docker + docker-compose

## Layout

```
whiteboard-collab/
├── client/        # React frontend
├── server/        # Express + Socket.IO backend
└── docker/        # Docker support files
```

## Getting Started (soon)

```bash
cp .env.example .env
npm install
npm run dev:server
npm run dev:client
```
