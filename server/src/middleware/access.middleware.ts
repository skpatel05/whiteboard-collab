import { NextFunction, Response } from "express";
import { WorkspaceRole } from "../models/Workspace";
import { AuthenticatedRequest } from "./auth.middleware";
import { getBoardAccess, requireWorkspaceRole } from "../services/access.service";
import { ApiError } from "../utils/ApiError";

/** Require the authenticated user to hold at least one of the given workspace roles. */
export function requireWorkspace(...allowed: WorkspaceRole[]) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth!.id;
      const workspaceId = req.params.workspaceId;
      await requireWorkspaceRole(workspaceId, userId, allowed);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Resolve the board's workspace role for the user and stash it on the request. */
export function resolveBoardAccess(
  ...allowed: WorkspaceRole[]
): (req: AuthenticatedRequest, _res: Response, next: NextFunction) => Promise<void> {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth!.id;
      const boardId = req.params.boardId;
      const access = await getBoardAccess(boardId, userId);
      if (!access.role) {
        next(ApiError.notFound("Board not found"));
        return;
      }
      if (!allowed.includes(access.role)) {
        next(ApiError.forbidden("You do not have permission to perform this action"));
        return;
      }
      (req as AuthenticatedRequest & { boardRole?: WorkspaceRole }).boardRole = access.role;
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Augment the request type for downstream handlers.
declare module "express-serve-static-core" {
  interface Request {
    boardRole?: WorkspaceRole;
  }
}
