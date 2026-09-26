import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { LibraryJobStatus, LibraryStatus } from "@/lib/assets/types";
import {
  JOB_POLL_MS,
  LibrarySettingsTab,
  formatBytes,
  listProjectFolders,
  revealLabel,
} from "@/components/settings/LibrarySettingsTab";

const api = vi.hoisted(() => ({
  fetchLibraryStatus: vi.fn(),
  setLibraryRoot: vi.fn(),
  revealLibraryRoot: vi.fn(),
  startImport: vi.fn(),
  startCleanup: vi.fn(),
  fetchJob: vi.fn(),
  cancelJob: vi.fn(),
}));

vi.mock("@/lib/assets/client/api", () => api);

// Every status the page reads or is handed goes on to the recorder, which
// decides from it whether generations are recorded at all.
const recorder = vi.hoisted(() => ({ applyLibraryStatus: vi.fn() }));
vi.mock("@/lib/assets/client/recorder", () => recorder);

// The confirm step is a Dialog, which holds the store's modal count.
vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) => selector({}),
}));

const ROOT = "/Users/me/Pictures/Node Banana";
const CONFIGS_KEY = "node-banana-workflow-configs";

const makeStatus = (overrides: Partial<LibraryStatus> = {}): LibraryStatus => ({
  available: true,
  root: ROOT,
  source: "default",
  defaultRoot: ROOT,
  cacheDir: "/Users/me/Library/Caches/Node Banana",
  platform: "darwin",
  synced: null,
  counts: { assets: 12, trashed: 3, bytes: 5 * 1024 * 1024 },
  empty: false,
  job: null,
  ...overrides,
});

const makeJob = (overrides: Partial<LibraryJobStatus> = {}): LibraryJobStatus => ({
  id: "job-1",
  type: "import",
  state: "running",
  done: 0,
  total: 10,
  bytesDone: 0,
  bytesTotal: 0,
  startedAt: 1,
  ...overrides,
});

const mockFetch = vi.fn();

function mockBrowse(result: Record<string, unknown>) {
  mockFetch.mockImplementation((url: string) =>
    url === "/api/browse-directory?purpose=library"
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(result) })
      : Promise.reject(new Error(`unexpected fetch ${url}`))
  );
}

/** Render and let the status request settle. */
async function renderTab(status: LibraryStatus = makeStatus()) {
  api.fetchLibraryStatus.mockResolvedValue(status);
  const view = render(<LibrarySettingsTab />);
  await act(async () => {});
  return view;
}

