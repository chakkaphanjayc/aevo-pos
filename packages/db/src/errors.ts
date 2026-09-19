export interface DatabaseErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * Raised when the API is running against a database whose migrations are not
 * complete. Returning an empty list for this case makes a broken deployment
 * look like a valid empty store, which is especially dangerous for POS data.
 */
export class DatabaseSchemaError extends Error {
  readonly code = "SCHEMA_NOT_READY";

  constructor(operation: string, cause: DatabaseErrorLike) {
    super(`Database schema is not ready for ${operation}: ${cause.message}`);
    this.name = "DatabaseSchemaError";
  }
}

export function isMissingDatabaseObject(error: DatabaseErrorLike): boolean {
  return error.code === "PGRST204"
    || error.code === "PGRST205"
    || /schema cache|could not find the table|relation .* does not exist|column .* does not exist/i.test(error.message);
}

export function throwDatabaseError(error: DatabaseErrorLike | null, operation: string): void {
  if (!error) return;
  if (isMissingDatabaseObject(error)) throw new DatabaseSchemaError(operation, error);
  throw new Error(`Supabase ${operation} failed: ${error.message}`);
}
