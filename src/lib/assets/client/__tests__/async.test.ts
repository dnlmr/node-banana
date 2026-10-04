import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetApiError } from "../api";
import { withRetry } from "../async";

afterEach(() => {
  vi.useRealTimers();
});

const paused = () => new AssetApiError("The library is being moved.", 503, 5_000, "paused");

describe("withRetry", () => {
  it("gives up when the paused budget runs out, without keepWaiting", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {
      throw paused();
    });
    const result = withRetry(task, { pausedBudgetMs: 20_000 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toMatchObject({ status: 503 });
    expect(task).toHaveBeenCalledTimes(5);
  });

  it("starts a new paused budget each time keepWaiting says so", async () => {
    vi.useFakeTimers();
    let refusals = 12;
    const task = vi.fn(async () => {
      if (refusals-- > 0) throw paused();
      return "stored";
    });
    const keepWaiting = vi.fn(async () => true);
    const result = withRetry(task, { pausedBudgetMs: 20_000, keepWaiting });
    await vi.advanceTimersByTimeAsync(70_000);
    await expect(result).resolves.toBe("stored");
    expect(keepWaiting).toHaveBeenCalledTimes(2);
  });

  it("gives up when keepWaiting says no", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {
      throw paused();
    });
    const result = withRetry(task, { pausedBudgetMs: 20_000, keepWaiting: async () => false }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(result).resolves.toMatchObject({ code: "paused" });
    expect(task).toHaveBeenCalledTimes(5);
  });

  it("says so before each paused wait, and not for other failures", async () => {
    vi.useFakeTimers();
    const failures = [paused(), new AssetApiError("Bad gateway", 502), paused()];
    const task = vi.fn(async () => {
      const failure = failures.shift();
      if (failure) throw failure;
      return "stored";
    });
    const onPaused = vi.fn();
    const result = withRetry(task, { onPaused });
    await vi.advanceTimersByTimeAsync(0);
    expect(onPaused).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(result).resolves.toBe("stored");
    expect(onPaused).toHaveBeenCalledTimes(2);
  });
});
