export interface PresenceEntry {
  socketId: string;
  userId: string;
  name: string;
  avatarColor: string;
  x: number;
  y: number;
}

/**
 * Per-process presence store. A board's room maps socketId -> cursor entry.
 * Presence is kept soft (no TTL here); disconnects remove entries explicitly.
 */
const presenceByBoard = new Map<string, Map<string, PresenceEntry>>();

export function getBoardPresence(boardId: string): Map<string, PresenceEntry> {
  let map = presenceByBoard.get(boardId);
  if (!map) {
    map = new Map();
    presenceByBoard.set(boardId, map);
  }
  return map;
}

export function upsertPresence(boardId: string, entry: PresenceEntry): void {
  getBoardPresence(boardId).set(entry.socketId, entry);
}

export function removePresence(boardId: string, socketId: string): void {
  getBoardPresence(boardId).delete(socketId);
}

export function boardPresenceSnapshot(boardId: string): PresenceEntry[] {
  return Array.from(getBoardPresence(boardId).values());
}
