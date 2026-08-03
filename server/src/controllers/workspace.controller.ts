import { Request, Response } from "express";
import crypto from "crypto";
import { Workspace } from "../models/Workspace";
import { Invitation } from "../models/Invitation";
import { User } from "../models/User";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/response";
import { requireWorkspaceRole } from "../services/access.service";
import { AuthenticatedRequest } from "../middleware/auth.middleware";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function serializeWorkspace(ws: Record<string, unknown>, userId: string) {
  const role = String(ws.owner) === userId ? "owner" : "member";
  return {
    id: String(ws._id),
    name: ws.name,
    description: ws.description,
    owner: String(ws.owner),
    myRole: role,
    memberCount: Array.isArray(ws.members) ? ws.members.length + 1 : 1,
    createdAt: ws.createdAt,
  };
}

export async function createWorkspace(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { name, description } = req.body ?? {};
  if (!name || typeof name !== "string") {
    throw ApiError.badRequest("Workspace name is required");
  }
  const workspace = await Workspace.create({
    name,
    description: description ?? "",
    owner: req.auth!.id,
    members: [],
  });
  sendSuccess(res, { workspace: serializeWorkspace(workspace.toObject(), req.auth!.id) }, 201);
}

export async function listWorkspaces(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.auth!.id;
  const workspaces = await Workspace.find({
    $or: [{ owner: userId }, { "members.user": userId }],
  })
    .sort({ createdAt: -1 })
    .lean();

  sendSuccess(res, {
    workspaces: workspaces.map((ws) => serializeWorkspace(ws as unknown as Record<string, unknown>, userId)),
  });
}

export async function getWorkspace(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.auth!.id;
  const { workspaceId } = req.params;
  await requireWorkspaceRole(workspaceId, userId, ["owner", "editor", "viewer"]);

  const workspace = await Workspace.findById(workspaceId)
    .populate("owner", "name email avatarColor")
    .populate("members.user", "name email avatarColor")
    .lean();
  if (!workspace) throw ApiError.notFound("Workspace not found");

  const memberCount = workspace.members.length + 1;
  sendSuccess(res, {
    workspace: {
      id: String(workspace._id),
      name: workspace.name,
      description: workspace.description,
      owner: workspace.owner,
      members: workspace.members.map((m) => ({
        user: m.user,
        role: m.role,
      })),
      memberCount,
      createdAt: workspace.createdAt,
    },
  });
}

export async function updateWorkspace(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId } = req.params;
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner"]);

  const { name, description } = req.body ?? {};
  const workspace = await Workspace.findByIdAndUpdate(
    workspaceId,
    {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
    },
    { new: true },
  ).lean();
  if (!workspace) throw ApiError.notFound("Workspace not found");

  sendSuccess(res, { workspace: serializeWorkspace(workspace as unknown as Record<string, unknown>, req.auth!.id) });
}

export async function deleteWorkspace(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId } = req.params;
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner"]);
  await Workspace.deleteOne({ _id: workspaceId });
  sendSuccess(res, { message: "Workspace deleted" });
}

export async function addMember(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId } = req.params;
  const { userId, role } = req.body ?? {};
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner"]);

  if (!userId) throw ApiError.badRequest("userId is required");
  if (!["editor", "viewer"].includes(role)) throw ApiError.badRequest("role must be editor or viewer");

  const target = await User.findById(userId, { _id: 1 }).lean();
  if (!target) throw ApiError.notFound("User not found");

  const workspace = await Workspace.findById(workspaceId).lean();
  if (!workspace) throw ApiError.notFound("Workspace not found");
  if (String(workspace.owner) === String(userId)) throw ApiError.badRequest("User is already the owner");
  if (workspace.members.some((m) => String(m.user) === String(userId))) {
    throw ApiError.conflict("User is already a member");
  }

  await Workspace.updateOne({ _id: workspaceId }, { $push: { members: { user: userId, role } } });
  sendSuccess(res, { message: "Member added" }, 201);
}

export async function updateMemberRole(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId, userId } = req.params;
  const { role } = req.body ?? {};
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner"]);

  if (!["editor", "viewer"].includes(role)) throw ApiError.badRequest("role must be editor or viewer");

  const updated = await Workspace.findOneAndUpdate(
    { _id: workspaceId, "members.user": userId },
    { $set: { "members.$.role": role } },
    { new: true },
  ).lean();
  if (!updated) throw ApiError.notFound("Member not found");

  sendSuccess(res, { message: "Member role updated" });
}

export async function removeMember(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId, userId } = req.params;
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner"]);

  const updated = await Workspace.findOneAndUpdate(
    { _id: workspaceId, "members.user": userId },
    { $pull: { members: { user: userId } } },
    { new: true },
  ).lean();
  if (!updated) throw ApiError.notFound("Member not found");

  sendSuccess(res, { message: "Member removed" });
}

export async function inviteByEmail(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId } = req.params;
  const { email, role } = req.body ?? {};
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner"]);

  if (!email || typeof email !== "string") throw ApiError.badRequest("email is required");
  if (!["editor", "viewer"].includes(role)) throw ApiError.badRequest("role must be editor or viewer");

  const invitation = await Invitation.create({
    workspace: workspaceId,
    email: email.toLowerCase(),
    role,
    invitedBy: req.auth!.id,
    token: crypto.randomBytes(24).toString("hex"),
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  });

  sendSuccess(
    res,
    {
      invitation: {
        id: String(invitation._id),
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
    },
    201,
  );
}

export async function listInvitations(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId } = req.params;
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner"]);

  const invitations = await Invitation.find({ workspace: workspaceId })
    .sort({ createdAt: -1 })
    .lean();
  sendSuccess(res, { invitations });
}

export async function revokeInvitation(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { workspaceId, invitationId } = req.params;
  await requireWorkspaceRole(workspaceId, req.auth!.id, ["owner"]);

  const updated = await Invitation.findOneAndUpdate(
    { _id: invitationId, workspace: workspaceId },
    { $set: { status: "revoked" } },
    { new: true },
  ).lean();
  if (!updated) throw ApiError.notFound("Invitation not found");

  sendSuccess(res, { message: "Invitation revoked" });
}

export async function acceptInvitation(req: Request, res: Response): Promise<void> {
  const { token } = req.params;
  const userId = (req as AuthenticatedRequest).auth!.id;
  const auth = (req as AuthenticatedRequest).auth!;

  const invitation = await Invitation.findOne({ token }).lean();
  if (!invitation || invitation.status !== "pending") {
    throw ApiError.badRequest("Invitation is invalid or no longer active");
  }
  if (invitation.expiresAt < new Date()) {
    throw ApiError.badRequest("Invitation has expired");
  }
  if (invitation.email.toLowerCase() !== auth.email.toLowerCase()) {
    throw ApiError.forbidden("This invitation was issued for a different email");
  }

  const workspace = await Workspace.findById(invitation.workspace).lean();
  if (!workspace) throw ApiError.notFound("Workspace not found");
  if (String(workspace.owner) === userId) {
    throw ApiError.badRequest("You already own this workspace");
  }
  if (workspace.members.some((m) => String(m.user) === String(userId))) {
    throw ApiError.conflict("You are already a member of this workspace");
  }

  await Workspace.updateOne(
    { _id: invitation.workspace },
    { $push: { members: { user: userId, role: invitation.role } } },
  );
  await Invitation.updateOne(
    { _id: invitation._id },
    { $set: { status: "accepted", acceptedBy: userId, acceptedAt: new Date() } },
  );

  sendSuccess(res, { message: "Invitation accepted", workspaceId: String(workspace._id) });
}
