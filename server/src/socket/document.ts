import * as Y from "yjs";
import { Board } from "../models/Board";
import { BoardOp } from "../models/BoardOp";

/**
 * In-memory per-board Y.Doc cache.
 *
 * A board document is lazily materialized from the latest persisted snapshot
 * plus every incremental op above it, then kept in memory so joining clients
 * can be served an up-to-date full state instantly and incoming ops can be
 * applied without a full DB replay.
 */

export const SNAPSHOT_INTERVAL = 50;

export interface CachedBoardDoc {
  doc: Y.Doc;
  lastVersion: number;
  lastSnapshotVersion: number;
  opsSinceSnapshot: number;
}

const cache = new Map<string, CachedBoardDoc>();

export function invalidateBoardCache(boardId: string): void {
  cache.delete(boardId);
}

export function getBoardDoc(boardId: string): CachedBoardDoc | undefined {
  return cache.get(boardId);
}

export async function loadBoardDoc(boardId: string): Promise<CachedBoardDoc> {
  const existing = cache.get(boardId);
  if (existing) return existing;

  const [board, lastSnapshot] = await Promise.all([
    Board.findById(boardId, { currentVersion: 1, lastSnapshotVersion: 1 }).lean(),
    BoardOp.findOne({ board: boardId, kind: "snapshot" }).sort({ version: -1 }).lean(),
  ]);

  // Only ops newer than the last snapshot need replaying.
  const snapshotVersion = lastSnapshot?.version ?? 0;
  const ops = await BoardOp.find({
    board: boardId,
    kind: "op",
    version: { $gt: snapshotVersion },
  })
    .sort({ version: 1 })
    .lean();

  const doc = new Y.Doc();

  if (lastSnapshot) {
    Y.applyUpdate(doc, lastSnapshot.payload as unknown as Uint8Array);
  }
  for (const op of ops) {
    Y.applyUpdate(doc, op.payload as unknown as Uint8Array);
  }

  const cached: CachedBoardDoc = {
    doc,
    lastVersion: board?.currentVersion ?? 0,
    lastSnapshotVersion: snapshotVersion,
    opsSinceSnapshot: 0,
  };
  cache.set(boardId, cached);
  return cached;
}

export interface ApplyOpInput {
  boardId: string;
  userId: string;
  update: Uint8Array;
  baseVersion: number;
  clientId: number;
}

/**
 * Apply a client-provided Yjs update: merge into the in-memory doc, persist the
 * op, bump the board's monotonic version atomically, and write a snapshot once
 * the op threshold is crossed.
 *
 * Returns the assigned version for the new op.
 */
export async function applyBoardOp(input: ApplyOpInput): Promise<number> {
  const cached = await loadBoardDoc(input.boardId);
  Y.applyUpdate(cached.doc, input.update);

  const board = await Board.findOneAndUpdate(
    { _id: input.boardId },
    { $inc: { currentVersion: 1 } },
    { new: true },
  ).lean();
  if (!board) {
    throw new Error("Board not found");
  }
  const version = board.currentVersion;

  await BoardOp.create({
    board: input.boardId,
    user: input.userId,
    kind: "op",
    version,
    baseVersion: input.baseVersion,
    clientId: input.clientId,
    payload: Buffer.from(input.update),
  });

  cached.lastVersion = version;
  cached.opsSinceSnapshot += 1;

  if (cached.opsSinceSnapshot >= SNAPSHOT_INTERVAL) {
    await writeSnapshot(input.boardId, input.userId);
  }

  return version;
}

/** Persist the current in-memory document state as a new snapshot op. */
export async function writeSnapshot(boardId: string, userId: string): Promise<number> {
  const cached = await loadBoardDoc(boardId);
  const snapshotPayload = Buffer.from(Y.encodeStateAsUpdate(cached.doc));

  const board = await Board.findOneAndUpdate(
    { _id: boardId },
    { $inc: { currentVersion: 1 } },
    { new: true },
  ).lean();
  if (!board) throw new Error("Board not found");
  const version = board.currentVersion;

  await BoardOp.create({
    board: boardId,
    user: userId,
    kind: "snapshot",
    version,
    baseVersion: cached.lastSnapshotVersion,
    payload: snapshotPayload,
  });
  await Board.updateOne({ _id: boardId }, { $set: { lastSnapshotVersion: version } });

  cached.lastVersion = version;
  cached.lastSnapshotVersion = version;
  cached.opsSinceSnapshot = 0;

  return version;
}
