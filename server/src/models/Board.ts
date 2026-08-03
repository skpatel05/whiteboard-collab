import mongoose, { InferSchemaType, Schema } from "mongoose";

const boardSchema = new Schema(
  {
    workspace: { type: Schema.Types.ObjectId, ref: "Workspace", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, default: "", maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    starredBy: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    lastOpenedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    lastOpenedAt: { type: Date, default: null },
    // Ops-log vs snapshot: the Board keeps a pointer to the latest persisted
    // snapshot; incremental ops with higher versions replay on top of it.
    currentVersion: { type: Number, default: 0, min: 0 },
    lastSnapshotVersion: { type: Number, default: 0, min: 0 },
    // Public view-only share link
    shareToken: {
      token: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },
  },
  {
    timestamps: true,
  },
);

boardSchema.index({ workspace: 1, title: 1 });
boardSchema.index({ workspace: 1, lastOpenedAt: -1 });
boardSchema.index({ starredBy: 1 });
boardSchema.index({ "shareToken.token": 1 }, { sparse: true });

export type BoardDoc = InferSchemaType<typeof boardSchema>;

export const Board = mongoose.model("Board", boardSchema);
