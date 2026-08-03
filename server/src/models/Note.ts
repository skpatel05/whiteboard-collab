import mongoose, { InferSchemaType, Schema } from "mongoose";

export const NOTE_KINDS = ["sticky", "minutes"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

const noteSchema = new Schema(
  {
    board: { type: Schema.Types.ObjectId, ref: "Board", required: true, index: true },
    kind: { type: String, enum: NOTE_KINDS, required: true, default: "sticky" },
    author: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Canvas placement (used by sticky notes)
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
    width: { type: Number, default: 220 },
    height: { type: Number, default: 200 },
    color: { type: String, default: "#fef08a" },
    content: { type: String, default: "", maxlength: 20000 },
  },
  {
    timestamps: true,
  },
);

noteSchema.index({ board: 1, updatedAt: -1 });

export type NoteDoc = InferSchemaType<typeof noteSchema>;

export const Note = mongoose.model("Note", noteSchema);
