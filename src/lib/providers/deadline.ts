/**
 * A per-fetch deadline: aborts the in-flight requests and rejects the work
 * once it passes, so one slow provider cannot hang a listing.
 */

export interface Deadline {
  /** Aborts the provider's in-flight requests when the deadline passes. */
  signal: AbortSignal;
  /** Settles like `work`, or rejects with the timeout error once the deadline passes. */
  race<T>(work: Promise<T>): Promise<T>;
  clear(): void;
}

export function startDeadline(ms: number): Deadline {
  const controller = new AbortController();
  const error = new Error(`timed out after ${ms / 1000}s`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(error);
      reject(error);
    }, ms);
  });
  // Nobody may be racing when it fires; don't surface that as unhandled.
  expired.catch(() => {});
  return {
    signal: controller.signal,
    race: (work) => Promise.race([work, expired]),
    clear: () => clearTimeout(timer),
  };
}