async function flush() {
  await act(async () => {});
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("LibrarySettingsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("fetch", mockFetch);
    api.revealLibraryRoot.mockResolvedValue(undefined);
    api.cancelJob.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("status", () => {
    it("shows a spinner until the status arrives", () => {
      api.fetchLibraryStatus.mockReturnValue(new Promise(() => {}));
      render(<LibrarySettingsTab />);
      expect(screen.getByText("Reading the library…")).toBeInTheDocument();
    });

    it("shows the folder, where it came from and what the library holds", async () => {
      await renderTab();
      expect(screen.getByText(ROOT)).toBeInTheDocument();
      expect(screen.getByText("Default")).toBeInTheDocument();
      const stats = screen.getByLabelText("Library contents");
      expect(within(stats).getByText("12")).toBeInTheDocument();
      expect(within(stats).getByText("5 MB")).toBeInTheDocument();
      expect(within(stats).getByText("3")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show in Finder" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Change…" })).toBeEnabled();
    });

    it("labels each source", async () => {
      const { unmount } = await renderTab(makeStatus({ source: "config" }));
      expect(screen.getByText("Chosen")).toBeInTheDocument();
      unmount();

      await renderTab(makeStatus({ source: "fallback", fallbackReason: "Pictures could not be written to." }));
      expect(screen.getByText("Fallback")).toBeInTheDocument();
      expect(screen.getByRole("note")).toHaveTextContent("Pictures could not be written to.");
    });

    it("cannot change a folder set by the environment, and says why", async () => {
      await renderTab(makeStatus({ source: "env" }));
      expect(screen.getByText("Set by NODE_BANANA_ASSET_LIBRARY")).toBeInTheDocument();
      const change = screen.getByRole("button", { name: "Change…" });
      expect(change).toBeDisabled();
      expect(change).toHaveAttribute("title", "Set by the NODE_BANANA_ASSET_LIBRARY environment variable");
      expect(screen.getByText(/Unset it to choose a folder here/)).toBeInTheDocument();
    });

    it("names the file manager on Windows and reveals the folder", async () => {
      await renderTab(makeStatus({ platform: "win32", root: "C:\\Users\\me\\Pictures\\Node Banana" }));
      fireEvent.click(screen.getByRole("button", { name: "Show in Explorer" }));
      await flush();
      expect(api.revealLibraryRoot).toHaveBeenCalledTimes(1);
    });

    it("reports a failed reveal", async () => {
      api.revealLibraryRoot.mockRejectedValue(new Error("Finder is not available"));
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
      await flush();
      expect(screen.getByRole("alert")).toHaveTextContent("Finder is not available");
    });

    it("warns when the folder syncs to the cloud, with a way out", async () => {
      await renderTab(makeStatus({ synced: "onedrive" }));
      const note = screen.getByRole("note");
      expect(note).toHaveTextContent("This folder syncs to OneDrive; large videos will upload.");
      expect(within(note).getByRole("button", { name: "Change…" })).toBeEnabled();
    });

    it("explains an unavailable library and hides what cannot run", async () => {
      await renderTab(
        makeStatus({ available: false, reason: "The folder is read-only.", counts: { assets: 0, trashed: 0, bytes: 0 } })
      );
      expect(screen.getByRole("alert")).toHaveTextContent("The folder is read-only.");
      expect(screen.queryByLabelText("Library contents")).not.toBeInTheDocument();
      expect(screen.queryByText("Import generations from existing projects")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show in Finder" })).toBeDisabled();
      // A different folder may work
      expect(screen.getByRole("button", { name: "Change…" })).toBeEnabled();
    });

    it("offers a retry when the status cannot be read", async () => {
      api.fetchLibraryStatus.mockRejectedValueOnce(new Error("The asset library only answers Node Banana's own page"));
      render(<LibrarySettingsTab />);
      await flush();
      expect(screen.getByRole("alert")).toHaveTextContent("only answers Node Banana's own page");
      api.fetchLibraryStatus.mockResolvedValue(makeStatus());
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await flush();
      expect(screen.getByText(ROOT)).toBeInTheDocument();
    });
  });

  describe("changing the folder", () => {
    const NEW_ROOT = "/Volumes/Media/Node Banana";

    it("asks the library picker for a folder, then moves the library there", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      api.setLibraryRoot.mockResolvedValue(makeStatus({ job: makeJob({ id: "move-1", type: "move", total: 40 }) }));
      await renderTab();

      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      expect(mockFetch).toHaveBeenCalledWith("/api/browse-directory?purpose=library");

      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(NEW_ROOT)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: /Move my library there/ }));
      await flush();

      expect(api.setLibraryRoot).toHaveBeenCalledWith({ root: NEW_ROOT, mode: "move" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: "Moving the library" })).toBeInTheDocument();
    });

    it("reads the status again when a small move ends before the answer arrives", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      api.setLibraryRoot.mockResolvedValue(
        makeStatus({ job: makeJob({ id: "move-3", type: "move", state: "done", done: 3, total: 3, finishedAt: 2 }) })
      );
      await renderTab();
      api.fetchLibraryStatus.mockResolvedValue(makeStatus({ root: NEW_ROOT, source: "config" }));

      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Move my library there/ }));
      await flush();

      expect(screen.getByText("Moving the library")).toBeInTheDocument();
      expect(screen.getByText("Done")).toBeInTheDocument();
      expect(screen.getByText(NEW_ROOT)).toBeInTheDocument();
      expect(api.fetchJob).not.toHaveBeenCalled();
    });

    it("switches to the folder as it is and says the old library stays", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      api.setLibraryRoot.mockResolvedValue(makeStatus({ root: NEW_ROOT, source: "config" }));
      await renderTab();

      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(new RegExp(`current library stays on disk at ${ROOT}`))).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: /Use that folder/ }));
      await flush();

      expect(api.setLibraryRoot).toHaveBeenCalledWith({ root: NEW_ROOT, mode: "switch" });
      expect(screen.getByRole("status")).toHaveTextContent(
        `Now saving to ${NEW_ROOT}. Your previous library is still at ${ROOT}.`
      );
      expect(screen.getByText("Chosen")).toBeInTheDocument();
    });

    it("changes nothing when the confirm step is cancelled", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(api.setLibraryRoot).not.toHaveBeenCalled();
    });

    it("keeps the confirm step open with the server's reason when the change fails", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      api.setLibraryRoot.mockRejectedValue(new Error("That folder is inside the current library."));
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Use that folder/ }));
      await flush();
      expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent(
        "That folder is inside the current library."
      );
    });

    it("does nothing when the picker is cancelled", async () => {
      mockBrowse({ success: true, cancelled: true });
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("says so when the picked folder already is the library", async () => {
      mockBrowse({ success: true, path: `${ROOT}/` });
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("That folder is already your library.");
    });

    it("shows the picker's own error", async () => {
      mockBrowse({ success: false, error: "No folder picker on this system" });
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      expect(screen.getByRole("alert")).toHaveTextContent("No folder picker on this system");
    });
  });

  describe("keeping the recorder current", () => {
    const NEW_ROOT = "/Volumes/Media/Node Banana";

    it("hands the status it reads to the recorder", async () => {
      const status = makeStatus();
      await renderTab(status);
      expect(recorder.applyLibraryStatus).toHaveBeenCalledWith(status);
    });

    it("hands nothing over when the status cannot be read", async () => {
      api.fetchLibraryStatus.mockRejectedValue(new Error("offline"));
      render(<LibrarySettingsTab />);
      await flush();
      expect(recorder.applyLibraryStatus).not.toHaveBeenCalled();
    });

    it("turns recording back on after switching away from an unplugged drive", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      await renderTab(
        makeStatus({ available: false, source: "config", root: "/Volumes/Gone/Node Banana", reason: "The drive is not connected." })
      );
      const fixed = makeStatus({ root: NEW_ROOT, source: "config" });
      api.setLibraryRoot.mockResolvedValue(fixed);

      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Use that folder/ }));
      await flush();

      expect(recorder.applyLibraryStatus).toHaveBeenLastCalledWith(fixed);
    });

    it("hands over the answer to a move, then the status once the move ends", async () => {
      vi.useFakeTimers();
      mockBrowse({ success: true, path: NEW_ROOT });
      await renderTab();
      const moving = makeStatus({ job: makeJob({ id: "move-7", type: "move", total: 4 }) });
      api.setLibraryRoot.mockResolvedValue(moving);

      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Move my library there/ }));
      await flush();
      expect(recorder.applyLibraryStatus).toHaveBeenLastCalledWith(moving);

      const moved = makeStatus({ root: NEW_ROOT, source: "config" });
      api.fetchLibraryStatus.mockResolvedValue(moved);
      api.fetchJob.mockResolvedValueOnce(makeJob({ id: "move-7", type: "move", state: "done", done: 4, total: 4, finishedAt: 9 }));
      await advance(JOB_POLL_MS);
      expect(recorder.applyLibraryStatus).toHaveBeenLastCalledWith(moved);
    });

    it("hands over the status once an import ends", async () => {
      vi.useFakeTimers();
      const running = makeJob({ id: "import-7" });
      await renderTab(makeStatus({ job: running }));
      const imported = makeStatus({ counts: { assets: 40, trashed: 3, bytes: 1024 } });
      api.fetchLibraryStatus.mockResolvedValue(imported);
      api.fetchJob.mockResolvedValueOnce({ ...running, state: "done", done: 10, finishedAt: 3 });
      await advance(JOB_POLL_MS);
      expect(recorder.applyLibraryStatus).toHaveBeenLastCalledWith(imported);
    });
  });

  describe("importing projects", () => {
    function storeConfigs() {
      localStorage.setItem(
        CONFIGS_KEY,
        JSON.stringify({
          "wf-a": { workflowId: "wf-a", name: "Summer campaign", directoryPath: "/work/summer", generationsPath: null, lastSavedAt: 300 },
          // Same folder, older save: listed once, under the newer name
          "wf-b": { workflowId: "wf-b", name: "Summer (old)", directoryPath: "/work/summer/", generationsPath: null, lastSavedAt: 100 },
          "wf-c": { workflowId: "wf-c", name: "Product shots", directoryPath: "/work/products", generationsPath: null, lastSavedAt: 200 },
          "wf-d": { workflowId: "wf-d", name: "Nowhere", directoryPath: "", generationsPath: null, lastSavedAt: 400 },
        })
      );
    }

    it("lists each project folder once, all checked", async () => {
      storeConfigs();
      await renderTab();
      const boxes = screen.getAllByRole("checkbox");
      expect(boxes).toHaveLength(2);
      boxes.forEach((box) => expect(box).toBeChecked());
      expect(screen.getByRole("checkbox", { name: /Summer campaign/ })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /Product shots/ })).toBeInTheDocument();
      expect(screen.queryByText("Summer (old)")).not.toBeInTheDocument();
      expect(screen.getByText("/work/products")).toBeInTheDocument();
    });

    it("imports the checked folders and follows the job", async () => {
      storeConfigs();
      api.startImport.mockResolvedValue(makeJob({ id: "import-1", type: "import", total: 25 }));
      await renderTab();

      fireEvent.click(screen.getByRole("checkbox", { name: /Summer campaign/ }));
      fireEvent.click(screen.getByRole("button", { name: "Import 1" }));
      await flush();

      expect(api.startImport).toHaveBeenCalledWith({ projectDirs: ["/work/products"] });
      expect(screen.getByRole("progressbar", { name: "Importing generations" })).toBeInTheDocument();
      expect(screen.getByText("0 of 25 files")).toBeInTheDocument();
    });

    it("selects none and all again", async () => {
      storeConfigs();
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Select none" }));
      screen.getAllByRole("checkbox").forEach((box) => expect(box).not.toBeChecked());
      expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Select all" }));
      screen.getAllByRole("checkbox").forEach((box) => expect(box).toBeChecked());
    });

    it("has nothing to import without saved projects", async () => {
      await renderTab();
      expect(screen.getByText("No saved projects found.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    });

    it("survives unreadable saved configs", async () => {
      localStorage.setItem(CONFIGS_KEY, "{not json");
      await renderTab();
      expect(screen.getByText("No saved projects found.")).toBeInTheDocument();
    });
  });

  describe("clean-up", () => {
    it("cleans up unused workflow data", async () => {
      api.startCleanup.mockResolvedValue(makeJob({ id: "clean-1", type: "cleanup" }));
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Clean up" }));
      await flush();
      expect(api.startCleanup).toHaveBeenCalledWith({ unusedMedia: true });
      expect(screen.getByRole("progressbar", { name: "Cleaning up" })).toBeInTheDocument();
    });

    it("clears the thumbnail cache", async () => {
      api.startCleanup.mockResolvedValue(makeJob({ id: "clean-2", type: "cleanup", state: "done", finishedAt: 2 }));
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      await flush();
      expect(api.startCleanup).toHaveBeenCalledWith({ thumbnails: true });
      // Finished at once: no polling, but the counts are read again
      expect(api.fetchLibraryStatus).toHaveBeenCalledTimes(2);
      expect(screen.getByText("Done")).toBeInTheDocument();
    });

    it("reports a job that could not start", async () => {
      api.startCleanup.mockRejectedValue(new Error("Another job is running"));
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Clean up" }));
      await flush();
      expect(screen.getByRole("alert")).toHaveTextContent("Another job is running");
    });
  });

  describe("job progress", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("polls a running job every second, cancels it, and stops once it ends", async () => {
      const running = makeJob({ id: "import-9", done: 2, total: 10, bytesDone: 2048, bytesTotal: 10 * 1024 });
      await renderTab(makeStatus({ job: running }));

      const bar = screen.getByRole("progressbar", { name: "Importing generations" });
      expect(bar).toHaveAttribute("aria-valuenow", "2");
      expect(bar).toHaveAttribute("aria-valuemax", "10");
      expect(screen.getByText("2 of 10 files · 2 KB of 10 KB")).toBeInTheDocument();
      // Every action waits for the job
      expect(screen.getByRole("button", { name: "Change…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Clean up" })).toBeDisabled();

      api.fetchJob.mockResolvedValueOnce({ ...running, done: 6 });
      await advance(JOB_POLL_MS - 1);
      expect(api.fetchJob).not.toHaveBeenCalled();
      await advance(1);
      expect(api.fetchJob).toHaveBeenCalledWith("import-9");
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "6");

      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await flush();
      expect(api.cancelJob).toHaveBeenCalledWith("import-9");
      expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();

      api.fetchLibraryStatus.mockResolvedValue(makeStatus({ counts: { assets: 18, trashed: 3, bytes: 0 } }));
      api.fetchJob.mockResolvedValueOnce({ ...running, done: 6, state: "cancelled", finishedAt: 5 });
      await advance(JOB_POLL_MS);
      expect(screen.getByText("Cancelled")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      // The counts are read again once the job ends
      expect(screen.getByText("18")).toBeInTheDocument();

      await advance(JOB_POLL_MS * 5);
      expect(api.fetchJob).toHaveBeenCalledTimes(2);

      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByTestId("library-job")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Clean up" })).toBeEnabled();
    });

    it("shows a failed job's error", async () => {
      const running = makeJob({ id: "move-2", type: "move", total: 0 });
      await renderTab(makeStatus({ job: running }));
      // No total yet: an indeterminate bar
      expect(screen.getByRole("progressbar", { name: "Moving the library" })).not.toHaveAttribute("aria-valuenow");

      api.fetchJob.mockResolvedValueOnce({ ...running, state: "failed", error: "The disk is full." });
      // A status read in the same moment may still carry the job as running;
      // the page keeps the end it has already seen.
      await advance(JOB_POLL_MS);
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("The disk is full.");
    });

    it("keeps polling through a failed request", async () => {
      const running = makeJob({ id: "import-3" });
      await renderTab(makeStatus({ job: running }));
      api.fetchJob.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...running, done: 4 });
      await advance(JOB_POLL_MS);
      await advance(JOB_POLL_MS);
      expect(api.fetchJob).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
    });

    it("stops polling when it unmounts", async () => {
      const { unmount } = await renderTab(makeStatus({ job: makeJob({ id: "import-4" }) }));
      unmount();
      await advance(JOB_POLL_MS * 3);
      expect(api.fetchJob).not.toHaveBeenCalled();
    });
  });

  it("keeps Enter inside the page, so the settings dialog does not save and close", async () => {
    localStorage.setItem(
      CONFIGS_KEY,
      JSON.stringify({ "wf-a": { workflowId: "wf-a", name: "A", directoryPath: "/work/a", generationsPath: null, lastSavedAt: 1 } })
    );
    const onKeyDown = vi.fn();
    api.fetchLibraryStatus.mockResolvedValue(makeStatus());
    render(
      <div onKeyDown={onKeyDown}>
        <LibrarySettingsTab />
      </div>
    );
    await flush();
    fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Enter" });
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Tab" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("library settings helpers", () => {
  it("formats sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(3.2 * 1024 ** 3)).toBe("3.2 GB");
    expect(formatBytes(250 * 1024 ** 3)).toBe("250 GB");
  });

  it("names the platform's file manager", () => {
    expect(revealLabel("darwin")).toBe("Show in Finder");
    expect(revealLabel("win32")).toBe("Show in Explorer");
    expect(revealLabel("linux")).toBe("Show folder");
  });

  it("lists project folders newest first, skipping configs without a folder", () => {
    localStorage.setItem(
      CONFIGS_KEY,
      JSON.stringify({
        a: { workflowId: "a", name: "", directoryPath: "C:\\work\\alpha\\", generationsPath: null, lastSavedAt: 1 },
        b: { workflowId: "b", name: "Beta", directoryPath: "/work/beta", generationsPath: null, lastSavedAt: 2 },
        c: { workflowId: "c", name: "Gamma", directoryPath: "   ", generationsPath: null, lastSavedAt: 3 },
      })
    );
    expect(listProjectFolders()).toEqual([
      { dir: "/work/beta", name: "Beta" },
      { dir: "C:\\work\\alpha", name: "alpha" },
    ]);
    localStorage.clear();
  });
});
