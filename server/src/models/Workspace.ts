import mongoose, { InferSchemaType, Schema } from "mongoose";

export const WORKSPACE_ROLES = ["owner", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export interface WorkspaceMember {
  user: mongoose.Types.ObjectId;
  role: Exclude<WorkspaceRole, "owner">;
}

const memberSchema = new Schema<WorkspaceMember>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["editor", "viewer"], required: true, default: "viewer" },
  },
  { _id: false },
);

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", maxlength: 500 },
    owner: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    members: { type: [memberSchema], default: [] },
  },
  {
    timestamps: true,
  },
);

workspaceSchema.index({ "members.user": 1 });
workspaceSchema.index({ owner: 1, createdAt: -1 });

export type WorkspaceDoc = InferSchemaType<typeof workspaceSchema>;

export const Workspace = mongoose.model("Workspace", workspaceSchema);
