import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetFileLocation, LibraryStatus, RecordAssetResult } from "@/lib/assets/types";

const recorder = vi.hoisted(() => ({
  listeners: [] as ((result: RecordAssetResult) => void)[],
  status: null as LibraryStatus | null,
}));
vi.mock("@/lib/assets/client/recorder", () => ({
  onAssetRecorded: (listener: (result: RecordAssetResult) => void) => {
    recorder.listeners.push(listener);
    return () => {
      recorder.listeners = recorder.listeners.filter((l) => l !== listener);
    };
  },
  getRecorderLibraryStatus: () => recorder.status,
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

const inLibrary: AssetFileLocation = { root: "library", rel: "Generations/2026-09-27/a.png" };
const inProject: AssetFileLocation = { root: "external", path: "/Users/me/Cats/generations/a_1234.png" };

const record = (file: AssetFileLocation = inLibrary) =>
  [...recorder.listeners].forEach((listener) =>
    listener({ asset: { file } as RecordAssetResult["asset"], filename: "a.png", legacyId: "a", reusedFile: false }),
  );

/** What the card rendered by the last toast.custom call says. */
function shownRoot(): string {
  const render = sonner.custom.mock.calls.at(-1)![0] as () => { props: { root: string } };
  return render().props.root;
}

describe("first-run hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorder.listeners = [];
    recorder.status = null;
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

  it("waits past a generation saved into a project folder, which is not in the library, for one that is", () => {
    watchFirstRecording(status());
    record(inProject);
    expect(sonner.custom).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(FIRST_RUN_KEY)).toBeNull();

    record(inLibrary);
    expect(sonner.custom).toHaveBeenCalledTimes(1);
    expect(shownRoot()).toBe("/Users/me/Pictures/Node Banana");
  });

  it("names the library where it is now, if it was switched after the page loaded", () => {
    watchFirstRecording(status());
    recorder.status = status({ root: "/Volumes/Work/Node Banana", empty: false });
    record();
    expect(shownRoot()).toBe("/Volumes/Work/Node Banana");
  });

  it("still shows once per page when web storage is blocked", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      watchFirstRecording(status());
      record();
      expect(sonner.custom).toHaveBeenCalledTimes(1);
      watchFirstRecording(status());
      record();
      expect(sonner.custom).toHaveBeenCalledTimes(1);
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
