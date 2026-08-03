import mongoose, { InferSchemaType, Schema } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    emailVerifiedAt: { type: Date, default: null },
    verificationTokenHash: { type: String, select: false },
    verificationTokenExpiresAt: { type: Date, select: false },
    avatarColor: { type: String, default: "#6366f1" },
  },
  {
    timestamps: true,
  },
);

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User = mongoose.model("User", userSchema);
