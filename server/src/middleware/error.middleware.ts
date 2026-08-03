import { NextFunction, Request, Response } from "express";
import { ApiError } from "../utils/ApiError";
import { sendError } from "../utils/response";

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound("Route not found"));
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  sendError(res, err);
}
