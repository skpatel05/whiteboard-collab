export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code = "ERROR", details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, "BAD_REQUEST", details);
  }

  static unauthorized(message = "Unauthorized"): ApiError {
    return new ApiError(401, message, "UNAUTHORIZED");
  }

  static forbidden(message = "Forbidden"): ApiError {
    return new ApiError(403, message, "FORBIDDEN");
  }

  static notFound(message = "Resource not found"): ApiError {
    return new ApiError(404, message, "NOT_FOUND");
  }

  static conflict(message: string): ApiError {
    return new ApiError(409, message, "CONFLICT");
  }
}
