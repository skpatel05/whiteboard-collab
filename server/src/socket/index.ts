import crypto from "crypto";
import * as Y from "yjs";
import type { Server, Socket } from "socket.io";
import { User } from "../models/User";
import { Board } from "../models/Board";
import { WorkspaceRole } from "../models/Workspace";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../services/token.service";
import { getBoardAccess } from "../services/access.service";
import { logger } from "../lib/logger";
import { redis, redisSub } from "../lib/redis";
import { applyBoardOp, loadBoardDoc, writeSnapshot } from "./document";
import { boardPresenceSnapshot, removePresence, upsertPresence } from "./presence";

export type IOServer = Server;
export type IOSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface SocketAuth {
  id: string;
  name: string;
  email: string;
}

interface ClientToServerEvents {
  "board:join": (boardId: string, cb?: (res: unknown) => void) => void;
  "board:leave": (boardId: string) => void;
  "board:update": (
    payload: { boardId: string; update: string; baseVersion: number; clientId: number },
    cb?: (res: { ok: boolean; version?: number; error?: string }) => void,
  ) => void;
  "board:snapshot": (boardId: string, cb?: (res: { ok: boolean; version?: number }) => void) => void;
  "cursor:move": (payload: { boardId: string; x: number; y: number }) => void;
  "presence:request": (boardId: string) => void;
  "auth:refresh": (token: string, cb?: (res: { ok: boolean }) => void) => void;
}

interface ServerToClientEvents {
  "board:state": (state: {
    boardId: string;
    version: number;
    snapshot: string;
    role: WorkspaceRole;
    mySocketId: string;
    myUserId: string;
  }) => void;
  "board:update": (payload: {
    boardId: string;
    version: number;
    baseVersion: number;
    clientId: number;
    update: string;
    userId: string;
    origin: string;
  }) => void;
  "presence:update": (payload: { boardId: string; presence: unknown[] }) => void;
  "board:error": (payload: { code: string; message: string }) => void;
}

const SERVER_ID = crypto.randomUUID();
const boardChannel = (boardId: string) => `whiteboard:board:${boardId}`;
const presenceChannel = (boardId: string) => `whiteboard:presence:${boardId}`;

const registeredServers = new Set<IOServer>();
let fanoutStarted = false;

function startFanout(): void {
  if (fanoutStarted) return;
  fanoutStarted = true;

  void redisSub.psubscribe("whiteboard:board:*", "whiteboard:presence:*");

  redisSub.on("pmessage", (_pattern, channel, raw) => {
    try {
      const parsed = JSON.parse(raw) as {
        boardId: string;
        presence?: unknown[];
        excludeSocketId?: string;
        origin?: string;
      };
      const boardId = parsed.boardId;
      if (!boardId) return;

      if (channel.startsWith("whiteboard:board:")) {
        // Skip re-broadcasting messages this process originally published.
        if (parsed.origin?.startsWith(SERVER_ID)) return;
        for (const server of registeredServers) {
          server.to(roomOf(boardId)).emit("board:update", parsed);
        }
      } else if (channel.startsWith("whiteboard:presence:")) {
        if (!parsed.presence) return;
        const exclude = parsed.excludeSocketId;
        for (const server of registeredServers) {
          const broadcast = server.to(roomOf(boardId));
          if (exclude) {
            broadcast.except(exclude).emit("presence:update", { boardId, presence: parsed.presence });
          } else {
            broadcast.emit("presence:update", { boardId, presence: parsed.presence });
          }
        }
      }
    } catch {
      // Ignore malformed pub/sub messages.
    }
  });
}

function roomOf(boardId: string): string {
  return `board:${boardId}`;
}

function base64FromUint8(uint8: Uint8Array): string {
  return Buffer.from(uint8).toString("base64");
}

