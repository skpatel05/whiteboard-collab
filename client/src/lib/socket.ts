import { io, Socket } from "socket.io-client";
import type { WorkspaceRole } from "../types";

export interface BoardStatePayload {
  boardId: string;
  version: number;
  snapshot: string;
  role: WorkspaceRole;
  mySocketId: string;
  myUserId: string;
}

export interface BoardUpdatePayload {
  boardId: string;
  version: number;
  baseVersion: number;
  clientId: number;
  update: string;
  userId: string;
  origin: string;
}

export interface PresenceEntry {
  socketId: string;
  userId: string;
  name: string;
  avatarColor?: string;
  x: number;
  y: number;
}

export interface PresenceUpdate {
  boardId: string;
  presence: PresenceEntry[];
}

type WbEvents = {
  connect: () => void;
  disconnect: () => void;
  "board:state": (state: BoardStatePayload) => void;
  "board:update": (payload: BoardUpdatePayload) => void;
  "presence:update": (payload: PresenceUpdate) => void;
  "board:error": (payload: { code: string; message: string }) => void;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class WhiteboardSocket {
  private socket: Socket | null = null;

  connect(token: string): void {
    if (this.socket) return;
    this.socket = io({
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
  }

  reconnect(token: string): void {
    this.disconnect();
    this.connect(token);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket?.removeAllListeners();
    this.socket = null;
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  /** Resolves when a live socket connection is available (waits if needed). */
  ensureConnected(): Promise<void> {
    if (this.socket?.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Socket connection timed out")), 8000);
      const check = setInterval(() => {
        if (this.socket?.connected) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 120);
    });
  }

  refreshAuth(token: string): void {
    if (this.socket?.connected) {
      this.socket.emit("auth:refresh", token, (res: { ok: boolean }) => {
        if (!res.ok) this.socket?.disconnect();
      });
    }
  }

  on<K extends keyof WbEvents>(event: K, handler: WbEvents[K]): () => void {
    const wrapped = handler as unknown as (...args: any[]) => void;
    this.socket?.on(event as string, wrapped);
    return () => this.socket?.off(event as string, wrapped);
  }

  joinBoard(boardId: string): Promise<BoardStatePayload> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error("Socket not connected"));
      // Resolve with the authoritative state delivered right after join.
      const onState = (state: BoardStatePayload) => {
        this.socket?.off("board:state", onState);
        resolve(state);
      };
      this.socket.once("board:state", onState);
      this.socket.emit("board:join", boardId, (res: { ok: boolean; error?: string }) => {
        if (res.ok) return;
        // Clean up the pending listener so a failed join can't resolve a later one.
        this.socket?.off("board:state", onState);
        reject(new Error(res.error ?? "Failed to join board"));
      });
    });
  }

  leaveBoard(boardId: string): void {
    this.socket?.emit("board:leave", boardId);
  }

  sendUpdate(boardId: string, update: Uint8Array, baseVersion: number, clientId: number): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error("Socket not connected"));
      this.socket.emit(
        "board:update",
        { boardId, update: bytesToBase64(update), baseVersion, clientId },
        (res: { ok: boolean; version?: number; error?: string }) => {
          if (res.ok) resolve(res.version ?? 0);
          else reject(new Error(res.error ?? "Update failed"));
        },
      );
    });
  }

  moveCursor(boardId: string, x: number, y: number): void {
    this.socket?.emit("cursor:move", { boardId, x, y });
  }

  requestPresence(boardId: string): void {
    this.socket?.emit("presence:request", boardId);
  }
}

export const whiteboardSocket = new WhiteboardSocket();
