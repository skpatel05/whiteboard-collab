import { Types } from "mongoose";
import { Workspace, WorkspaceRole } from "../models/Workspace";
import { Board } from "../models/Board";
import { ApiError } from "../utils/ApiError";

/**
 * Resolve a user's effective role in a workspace.
 * Returns null when the user has no relationship to the workspace.
 */
export async function getWorkspaceRole(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  if (!Types.ObjectId.isValid(workspaceId)) return null;

  const workspace = await Workspace.findOne(
    {
      _id: workspaceId,
      $or: [{ owner: userId }, { "members.user": userId }],
    },
    { owner: 1, members: 1 },
  ).lean();

  if (!workspace) return null;
  if (String(workspace.owner) === String(userId)) return "owner";

  const member = workspace.members.find((m) => String(m.user) === String(userId));
  return member ? member.role : null;
}

export async function requireWorkspaceRole(
  workspaceId: string,
  userId: string,
  allowed: WorkspaceRole[],
): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(workspaceId, userId);
  if (!role) {
    throw ApiError.notFound("Workspace not found");
  }
  if (!allowed.includes(role)) {
    throw ApiError.forbidden("You do not have permission to perform this action");
  }
  return role;
}

export interface BoardAccess {
  boardId: string;
  workspaceId: string;
  role: WorkspaceRole | null;
}

export async function getBoardAccess(boardId: string, userId: string): Promise<BoardAccess> {
  if (!Types.ObjectId.isValid(boardId)) {
    throw ApiError.notFound("Board not found");
  }
  const board = await Board.findById(boardId, { workspace: 1 }).lean();
  if (!board) {
    throw ApiError.notFound("Board not found");
  }
  const role = await getWorkspaceRole(String(board.workspace), userId);
  return { boardId: String(board._id), workspaceId: String(board.workspace), role };
}

export async function requireBoardAccess(
  boardId: string,
  userId: string,
  allowed: WorkspaceRole[],
): Promise<BoardAccess> {
  const access = await getBoardAccess(boardId, userId);
  if (!access.role) {
    throw ApiError.notFound("Board not found");
  }
  if (!allowed.includes(access.role)) {
    throw ApiError.forbidden("You do not have permission to perform this action");
  }
  return access;
}

export function isWriteRole(role: WorkspaceRole | null): role is "owner" | "editor" {
  return role === "owner" || role === "editor";
}