export function initSocket(io: IOServer): void {
  // --- Handshake auth: validate the access token before accepting the socket ---
  // A valid user access token authenticates a member. Otherwise the token is
  // treated as a public share link, which authenticates a guest with write
  // access to that single board.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        next(new Error("unauthorized"));
        return;
      }

      try {
        const payload = verifyAccessToken(token);
        const user = await User.findById(payload.sub, { name: 1, email: 1, avatarColor: 1 }).lean();
        if (!user) throw new Error("user not found");
        socket.data.auth = {
          id: String(user._id),
          name: user.name,
          email: user.email,
        } satisfies SocketAuth;
        socket.data.avatarColor = user.avatarColor;
        next();
        return;
      } catch {
        // Not a valid access token — fall through to the public share token.
      }

      const board = await Board.findOne({ "shareToken.token": token }).lean();
      if (!board || !board.shareToken?.expiresAt || board.shareToken.expiresAt < new Date()) {
        next(new Error("unauthorized"));
        return;
      }
      const boardId = String(board._id);
      socket.data.auth = {
        id: boardId,
        name: "Guest",
        email: "",
      } satisfies SocketAuth;
      socket.data.shareBoardId = boardId;
      socket.data.avatarColor = "#6366f1";
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as IOSocket;
    // Give share-token guests a distinct name so multiple guests are
    // distinguishable in the presence layer.
    if (socket.data.shareBoardId && socket.data.auth.name === "Guest") {
      socket.data.auth = { ...socket.data.auth, name: `Guest ${socket.id.slice(-4)}` };
    }
    const auth = socket.data.auth as SocketAuth;
    const shareBoardId = socket.data.shareBoardId as string | undefined;
    const joinedBoards = new Set<string>();

    // --- Redis pub/sub: fan board+presence events across server instances ---
    const publish = (channel: string, message: unknown) => {
      void redis.publish(channel, JSON.stringify(message)).catch((err) => {
        logger.error("Redis publish failed", err);
      });
    };

    socket.on("board:join", async (boardId, cb) => {
      try {
        let role: WorkspaceRole;
        if (shareBoardId) {
          // Guests authenticated via a share link may only join that board.
          if (boardId !== shareBoardId) {
            throw ApiError.notFound("Board not found");
          }
          role = "editor";
        } else {
          const access = await getBoardAccess(boardId, auth.id);
          if (!access.role) {
            throw ApiError.notFound("Board not found");
          }
          role = access.role;
        }

        socket.join(roomOf(boardId));
        joinedBoards.add(boardId);
        socket.data.boardRole = role;
        socket.data.boardId = boardId;

        // Load/construct the latest document state for this joiner.
        const cached = await loadBoardDoc(boardId);
        const snapshot = base64FromUint8(Y.encodeStateAsUpdate(cached.doc));

        // Announce presence of the joined user to the room (other members).
        const entry = {
          socketId: socket.id,
          userId: auth.id,
          name: auth.name,
          avatarColor: socket.data.avatarColor ?? "",
          x: 0,
          y: 0,
        };
        upsertPresence(boardId, entry);
        io.to(roomOf(boardId)).except(socket.id).emit("presence:update", {
          boardId,
          presence: boardPresenceSnapshot(boardId),
        });

        socket.emit("board:state", {
          boardId,
          version: cached.lastVersion,
          snapshot,
          role,
          mySocketId: socket.id,
          myUserId: auth.id,
        });
        cb?.({ ok: true });
      } catch (err) {
        socket.emit("board:error", {
          code: (err as { code?: string })?.code ?? "ERROR",
          message: (err as Error)?.message ?? "Failed to join board",
        });
        cb?.({ ok: false, error: (err as Error)?.message });
      }
    });

    socket.on("board:leave", (boardId) => {
      removePresence(boardId, socket.id);
      socket.leave(roomOf(boardId));
      joinedBoards.delete(boardId);
      io.to(roomOf(boardId)).emit("presence:update", {
        boardId,
        presence: boardPresenceSnapshot(boardId),
      });
    });

    socket.on("board:update", async (payload, cb) => {
      try {
        // Authorization check on EVERY write event (not just at join).
        const role = await authorizeWrite(payload.boardId, auth.id, socket);
        if (!role) return;

        const update = Buffer.from(payload.update, "base64");
        const version = await applyBoardOp({
          boardId: payload.boardId,
          userId: auth.id,
          update,
          baseVersion: payload.baseVersion ?? 0,
          clientId: payload.clientId ?? 0,
        });

        const message = {
          boardId: payload.boardId,
          version,
          baseVersion: payload.baseVersion ?? 0,
          clientId: payload.clientId ?? 0,
          update: payload.update,
          userId: auth.id,
          origin: `${SERVER_ID}:${socket.id}`,
        };

        // Broadcast to this server's room (skip the sender)...
        io.to(roomOf(payload.boardId)).except(socket.id).emit("board:update", message);
        // ...and to every other server instance via Redis pub/sub.
        publish(boardChannel(payload.boardId), message);

        cb?.({ ok: true, version });
      } catch (err) {
        socket.emit("board:error", {
          code: (err as { code?: string })?.code ?? "ERROR",
          message: (err as Error)?.message ?? "Update failed",
        });
        cb?.({ ok: false, error: (err as Error)?.message });
      }
    });

    socket.on("board:snapshot", async (boardId, cb) => {
      try {
        const role = await authorizeWrite(boardId, auth.id, socket);
        if (!role) return;
        const version = await writeSnapshot(boardId, auth.id);
        cb?.({ ok: true, version });
      } catch (err) {
        cb?.({ ok: false });
      }
    });

    socket.on("cursor:move", (payload) => {
      const { boardId, x, y } = payload ?? {};
      if (!boardId || !joinedBoards.has(boardId) || typeof x !== "number" || typeof y !== "number") {
        return;
      }
      upsertPresence(boardId, {
        socketId: socket.id,
        userId: auth.id,
        name: auth.name,
        avatarColor: socket.data.avatarColor ?? "",
        x,
        y,
      });
      // Broadcast the authoritative full presence snapshot so clients can
      // replace (never clobber) their local list on every update.
      const presence = boardPresenceSnapshot(boardId);
      io.to(roomOf(boardId)).except(socket.id).emit("presence:update", {
        boardId,
        presence,
      });
      publish(presenceChannel(boardId), { boardId, presence, excludeSocketId: socket.id });
    });

    socket.on("presence:request", (boardId) => {
      socket.emit("presence:update", {
        boardId,
        presence: boardPresenceSnapshot(boardId),
      });
    });

    socket.on("auth:refresh", async (token, cb) => {
      try {
        const payload = verifyAccessToken(token);
        const user = await User.findById(payload.sub, { name: 1, email: 1, avatarColor: 1 }).lean();
        if (!user) {
          cb?.({ ok: false });
          return;
        }
        socket.data.auth = { id: String(user._id), name: user.name, email: user.email } satisfies SocketAuth;
        socket.data.avatarColor = user.avatarColor;
        cb?.({ ok: true });
      } catch {
        cb?.({ ok: false });
      }
    });

    socket.on("disconnect", () => {
      for (const boardId of joinedBoards) {
        removePresence(boardId, socket.id);
        io.to(roomOf(boardId)).emit("presence:update", {
          boardId,
          presence: boardPresenceSnapshot(boardId),
        });
      }
      joinedBoards.clear();
    });
  });

  // --- Cross-instance fan-out (subscribe + register once per process) ---
  registeredServers.add(io);
  startFanout();
}

/** Re-verify write access against the DB on every mutating socket event. */
async function authorizeWrite(
  boardId: string,
  userId: string,
  socket: IOSocket,
): Promise<WorkspaceRole | null> {
  try {
    const shareBoardId = socket.data.shareBoardId as string | undefined;
    if (shareBoardId) {
      // Share-link guests are always allowed to edit their shared board.
      if (boardId !== shareBoardId) {
        socket.emit("board:error", { code: "NOT_FOUND", message: "Board not found" });
        return null;
      }
      return "editor";
    }
    const access = await getBoardAccess(boardId, userId);
    if (!access.role) {
      socket.emit("board:error", { code: "NOT_FOUND", message: "Board not found" });
      return null;
    }
    if (access.role !== "owner" && access.role !== "editor") {
      socket.emit("board:error", { code: "FORBIDDEN", message: "Viewers cannot modify the board" });
      return null;
    }
    return access.role;
  } catch {
    socket.emit("board:error", { code: "UNAUTHORIZED", message: "Access revoked" });
    return null;
  }
}
