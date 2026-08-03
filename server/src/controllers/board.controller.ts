import { Request, Response } from "express";
import crypto from "crypto";
import { Board } from "../models/Board";
import { BoardOp } from "../models/BoardOp";
import { Note } from "../models/Note";
import { User } from "../models/User";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/response";
import {
  requireBoardAccess,
  requireWorkspaceRole,
} from "../services/access.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { Workspace } from "../models/Workspace";

function serializeBoard(board: Record<string, unknown>, userId: string) {
  const starred = Array.isArray(board.starredBy)
    ? board.starredBy.some((id) => String(id) === String(userId))
    : false;
  return {
    id: String(board._id),
    title: board.title,
    description: board.description,
    workspace: String(board.workspace),
    createdBy: String(board.createdBy),
    starred,
    lastOpenedAt: board.lastOpenedAt ?? null,
    currentVersion: board.currentVersion ?? 0,
    shareLink: board.shareToken ? { token: (board.shareToken as { token: string }).token } : null,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

export async function createBoard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId, title, description } = req.body ?? {};
  if (!workspaceId || !title) {
    throw ApiError.badRequest("workspaceId and title are required");
  }
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner", "editor"]);

  const board = await Board.create({
    workspace: workspaceId,
    title,
    description: description ?? "",
    createdBy: req.auth!.id,
  });
  sendSuccess(res, { board: serializeBoard(board.toObject(), req.auth!.id) }, 201);
}

export async function listBoards(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.auth!.id;
  const workspaceId = req.query.workspace as string | undefined;
  const search = (req.query.search as string | undefined)?.trim();
  const starredOnly = req.query.starred === "true";

  let filter: Record<string, unknown> = {};

  if (workspaceId) {
    await requireWorkspaceRole(workspaceId, userId, ["owner", "editor", "viewer"]);
    filter.workspace = workspaceId;
  } else {
    // Boards across all workspaces the user belongs to.
    const workspaces = await Workspace.find(
      { $or: [{ owner: userId }, { "members.user": userId }] },
      { _id: 1 },
    ).lean();
    filter.workspace = { $in: workspaces.map((w) => w._id) };
  }

  if (search) {
    const ownerMatch = await User.find({ name: { $regex: search, $options: "i" } }, { _id: 1 }).lean();
    const ownerIds = ownerMatch.map((u) => u._id);
    filter.$or = [
      { title: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { createdBy: { $in: ownerIds } },
    ];
  }
  if (starredOnly) {
    filter.starredBy = userId;
  }

  const sort = (req.query.sort as string) ?? "recent";
  const sortMap: Record<string, Record<string, 1 | -1>> = {
    recent: { lastOpenedAt: -1, updatedAt: -1 },
    title: { title: 1 },
    created: { createdAt: -1 },
  };

  const boards = await Board.find(filter).sort(sortMap[sort] ?? sortMap.recent).limit(200).lean();
  sendSuccess(res, {
    boards: boards.map((b) => serializeBoard(b as unknown as Record<string, unknown>, userId)),
  });
}

export async function getBoard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  const access = await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor", "viewer"]);

  const board = await Board.findById(boardId).lean();
  if (!board) throw ApiError.notFound("Board not found");

  const [notes, lastSnapshot, ops] = await Promise.all([
    Note.find({ board: boardId }).sort({ createdAt: 1 }).lean(),
    BoardOp.findOne({ board: boardId, kind: "snapshot" })
      .sort({ version: -1 })
      .lean(),
    BoardOp.find({
      board: boardId,
      kind: "op",
      version: { $gt: board.lastSnapshotVersion ?? 0 },
    })
      .sort({ version: 1 })
      .lean(),
  ]);

  sendSuccess(res, {
    board: {
      ...serializeBoard(board as unknown as Record<string, unknown>, req.auth!.id),
      myRole: access.role,
    },
    notes,
    document: {
      snapshotVersion: lastSnapshot?.version ?? 0,
      snapshot: lastSnapshot ? lastSnapshot.payload.toString("base64") : null,
      ops: ops.map((op) => ({
        version: op.version,
        baseVersion: op.baseVersion,
        clientId: op.clientId,
        user: String(op.user),
        payload: op.payload.toString("base64"),
      })),
    },
  });
}

export async function updateBoard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor"]);

  const { title, description } = req.body ?? {};
  const board = await Board.findByIdAndUpdate(
    boardId,
    {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    },
    { new: true },
  ).lean();
  if (!board) throw ApiError.notFound("Board not found");

  sendSuccess(res, { board: serializeBoard(board as unknown as Record<string, unknown>, req.auth!.id) });
}

