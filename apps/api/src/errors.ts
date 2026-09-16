export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) { super(message); this.name = "AppError"; }
}

export const unauthorized = () => new AppError(401, "UNAUTHORIZED", "Authentication is required");
export const forbidden = () => new AppError(403, "FORBIDDEN", "You do not have permission to perform this action");
