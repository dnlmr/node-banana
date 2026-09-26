import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { AssetFileLocation, LibraryStatus, RecordAssetResult } from "@/lib/assets/types";
import {
  FALLBACK_SHOWN_KEY,
  FIRST_RUN_SHOWN_KEY,
  LibraryNotices,
  shortLibraryPath,
} from "@/components/LibraryNotices";
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

const api = vi.hoisted(() => ({ revealLibraryRoot: vi.fn() }));
vi.mock("@/lib/assets/client/api", () => api);

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
const projectFile: AssetFileLocation = { root: "external", path: "/work/summer/generations/a_cat_0123.png" };

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
    api.revealLibraryRoot.mockResolvedValue(undefined);
  });

  it("renders nothing of its own", () => {
    const { container } = render(<LibraryNotices />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("first-run hint", () => {
    it("says where the first asset in an empty library went, once", () => {
      recorder.current = makeStatus();
      render(<LibraryNotices />);
      expect(toast().message).toBeNull();

      emitRecorded();
      expect(toast().message).toBe("Saved to Pictures › Node Banana");
      expect(toast().type).toBe("info");
      expect(toast().actions?.map((action) => action.label)).toEqual(["Show", "Change…"]);
      expect(localStorage.getItem(FIRST_RUN_SHOWN_KEY)).not.toBeNull();

      act(() => toast().hide());
      emitRecorded();
      expect(toast().message).toBeNull();
    });

    it("never shows again once shown in this browser", () => {
      localStorage.setItem(FIRST_RUN_SHOWN_KEY, "1");
      recorder.current = makeStatus();
      render(<LibraryNotices />);
      emitRecorded();
      expect(toast().message).toBeNull();
    });

    it("waits for the recorder's status", () => {
      render(<LibraryNotices />);
      emitStatus(makeStatus());
      emitRecorded();
      expect(toast().message).toBe("Saved to Pictures › Node Banana");
    });

    it("still shows when the library is reported non-empty before the asset is", () => {
      recorder.current = makeStatus();
      render(<LibraryNotices />);
      emitStatus(makeStatus({ empty: false, counts: { assets: 1, trashed: 0, bytes: 10 } }));
      emitRecorded();
      expect(toast().message).toBe("Saved to Pictures › Node Banana");
    });

    it("stays quiet for a library that already had assets", () => {
      recorder.current = makeStatus({ empty: false, counts: { assets: 40, trashed: 0, bytes: 1000 } });
      render(<LibraryNotices />);
      emitRecorded();
      expect(toast().message).toBeNull();
      expect(localStorage.getItem(FIRST_RUN_SHOWN_KEY)).toBeNull();
    });

    it("stays quiet without a status or without a working library", () => {
      render(<LibraryNotices />);
      emitRecorded();
      expect(toast().message).toBeNull();

      emitStatus(makeStatus({ available: false, reason: "Read-only" }));
      emitRecorded();
      expect(toast().message).toBeNull();
    });

    it("waits past assets saved into a project folder for one saved in the library", () => {
      recorder.current = makeStatus();
      render(<LibraryNotices />);
      emitRecorded(recorded(projectFile));
      expect(toast().message).toBeNull();
      emitRecorded(recorded(libraryFile));
      expect(toast().message).toBe("Saved to Pictures › Node Banana");
    });

    it("shows the folder from Show and opens Library settings from Change…", async () => {
      recorder.current = makeStatus();
      render(<LibraryNotices />);
      emitRecorded();
      const [show, change] = toast().actions ?? [];

      await act(async () => show?.onClick());
      expect(api.revealLibraryRoot).toHaveBeenCalledTimes(1);

      act(() => change?.onClick());
      expect(useSettingsDialogStore.getState().request?.page).toBe("library");
    });

    it("reports a folder that cannot be shown", async () => {
      api.revealLibraryRoot.mockRejectedValue(new Error("The folder is gone"));
      recorder.current = makeStatus();
      render(<LibraryNotices />);
      emitRecorded();
      await act(async () => toast().actions?.[0]?.onClick());
      expect(toast().message).toBe("The folder is gone");
      expect(toast().type).toBe("error");
    });
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
    expect(recorder.recorded.size).toBe(1);
    expect(recorder.errors.size).toBe(1);
    unmount();
    expect(recorder.status.size + recorder.recorded.size + recorder.errors.size).toBe(0);
  });
});

describe("shortLibraryPath", () => {
  it("keeps the last two folders", () => {
    expect(shortLibraryPath("/Users/me/Pictures/Node Banana")).toBe("Pictures › Node Banana");
    expect(shortLibraryPath("C:\\Users\\me\\Node Banana\\")).toBe("me › Node Banana");
    expect(shortLibraryPath("D:\\Node Banana")).toBe("D: › Node Banana");
    expect(shortLibraryPath("/Library")).toBe("Library");
  });
});