export async function deleteBoard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor"]);
  await Promise.all([
    Board.deleteOne({ _id: boardId }),
    BoardOp.deleteMany({ board: boardId }),
    Note.deleteMany({ board: boardId }),
  ]);
  sendSuccess(res, { message: "Board deleted" });
}

export async function starBoard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor", "viewer"]);
  await Board.updateOne({ _id: boardId }, { $addToSet: { starredBy: req.auth!.id } });
  sendSuccess(res, { starred: true });
}

export async function unstarBoard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor", "viewer"]);
  await Board.updateOne({ _id: boardId }, { $pull: { starredBy: req.auth!.id } });
  sendSuccess(res, { starred: false });
}

export async function touchBoard(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor", "viewer"]);
  await Board.updateOne(
    { _id: boardId },
    { $set: { lastOpenedBy: req.auth!.id, lastOpenedAt: new Date() } },
  );
  sendSuccess(res, { message: "Board touched" });
}

export async function createShareLink(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor"]);

  const expiresInDays = Number(req.body?.expiresInDays ?? 7);
  const token = crypto.randomBytes(24).toString("hex");
  const board = await Board.findByIdAndUpdate(
    boardId,
    {
      $set: {
        "shareToken.token": token,
        "shareToken.expiresAt": new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
      },
    },
    { new: true },
  ).lean();
  if (!board) throw ApiError.notFound("Board not found");

  sendSuccess(res, { token, expiresAt: board.shareToken?.expiresAt }, 201);
}

export async function revokeShareLink(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor"]);
  await Board.updateOne({ _id: boardId }, { $set: { "shareToken.token": null, "shareToken.expiresAt": null } });
  sendSuccess(res, { message: "Share link revoked" });
}

export async function listVersions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor", "viewer"]);

  const snapshots = await BoardOp.find({ board: boardId, kind: "snapshot" })
    .sort({ version: -1 })
    .limit(50)
    .select("version user createdAt baseVersion")
    .lean();

  sendSuccess(res, { versions: snapshots });
}

export async function restoreVersion(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { boardId } = req.params;
  await requireBoardAccess(boardId, req.auth!.id, ["owner", "editor"]);

  const version = Number(req.params.version);
  const snapshot = await BoardOp.findOne({
    board: boardId,
    kind: "snapshot",
    version: { $lte: version },
  })
    .sort({ version: -1 })
    .lean();
  if (!snapshot) throw ApiError.notFound("No snapshot found at or before this version");

  const board = await Board.findById(boardId).lean();
  if (!board) throw ApiError.notFound("Board not found");

  // Write a new snapshot that becomes the latest state, so restore is a new
  // version in history rather than a destructive mutation.
  const newVersion = board.currentVersion + 1;
  await BoardOp.create({
    board: boardId,
    user: req.auth!.id,
    kind: "snapshot",
    version: newVersion,
    baseVersion: snapshot.version,
    payload: snapshot.payload,
  });
  await Board.updateOne(
    { _id: boardId },
    { $set: { currentVersion: newVersion, lastSnapshotVersion: newVersion } },
  );

  sendSuccess(res, { message: "Board restored", version: newVersion });
}

/** View-only access via a public share token (no user auth required). */
export async function getPublicBoard(req: Request, res: Response): Promise<void> {
  const { token } = req.params;
  const board = await Board.findOne({ "shareToken.token": token }).lean();
  if (!board || !board.shareToken?.expiresAt || board.shareToken.expiresAt < new Date()) {
    throw ApiError.notFound("Share link is invalid or has expired");
  }

  const [notes, lastSnapshot, ops] = await Promise.all([
    Note.find({ board: board._id }).sort({ createdAt: 1 }).lean(),
    BoardOp.findOne({ board: board._id, kind: "snapshot" }).sort({ version: -1 }).lean(),
    BoardOp.find({
      board: board._id,
      kind: "op",
      version: { $gt: board.lastSnapshotVersion ?? 0 },
    })
      .sort({ version: 1 })
      .lean(),
  ]);

  sendSuccess(res, {
    board: {
      id: String(board._id),
      title: board.title,
      description: board.description,
      currentVersion: board.currentVersion,
    },
    notes,
    document: {
      snapshotVersion: lastSnapshot?.version ?? 0,
      snapshot: lastSnapshot ? lastSnapshot.payload.toString("base64") : null,
      ops: ops.map((op) => ({
        version: op.version,
        baseVersion: op.baseVersion,
        clientId: op.clientId,
        payload: op.payload.toString("base64"),
      })),
    },
  });
}
