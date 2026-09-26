import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { AssetFileLocation, LibraryStatus, RecordAssetResult } from "@/lib/assets/types";
import { FALLBACK_SHOWN_KEY, LibraryNotices } from "@/components/LibraryNotices";
import { useToast } from "@/components/Toast";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";

const recorder = vi.hoisted(() => ({
  current: null as LibraryStatus | null,
  status: new Set<(status: LibraryStatus) => void>(),
  recorded: new Set<(result: RecordAssetResult) => void>(),
  errors: new Set<(message: string) => void>(),
}));

vi.mock("@/lib/assets/client/recorder", () => ({
  getRecorderLibraryStatus: () => recorder.current,
  onLibraryStatus: (listener: (status: LibraryStatus) => void) => {
    recorder.status.add(listener);
    return () => recorder.status.delete(listener);
  },
  onAssetRecorded: (listener: (result: RecordAssetResult) => void) => {
    recorder.recorded.add(listener);
    return () => recorder.recorded.delete(listener);
  },
  onRecorderError: (listener: (message: string) => void) => {
    recorder.errors.add(listener);
    return () => recorder.errors.delete(listener);
  },
}));

/** The first-run hint's key, owned by FirstRunHint. */
const FIRST_RUN_KEY = "node-banana-assets-first-run-shown";
const ROOT = "/Users/me/Pictures/Node Banana";

const makeStatus = (overrides: Partial<LibraryStatus> = {}): LibraryStatus => ({
  available: true,
  root: ROOT,
  source: "default",
  defaultRoot: ROOT,
  cacheDir: "/Users/me/Library/Caches/Node Banana",
  platform: "darwin",
  synced: null,
  counts: { assets: 0, trashed: 0, bytes: 0 },
  empty: true,
  job: null,
  ...overrides,
});

const libraryFile: AssetFileLocation = { root: "library", rel: "Generations/2026-09-27/143200_a_cat_0123abcd.png" };

const recorded = (file: AssetFileLocation = libraryFile) =>
  ({ asset: { file }, filename: "a.png", legacyId: "a", reusedFile: false }) as unknown as RecordAssetResult;

function emitStatus(status: LibraryStatus) {
  act(() => recorder.status.forEach((listener) => listener(status)));
}

function emitRecorded(result: RecordAssetResult = recorded()) {
  act(() => recorder.recorded.forEach((listener) => listener(result)));
}

function emitError(message: string) {
  act(() => recorder.errors.forEach((listener) => listener(message)));
}

const toast = () => useToast.getState();

describe("LibraryNotices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recorder.current = null;
    recorder.status.clear();
    recorder.recorded.clear();
    recorder.errors.clear();
    localStorage.clear();
    sessionStorage.clear();
    act(() => {
      useToast.getState().hide();
      useSettingsDialogStore.setState({ request: null });
    });
  });

  it("renders nothing of its own", () => {
    const { container } = render(<LibraryNotices />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves the first-run hint to FirstRunHint, and its key unclaimed", () => {
    recorder.current = makeStatus();
    render(<LibraryNotices />);
    emitRecorded();
    emitStatus(makeStatus({ empty: false, counts: { assets: 1, trashed: 0, bytes: 10 } }));
    emitRecorded();
    expect(toast().message).toBeNull();
    expect(localStorage.getItem(FIRST_RUN_KEY)).toBeNull();
    expect(recorder.recorded.size).toBe(0);
  });

  it("shows the recorder's failures as error toasts", () => {
    render(<LibraryNotices />);
    emitError("Could not save a generation to the library.");
    expect(toast().message).toBe("Could not save a generation to the library.");
    expect(toast().type).toBe("error");
  });

  describe("fallback folder", () => {
    const fallback = makeStatus({
      source: "fallback",
      root: "/Users/me/Node Banana",
      empty: false,
      fallbackReason: "Pictures could not be written to, so generations are saved in your home folder.",
    });

    it("warns once per session, with a way to change the folder", () => {
      recorder.current = fallback;
      render(<LibraryNotices />);
      expect(toast().message).toBe(fallback.fallbackReason);
      expect(toast().type).toBe("warning");
      expect(sessionStorage.getItem(FALLBACK_SHOWN_KEY)).not.toBeNull();

      act(() => toast().actions?.[0]?.onClick());
      expect(useSettingsDialogStore.getState().request?.page).toBe("library");

      act(() => toast().hide());
      emitStatus(fallback);
      expect(toast().message).toBeNull();
    });

    it("stays quiet when this session already saw it", () => {
      sessionStorage.setItem(FALLBACK_SHOWN_KEY, "1");
      render(<LibraryNotices />);
      emitStatus(fallback);
      expect(toast().message).toBeNull();
    });
  });

  it("stops listening when it unmounts", () => {
    const { unmount } = render(<LibraryNotices />);
    expect(recorder.status.size).toBe(1);
    expect(recorder.errors.size).toBe(1);
    unmount();
    expect(recorder.status.size + recorder.recorded.size + recorder.errors.size).toBe(0);
  });
});
