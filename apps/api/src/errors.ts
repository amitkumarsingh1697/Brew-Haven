export type ErrorCode =
  | "NOT_FOUND"
  | "VALIDATION"
  | "UNAVAILABLE"
  | "CONFLICT"
  | "INVALID_TRANSITION"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "PAYMENT"
  | "RATE_LIMITED"
  | "PLAN_LIMIT";

const STATUS: Record<ErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  UNAVAILABLE: 409,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  PAYMENT: 402,
  RATE_LIMITED: 429,
  /** The business's plan doesn't allow it (one more café, one more team member). */
  PLAN_LIMIT: 403,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError("NOT_FOUND", `${what} not found`);
