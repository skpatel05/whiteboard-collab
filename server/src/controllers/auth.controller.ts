import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { User } from "../models/User";
import { ApiError } from "../utils/ApiError";
import { sendSuccess } from "../utils/response";
import { refreshCookieMaxAge, signAccessToken, signRefreshToken, verifyRefreshToken } from "../services/token.service";
import { sendMail, verificationEmailHtml } from "../services/email.service";
import {
  AuthenticatedRequest,
  REFRESH_COOKIE,
  getRefreshTokenUser,
  isRefreshTokenValid,
  revokeRefreshToken,
  storeRefreshToken,
} from "../middleware/auth.middleware";
import { env } from "../config/env";

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    maxAge: refreshCookieMaxAge(),
    path: "/api/auth",
  });
}

interface PublicUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  avatarColor: string;
}

function toPublicUser(user: {
  _id: unknown;
  name: string;
  email: string;
  emailVerifiedAt: Date | null;
  avatarColor: string;
}): PublicUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    avatarColor: user.avatarColor,
  };
}

export async function register(req: Request, res: Response): Promise<void> {
  const { name, email, password } = req.body ?? {};

  if (!name || !email || !password) {
    throw ApiError.badRequest("name, email and password are required");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw ApiError.badRequest("Password must be at least 8 characters");
  }
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.badRequest("A valid email is required");
  }

  const existing = await User.findOne({ email: email.toLowerCase() }).select("_id").lean();
  if (existing) {
    throw ApiError.conflict("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const verificationToken = crypto.randomBytes(32).toString("hex");
  const verificationTokenHash = crypto.createHash("sha256").update(verificationToken).digest("hex");

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    passwordHash,
    verificationTokenHash,
    verificationTokenExpiresAt: new Date(Date.now() + VERIFICATION_TTL_MS),
  });

  const verifyLink = `${env.clientOrigin}/verify-email?token=${verificationToken}`;
  await sendMail(user.email, "Verify your email", verificationEmailHtml(verifyLink));

  sendSuccess(res, { user: toPublicUser(user as unknown as Parameters<typeof toPublicUser>[0]) }, 201);
}

export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const token = (req.query.token as string) ?? (req.body?.token as string);
  if (!token) {
    throw ApiError.badRequest("Verification token is required");
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({ verificationTokenHash: tokenHash })
    .select("+verificationTokenHash +verificationTokenExpiresAt emailVerifiedAt")
    .lean();

  if (!user || !user.verificationTokenExpiresAt || user.verificationTokenExpiresAt < new Date()) {
    throw ApiError.badRequest("Verification token is invalid or has expired");
  }

  await User.updateOne(
    { _id: user._id },
    {
      $set: { emailVerifiedAt: new Date() },
      $unset: { verificationTokenHash: 1, verificationTokenExpiresAt: 1 },
    },
  );

  sendSuccess(res, { message: "Email verified" });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    throw ApiError.badRequest("email and password are required");
  }

  const user = await User.findOne({ email: String(email).toLowerCase() })
    .select("+passwordHash name email emailVerifiedAt avatarColor")
    .lean();

  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!user || !ok) {
    throw ApiError.unauthorized("Invalid email or password");
  }

  const accessToken = signAccessToken(String(user._id));
  const jti = crypto.randomUUID();
  const refreshToken = signRefreshToken(String(user._id), jti);
  await storeRefreshToken(jti, String(user._id));
  setRefreshCookie(res, refreshToken);

  sendSuccess(res, {
    accessToken,
    user: toPublicUser(user as unknown as Parameters<typeof toPublicUser>[0]),
  });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (!token) {
    throw ApiError.unauthorized("Missing refresh token");
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  if (!(await isRefreshTokenValid(payload.jti))) {
    throw ApiError.unauthorized("Refresh token has been revoked");
  }

  const storedUserId = await getRefreshTokenUser(payload.jti);
  if (!storedUserId || storedUserId !== payload.sub) {
    throw ApiError.unauthorized("Refresh token mismatch");
  }

  const user = await User.findById(payload.sub, { name: 1, email: 1, emailVerifiedAt: 1, avatarColor: 1 }).lean();
  if (!user) {
    throw ApiError.unauthorized("User no longer exists");
  }

  // Rotate the refresh token (revoke old, issue new).
  await revokeRefreshToken(payload.jti);
  const newJti = crypto.randomUUID();
  const newRefreshToken = signRefreshToken(payload.sub, newJti);
  await storeRefreshToken(newJti, payload.sub);
  setRefreshCookie(res, newRefreshToken);

  sendSuccess(res, {
    accessToken: signAccessToken(payload.sub),
    user: toPublicUser(user as unknown as Parameters<typeof toPublicUser>[0]),
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (token) {
    try {
      const payload = verifyRefreshToken(token);
      await revokeRefreshToken(payload.jti);
    } catch {
      // Already invalid — nothing to revoke.
    }
  }
  res.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
  sendSuccess(res, { message: "Logged out" });
}

export async function me(req: AuthenticatedRequest, res: Response): Promise<void> {
  const user = await User.findById(req.auth!.id, { name: 1, email: 1, emailVerifiedAt: 1, avatarColor: 1 }).lean();
  if (!user) {
    throw ApiError.unauthorized("User no longer exists");
  }
  sendSuccess(res, {
    user: toPublicUser(user as unknown as Parameters<typeof toPublicUser>[0]),
  });
}
