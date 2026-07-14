/**
 * Typed client API error for structured error handling.
 *
 * Mirrors the backend CollectionDomainError shape so the client can
 * distinguish transient failures from permanent ones (e.g. 404).
 */

export interface CollectionApiErrorShape {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class CollectionApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CollectionApiError";
  }

  get isNotFound(): boolean {
    return this.status === 404 && this.code === "COLLECTION_NOT_FOUND";
  }

  get isTransient(): boolean {
    return this.status >= 500 || (this.status >= 400 && !this.isNotFound);
  }
}

/**
 * Try to extract a typed error from a fetch response.
 * Returns null if the response doesn't contain a recognized error shape.
 */
export async function extractCollectionApiError(res: Response): Promise<CollectionApiError | null> {
  try {
    const body = await res.json();
    const error = body?.error as CollectionApiErrorShape | undefined;
    if (error && typeof error.code === "string" && typeof error.message === "string") {
      return new CollectionApiError(error.message, error.code, res.status, error.details);
    }
  } catch {
    // Could not parse JSON — fall through to generic message
  }
  return null;
}

/**
 * Parse a fetch-like error for display. Separates structured errors from generic ones.
 */
export function parseCollectionFetchError(err: unknown): CollectionApiError {
  if (err instanceof CollectionApiError) return err;
  const message = err instanceof Error ? err.message : "An unexpected error occurred.";
  return new CollectionApiError(message, "FETCH_ERROR", 0);
}
