import { Router } from "express";
import * as workspace from "../controllers/workspace.controller";
import { asyncHandler } from "../utils/asyncHandler";
import { requireAuth } from "../middleware/auth.middleware";
import { requireWorkspace } from "../middleware/access.middleware";

const router = Router();

router.use(requireAuth);

router.post("/", asyncHandler(workspace.createWorkspace));
router.get("/", asyncHandler(workspace.listWorkspaces));
router.get("/:workspaceId", asyncHandler(workspace.getWorkspace));
router.patch("/:workspaceId", requireWorkspace("owner"), asyncHandler(workspace.updateWorkspace));
router.delete("/:workspaceId", requireWorkspace("owner"), asyncHandler(workspace.deleteWorkspace));

router.post("/:workspaceId/members", requireWorkspace("owner"), asyncHandler(workspace.addMember));
router.patch("/:workspaceId/members/:userId", requireWorkspace("owner"), asyncHandler(workspace.updateMemberRole));
router.delete("/:workspaceId/members/:userId", requireWorkspace("owner"), asyncHandler(workspace.removeMember));

router.post("/:workspaceId/invitations", requireWorkspace("owner"), asyncHandler(workspace.inviteByEmail));
router.get("/:workspaceId/invitations", requireWorkspace("owner"), asyncHandler(workspace.listInvitations));
router.delete(
  "/:workspaceId/invitations/:invitationId",
  requireWorkspace("owner"),
  asyncHandler(workspace.revokeInvitation),
);

export default router;
