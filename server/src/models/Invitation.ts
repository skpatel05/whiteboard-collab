import mongoose, { InferSchemaType, Schema } from "mongoose";

const INVITATION_STATUSES = ["pending", "accepted", "revoked"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

const invitationSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: { type: String, enum: ["editor", "viewer"], required: true, default: "viewer" },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true, unique: true },
    status: { type: String, enum: INVITATION_STATUSES, required: true, default: "pending" },
    expiresAt: { type: Date, required: true },
    acceptedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    acceptedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
);

invitationSchema.index({ workspace: 1, status: 1 });

export type InvitationDoc = InferSchemaType<typeof invitationSchema>;

export const Invitation = mongoose.model("Invitation", invitationSchema);
