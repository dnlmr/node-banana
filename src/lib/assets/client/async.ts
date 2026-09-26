/**
 * Small async helpers for the asset client: bounded parallel maps, and
 * retries that back off exponentially and honour the server's Retry-After.
 */

import { AssetApiError } from "./api";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Worth another try: the request never got an answer, or the server said it
 * is busy (503 while a library move holds recording, 429) or a gateway blinked.
 * Any other 4xx is a refusal that retrying will not change.
 */
export function isTransient(error: unknown): boolean {
  if (!(error instanceof AssetApiError)) return false;
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504;
}

export interface RetryOptions {
  /** Attempts in all, the first included. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * A 503 that names a Retry-After means "paused, come back later" (a library
   * move). Those waits draw on this budget instead of the attempt count, so a
   * long move does not drop the recordings made during it.
   */
  pausedBudgetMs?: number;
  /** Called with the error before each wait. */
  onRetry?: (error: unknown, attempt: number) => void;
}

export async function withRetry<T>(task: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 5, baseDelayMs = 1000, maxDelayMs = 30_000, pausedBudgetMs = 10 * 60 * 1000 } = options;
  let attempt = 0;
  let pausedFor = 0;
  for (;;) {
    attempt += 1;
    try {
      return await task(attempt);
    } catch (error) {
      if (!isTransient(error)) throw error;
      const retryAfter = error instanceof AssetApiError ? error.retryAfterMs : undefined;
      const paused = error instanceof AssetApiError && error.status === 503 && retryAfter !== undefined;
      if (paused) {
        const wait = Math.max(retryAfter, 250);
        if (pausedFor + wait > pausedBudgetMs) throw error;
        pausedFor += wait;
        attempt -= 1;
        options.onRetry?.(error, attempt);
        await delay(wait);
        continue;
      }
      if (attempt >= attempts) throw error;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      options.onRetry?.(error, attempt);
      await delay(retryAfter ?? backoff * (0.75 + Math.random() * 0.5));
    }
  }
}
