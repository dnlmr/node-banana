import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryStatus } from "@/lib/assets/types";

const recorder = vi.hoisted(() => ({ listeners: [] as (() => void)[] }));
vi.mock("@/lib/assets/client/recorder", () => ({
  onAssetRecorded: (listener: () => void) => {
    recorder.listeners.push(listener);
    return () => {
      recorder.listeners = recorder.listeners.filter((l) => l !== listener);
    };
  },
}));
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: sonner }));

import { FIRST_RUN_KEY, watchFirstRecording } from "../FirstRunHint";

const status = (overrides: Partial<LibraryStatus> = {}): LibraryStatus => ({
  available: true,
  root: "/Users/me/Pictures/Node Banana",
  source: "default",
  defaultRoot: "/Users/me/Pictures/Node Banana",
  cacheDir: "/c",
  platform: "darwin",
  synced: null,
  counts: { assets: 0, trashed: 0, bytes: 0 },
  empty: true,
  job: null,
  ...overrides,
});

const record = () => [...recorder.listeners].forEach((listener) => listener());

describe("first-run hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorder.listeners = [];
    window.localStorage.removeItem(FIRST_RUN_KEY);
  });

  it("says once, after the first asset of an empty library, where it went", () => {
    watchFirstRecording(status());
    expect(sonner.custom).not.toHaveBeenCalled();
    record();
    expect(sonner.custom).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(FIRST_RUN_KEY)).toBe("1");
    record();
    expect(sonner.custom).toHaveBeenCalledTimes(1);

    // Not on the next start either
    watchFirstRecording(status());
    record();
    expect(sonner.custom).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for a library that already has assets, or none at all", () => {
    watchFirstRecording(status({ empty: false }));
    watchFirstRecording(status({ available: false }));
    watchFirstRecording(null);
    record();
    expect(sonner.custom).not.toHaveBeenCalled();
  });
});
