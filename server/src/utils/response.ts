import { Response } from "express";
import { logger } from "../lib/logger";

export interface ApiResponseBody<T> {
  success: true;
  data: T;
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  const body: ApiResponseBody<T> = { success: true, data };
  res.status(status).json(body);
}

export function sendError(res: Response, err: unknown): void {
  const status = (err as { statusCode?: number })?.statusCode ?? 500;
  const message =
    status === 500 ? "Internal server error" : (err as Error)?.message ?? "Unknown error";
  const code = (err as { code?: string })?.code ?? "INTERNAL_ERROR";

  if (status >= 500) {
    logger.error("Unhandled error", { message: (err as Error)?.message, stack: (err as Error)?.stack });
  }

  res.status(status).json({
    success: false,
    error: { code, message, details: (err as { details?: unknown })?.details },
  });
}
