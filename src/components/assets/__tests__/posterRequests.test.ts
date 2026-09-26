import { beforeEach, describe, expect, it, vi } from "vitest";

const poster = vi.hoisted(() => ({
  ensurePoster: vi.fn(),
  /** Finishes the capture of that id. */
  finish: new Map<string, (stored: boolean) => void>(),
}));
vi.mock("@/lib/assets/client/poster", () => ({ ensurePoster: poster.ensurePoster }));

import { MAX_ACTIVE_POSTERS, __resetPosterRequestsForTests, requestPoster } from "../posterRequests";

const video = (id: string) => ({ id, kind: "video" as const, mime: "video/mp4", hasPoster: false });
const handed = () => poster.ensurePoster.mock.calls.map(([asset]) => (asset as { id: string }).id);
/** Ends that capture and lets the queue move on. */
const settle = async (id: string) => {
  poster.finish.get(id)!(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  vi.clearAllMocks();
  poster.finish.clear();
  __resetPosterRequestsForTests();
  poster.ensurePoster.mockImplementation(
    (asset: { id: string }) => new Promise<boolean>((resolve) => poster.finish.set(asset.id, resolve)),
  );
});

describe("poster requests", () => {
  it("hands on only a few at a time, in the order the tiles came into view", async () => {
    for (let i = 0; i < 10; i++) requestPoster(video(`v${i}`));
    expect(handed()).toEqual(Array.from({ length: MAX_ACTIVE_POSTERS }, (_, i) => `v${i}`));

    await settle("v0");
    expect(handed()).toHaveLength(MAX_ACTIVE_POSTERS + 1);
    expect(handed()[MAX_ACTIVE_POSTERS]).toBe(`v${MAX_ACTIVE_POSTERS}`);
  });

  it("drops a tile that left the screen before its turn, and asks again if it comes back", async () => {
    const leave = Array.from({ length: MAX_ACTIVE_POSTERS + 2 }, (_, i) => requestPoster(video(`v${i}`)));
    // The first one waiting scrolls away
    leave[MAX_ACTIVE_POSTERS]!();
    await settle("v0");
    expect(handed()).toHaveLength(MAX_ACTIVE_POSTERS + 1);
    expect(handed()).not.toContain(`v${MAX_ACTIVE_POSTERS}`);
    expect(handed()).toContain(`v${MAX_ACTIVE_POSTERS + 1}`);

    requestPoster(video(`v${MAX_ACTIVE_POSTERS}`));
    await settle("v1");
    expect(handed()).toContain(`v${MAX_ACTIVE_POSTERS}`);
  });

  it("gives a turn up while its capture waits to try again, once", async () => {
    const retryWait = new Map<string, () => void>();
    poster.ensurePoster.mockImplementation((asset: { id: string }, options?: { onRetryWait?: () => void }) => {
      if (options?.onRetryWait) retryWait.set(asset.id, options.onRetryWait);
      return new Promise<boolean>((resolve) => poster.finish.set(asset.id, resolve));
    });
    for (let i = 0; i < 10; i++) requestPoster(video(`v${i}`));
    expect(handed()).toHaveLength(MAX_ACTIVE_POSTERS);

    // v0 could not be decoded and waits 5 s before trying again: the next tile goes meanwhile
    retryWait.get("v0")?.();
    expect(handed()).toHaveLength(MAX_ACTIVE_POSTERS + 1);
    expect(handed()[MAX_ACTIVE_POSTERS]).toBe(`v${MAX_ACTIVE_POSTERS}`);

    // Its next wait, and its end, give up nothing more
    retryWait.get("v0")?.();
    await settle("v0");
    expect(handed()).toHaveLength(MAX_ACTIVE_POSTERS + 1);

    // A capture that ends hands its turn on as before
    await settle("v1");
    expect(handed()).toHaveLength(MAX_ACTIVE_POSTERS + 2);
  });

  it("asks once per video, and withdrawing one already handed on changes nothing", async () => {
    const leave = requestPoster(video("v0"));
    requestPoster(video("v0"));
    leave();
    await settle("v0");
    requestPoster(video("v0"));
    expect(handed()).toEqual(["v0"]);
  });
});
