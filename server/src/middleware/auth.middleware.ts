import { Request } from "express";
import { Types } from "mongoose";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../services/token.service";
import { redis } from "../lib/redis";
import { User } from "../models/User";

export const REFRESH_COOKIE = "wb_refresh";
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AuthUser {
  id: string;
  name: string;
  email: string;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthUser;
}

function refreshKey(jti: string): string {
  return `refresh:${jti}`;
}

export async function storeRefreshToken(jti: string, userId: string): Promise<void> {
  await redis.set(refreshKey(jti), userId, "EX", REFRESH_TOKEN_TTL_SECONDS);
}

export async function revokeRefreshToken(jti: string): Promise<void> {
  await redis.del(refreshKey(jti));
}

export async function isRefreshTokenValid(jti: string): Promise<boolean> {
  const exists = await redis.exists(refreshKey(jti));
  return exists === 1;
}

export async function getRefreshTokenUser(jti: string): Promise<string | null> {
  return redis.get(refreshKey(jti));
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export function requireAuth(req: Request, _res: unknown, next: (err?: unknown) => void): void {
  const token = extractBearerToken(req);
  if (!token) {
    next(ApiError.unauthorized("Missing access token"));
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    if (!Types.ObjectId.isValid(payload.sub)) {
      next(ApiError.unauthorized("Invalid token subject"));
      return;
    }
    // Load the user so downstream handlers always have a fresh, verified record.
    void User.findById(payload.sub, { name: 1, email: 1, emailVerifiedAt: 1 })
      .lean()
      .then((user) => {
        if (!user) {
          next(ApiError.unauthorized("User no longer exists"));
          return;
        }
        (req as AuthenticatedRequest).auth = {
          id: String(user._id),
          name: user.name,
          email: user.email,
        };
        next();
      })
      .catch((err) => next(err));
  } catch {
    next(ApiError.unauthorized("Invalid or expired access token"));
  }
}
