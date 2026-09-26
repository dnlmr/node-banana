/**
 * The one error type the asset library throws for expected failures. Lives in
 * its own module so the internal modules can throw it without importing the
 * facade (which imports them). `index.ts` re-exports it.
 */

export type LibraryErrorCode =
  | "bad_request"
  | "not_found"
  | "unavailable"
  | "paused"
  | "busy"
  | "conflict"
  | "forbidden"
  | "gone"
  | "too_large"
  | "unsupported"
  | "hash_mismatch"
  | "timeout"
  | "blocked_url"
  | "download_failed"
  | "not_implemented"
  | (string & {});

export class LibraryError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly code: LibraryErrorCode = "bad_request",
    /** Seconds the client should wait before retrying (routes send `Retry-After`). */
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

/** Seconds a write refused while the library is being moved should wait before it is retried. */
export const PAUSED_RETRY_AFTER = 5;

/** A write refused because the library is being moved; the client retries after `Retry-After`. */
export function pausedError(message = "The library is being moved. Try again in a moment."): LibraryError {
  return new LibraryError(message, 503, "paused", PAUSED_RETRY_AFTER);
}

export function isLibraryError(error: unknown): error is LibraryError {
  return error instanceof LibraryError;
}

/** The `code` of a Node fs error, if it has one. */
export function errnoCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
