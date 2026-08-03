import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AccessTokenPayload {
  sub: string;
  type: "access";
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  type: "refresh";
}

export function signAccessToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: "access" } satisfies AccessTokenPayload,
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiresIn as jwt.SignOptions["expiresIn"] },
  );
}

export function signRefreshToken(userId: string, jti: string): string {
  return jwt.sign(
    { sub: userId, type: "refresh", jti } satisfies RefreshTokenPayload,
    env.jwt.refreshSecret,
    { expiresIn: env.jwt.refreshExpiresIn as jwt.SignOptions["expiresIn"] },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const payload = jwt.verify(token, env.jwt.accessSecret) as jwt.JwtPayload;
  if (payload.type !== "access" || typeof payload.sub !== "string") {
    throw new Error("Invalid token type");
  }
  return { sub: payload.sub, type: "access" };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const payload = jwt.verify(token, env.jwt.refreshSecret) as jwt.JwtPayload;
  if (payload.type !== "refresh" || typeof payload.sub !== "string" || typeof payload.jti !== "string") {
    throw new Error("Invalid token type");
  }
  return { sub: payload.sub, type: "refresh", jti: payload.jti };
}

/** Max age of the refresh cookie, matching the refresh token expiry (seconds). */
export function refreshCookieMaxAge(): number {
  const unit = env.jwt.refreshExpiresIn.slice(-1);
  const value = Number(env.jwt.refreshExpiresIn.slice(0, -1));
  if (Number.isNaN(value)) return 30 * 24 * 60 * 60 * 1000;
  const secondsPerUnit: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return (secondsPerUnit[unit] ?? 86400) * value * 1000;
}
