import mongoose, { InferSchemaType, Schema } from "mongoose";

export const BOARD_OP_KINDS = ["op", "snapshot"] as const;
export type BoardOpKind = (typeof BOARD_OP_KINDS)[number];

/**
 * Operation log for a board. Contains both:
 *  - `op`:       an incremental update (e.g. a Yjs update) applied by a user
 *  - `snapshot`: the full serialized document state at a point in time
 *
 * Loading a board = fetch the newest snapshot + every op with a higher
 * version and apply them in order. This keeps board load O(snapshot) for the
 * common case instead of replaying the entire history.
 */
const boardOpSchema = new Schema(
  {
    board: { type: Schema.Types.ObjectId, ref: "Board", required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: BOARD_OP_KINDS, required: true },
    version: { type: Number, required: true, min: 1 },
    // Binary payload: Yjs update (kind=op) or full Yjs document state (kind=snapshot).
    payload: { type: Buffer, required: true },
    baseVersion: { type: Number, default: 0 },
    clientId: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  },
);

// Compound index enables efficient snapshot + replay queries per board.
boardOpSchema.index({ board: 1, version: 1 }, { unique: true });
boardOpSchema.index({ board: 1, kind: 1, version: -1 });

export type BoardOpDoc = InferSchemaType<typeof boardOpSchema>;

export const BoardOp = mongoose.model("BoardOp", boardOpSchema);
