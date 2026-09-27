import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactElement } from "react";
import type { AssetFileLocation, LibraryStatus, RecordAssetResult } from "@/lib/assets/types";
import {
  FALLBACK_SHOWN_KEY,
  LibraryNotices,
  NOTICE_DURATION_MS,
  NOTICE_WITH_ACTION_DURATION_MS,
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

// Notices are sonner cards, stacked with the generation cards
const sonner = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: sonner }));

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

/** Renders the card of the nth sonner notice (the latest by default) and returns its options. */
function showCard(index = sonner.custom.mock.calls.length - 1) {
  const [renderCard, options] = sonner.custom.mock.calls[index] as [(id: string) => ReactElement, { id: string; duration: number }];
  render(renderCard(options.id));
  return options;
}

describe("LibraryNotices", () => {
  beforeEach(() => {
    cleanup();
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
    expect(sonner.custom).not.toHaveBeenCalled();
    expect(localStorage.getItem(FIRST_RUN_KEY)).toBeNull();
    expect(recorder.recorded.size).toBe(0);
  });

  describe("recorder failures", () => {
    it("show as an error card", () => {
      render(<LibraryNotices />);
      emitError("Couldn't save an asset to the library: The drive is not connected.");

      expect(sonner.custom).toHaveBeenCalledTimes(1);
      const options = showCard();
      expect(options.duration).toBe(NOTICE_DURATION_MS);
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save an asset to the library: The drive is not connected.");
      expect(screen.queryByRole("button", { name: "Change…" })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(sonner.dismiss).toHaveBeenCalledWith(options.id);
    });

    it("leave a persistent failure toast where it is", () => {
      render(<LibraryNotices />);
      act(() => useToast.getState().show("Generation failed", "error", true, "400: the prompt was refused"));

      emitError("Couldn't save an asset to the library: The library is paused.");

      expect(toast().message).toBe("Generation failed");
      expect(toast().persistent).toBe(true);
      expect(toast().details).toBe("400: the prompt was refused");
      expect(sonner.custom).toHaveBeenCalledTimes(1);
    });

    it("replace the same failure's card rather than stacking it", () => {
      render(<LibraryNotices />);
      emitError("Couldn't save an asset to the library: offline");
      emitError("Couldn't save an asset to the library: offline");
      emitError("Couldn't save an asset to the library: disk full");
      const ids = sonner.custom.mock.calls.map(([, options]) => (options as { id: string }).id);
      expect(ids[0]).toBe(ids[1]);
      expect(ids[2]).not.toBe(ids[0]);
    });
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
      expect(sonner.custom).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem(FALLBACK_SHOWN_KEY)).not.toBeNull();

      const options = showCard();
      expect(options.duration).toBe(NOTICE_WITH_ACTION_DURATION_MS);
      expect(screen.getByRole("status")).toHaveTextContent(fallback.fallbackReason!);

      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      expect(useSettingsDialogStore.getState().request?.page).toBe("library");
      expect(sonner.dismiss).toHaveBeenCalledWith(options.id);

      emitStatus(fallback);
      expect(sonner.custom).toHaveBeenCalledTimes(1);
    });

    it("does not replace a persistent failure toast", () => {
      render(<LibraryNotices />);
      act(() => useToast.getState().show("Generation failed", "error", true));
      emitStatus(fallback);
      expect(toast().message).toBe("Generation failed");
      expect(sonner.custom).toHaveBeenCalledTimes(1);
    });

    it("stays quiet when this session already saw it", () => {
      sessionStorage.setItem(FALLBACK_SHOWN_KEY, "1");
      render(<LibraryNotices />);
      emitStatus(fallback);
      expect(sonner.custom).not.toHaveBeenCalled();
    });

    it("stays quiet for a library that is not available", () => {
      render(<LibraryNotices />);
      emitStatus({ ...fallback, available: false, reason: "Read-only" });
      expect(sonner.custom).not.toHaveBeenCalled();
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
