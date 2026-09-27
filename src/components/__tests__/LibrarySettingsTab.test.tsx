import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { KnownProject, LibraryJobStatus, LibraryStatus, ProjectsOverview } from "@/lib/assets/types";
import { useBringInStore } from "@/store/bringInStore";
import {
  COUNT_POLL_MS,
  JOB_POLL_MS,
  LibrarySettingsTab,
  describeScan,
  formatBytes,
  formatFileCount,
  revealLabel,
} from "@/components/settings/LibrarySettingsTab";

const api = vi.hoisted(() => ({
  fetchLibraryStatus: vi.fn(),
  setLibraryRoot: vi.fn(),
  revealLibraryRoot: vi.fn(),
  fetchProjects: vi.fn(),
  bringInProjects: vi.fn(),
  dismissProjectsOffer: vi.fn(),
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

const makeProject = (dir: string, inRoot: boolean): KnownProject => ({
  dir,
  name: dir.split("/").pop() ?? dir,
  relativePath: inRoot ? dir.slice(ROOT.length + 1) : null,
  inRoot,
  lastModified: 1,
  mediaCount: 0,
});

const makeOverview = (overrides: Partial<ProjectsOverview> = {}): ProjectsOverview => ({
  root: ROOT,
  projects: [],
  elsewhere: null,
  offerDismissed: false,
  ...overrides,
});

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

function mockBrowse(result: Record<string, unknown>, purpose: "library" | "import" = "library") {
  mockFetch.mockImplementation((url: string) =>
    url === `/api/browse-directory?purpose=${purpose}`
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
    api.fetchProjects.mockResolvedValue(makeOverview());
    api.bringInProjects.mockResolvedValue({ root: ROOT, job: null });
    api.dismissProjectsOffer.mockResolvedValue(undefined);
    useBringInStore.setState({ request: null });
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

    it("shows the folder, where it came from and what it holds", async () => {
      api.fetchProjects.mockResolvedValue(
        makeOverview({
          projects: [makeProject(`${ROOT}/Fox`, true), makeProject(`${ROOT}/Owl`, true), makeProject("/work/Elsewhere", false)],
        })
      );
      await renderTab();
      expect(screen.getByText(ROOT)).toBeInTheDocument();
      expect(screen.getByText("Default")).toBeInTheDocument();
      expect(screen.getByText(/New projects are saved here/)).toBeInTheDocument();
      const stats = screen.getByLabelText("What the folder holds");
      // Projects in other folders are not in it
      expect(within(stats).getByText("2")).toBeInTheDocument();
      expect(within(stats).getByText("12")).toBeInTheDocument();
      expect(within(stats).getByText("5 MB")).toBeInTheDocument();
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
      expect(screen.queryByLabelText("What the folder holds")).not.toBeInTheDocument();
      expect(screen.queryByText("Bring in projects from another folder")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show in Finder" })).toBeDisabled();
      // A different folder may work
      expect(screen.getByRole("button", { name: "Change…" })).toBeEnabled();
    });

    it.each([
      ["the request guard refuses", "The asset library only answers Node Banana's own page on this computer."],
      ["the server is hosted", "The asset library needs Node Banana running on your own computer."],
    ])("cannot change the folder when %s, and says why", async (_case, reason) => {
      // No location was resolved: a picker would open on the server's screen, and the change would be refused
      await renderTab(
        makeStatus({ available: false, reason, root: null, defaultRoot: "", cacheDir: "", counts: { assets: 0, trashed: 0, bytes: 0 } })
      );
      expect(screen.getByRole("alert")).toHaveTextContent(reason);
      const change = screen.getByRole("button", { name: "Change…" });
      expect(change).toBeDisabled();
      expect(change).toHaveAttribute("title", reason);
      fireEvent.click(change);
      await flush();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("says it is still counting rather than showing provisional zeros, and reads again until the counts are in", async () => {
      vi.useFakeTimers();
      await renderTab(makeStatus({ counting: true, counts: { assets: 0, trashed: 0, bytes: 0 } }));

      const stats = screen.getByLabelText("What the folder holds");
      // Projects are counted apart from the assets
      expect(within(stats).getAllByText("Counting…")).toHaveLength(2);
      expect(within(stats).queryByText("0 B")).not.toBeInTheDocument();
      expect(api.fetchLibraryStatus).toHaveBeenCalledTimes(1);

      await advance(COUNT_POLL_MS);
      expect(api.fetchLibraryStatus).toHaveBeenCalledTimes(2);
      expect(within(screen.getByLabelText("What the folder holds")).getAllByText("Counting…")).toHaveLength(2);

      api.fetchLibraryStatus.mockResolvedValue(makeStatus());
      await advance(COUNT_POLL_MS);
      expect(api.fetchLibraryStatus).toHaveBeenCalledTimes(3);
      const counted = screen.getByLabelText("What the folder holds");
      expect(within(counted).queryByText("Counting…")).not.toBeInTheDocument();
      expect(within(counted).getByText("12")).toBeInTheDocument();

      await advance(COUNT_POLL_MS * 3);
      expect(api.fetchLibraryStatus).toHaveBeenCalledTimes(3);
    });

    it("stops reading again once it unmounts", async () => {
      vi.useFakeTimers();
      const { unmount } = await renderTab(makeStatus({ counting: true, counts: { assets: 0, trashed: 0, bytes: 0 } }));
      unmount();
      await advance(COUNT_POLL_MS * 3);
      expect(api.fetchLibraryStatus).toHaveBeenCalledTimes(1);
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
      fireEvent.click(within(dialog).getByRole("button", { name: /Move everything there/ }));
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
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Move everything there/ }));
      await flush();

      expect(screen.getByText("Moving the library")).toBeInTheDocument();
      expect(screen.getByText("Done")).toBeInTheDocument();
      expect(screen.getByText(NEW_ROOT)).toBeInTheDocument();
      expect(api.fetchJob).not.toHaveBeenCalled();
    });

    it("switches to the folder as it is and says the old one stays", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      api.setLibraryRoot.mockResolvedValue(makeStatus({ root: NEW_ROOT, source: "config" }));
      await renderTab();

      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      const dialog = screen.getByRole("dialog");
      expect(
        within(dialog).getByText(
          "New projects and generations are saved there from now on. ~/Pictures/Node Banana stays as it is, and its projects stay in Open and Assets."
        )
      ).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: /Use that folder/ }));
      await flush();

      expect(api.setLibraryRoot).toHaveBeenCalledWith({ root: NEW_ROOT, mode: "switch" });
      expect(screen.getByRole("status")).toHaveTextContent(
        `Now saving to ${NEW_ROOT}. ${ROOT} stays as it is.`
      );
      expect(screen.getByText("Chosen")).toBeInTheDocument();
    });

    it("offers only a switch for a library that is not available, and says why", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      await renderTab(
        makeStatus({
          available: false,
          source: "config",
          root: "/Volumes/Gone/Node Banana",
          reason: "The drive is not connected.",
          counts: { assets: 0, trashed: 0, bytes: 0 },
        })
      );
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();

      const dialog = screen.getByRole("dialog");
      const move = within(dialog).getByRole("button", { name: /Move everything there/ });
      expect(move).toBeDisabled();
      expect(move).toHaveTextContent("The current folder isn't available, so there is nothing to move.");
      expect(within(dialog).getByRole("button", { name: /Use that folder/ })).toBeEnabled();
    });

    it("names the projects that move along, or only the unsaved generations", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      api.fetchProjects.mockResolvedValue(
        makeOverview({ projects: [makeProject(`${ROOT}/Fox`, true), makeProject(`${ROOT}/Owl`, true)], rootBytes: 3.3 * 1024 ** 3 })
      );
      const { unmount } = await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: /Move everything there/ })).toHaveTextContent(
        "Moves the 2 projects in your folder (3.3 GB) and your unsaved generations, checks every file, then removes the originals. Projects in other folders stay where they are."
      );
      unmount();

      api.fetchProjects.mockResolvedValue(makeOverview());
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      expect(within(screen.getByRole("dialog")).getByRole("button", { name: /Move everything there/ })).toHaveTextContent(
        "Moves your unsaved generations, checks every file"
      );
    });

    it("hands the folder's projects to the move, keeping them listed meanwhile", async () => {
      vi.useFakeTimers();
      mockBrowse({ success: true, path: NEW_ROOT });
      const inRoot = [`${ROOT}/Fox`, `${ROOT}/Owl`];
      api.fetchProjects.mockResolvedValue(makeOverview({ projects: inRoot.map((dir) => makeProject(dir, true)) }));
      api.setLibraryRoot.mockResolvedValue(makeStatus({ job: makeJob({ id: "move-5", type: "move", total: 4 }) }));
      await renderTab();

      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Move everything there/ }));
      await flush();
      expect(api.bringInProjects).toHaveBeenCalledWith({ dirs: inRoot, mode: "leave" });
      // The server moves them after the library, in the same job: nothing here has to stay open for it
      expect(api.setLibraryRoot).toHaveBeenCalledWith({ root: NEW_ROOT, mode: "move", projects: inRoot });

      api.fetchJob.mockResolvedValueOnce(makeJob({ id: "move-5", type: "move", state: "done", done: 4, total: 4, finishedAt: 9 }));
      await advance(JOB_POLL_MS);
      expect(api.bringInProjects).toHaveBeenCalledTimes(1);
    });

    it("keeps the folder's projects listed where they are when switching", async () => {
      mockBrowse({ success: true, path: NEW_ROOT });
      api.fetchProjects.mockResolvedValue(makeOverview({ projects: [makeProject(`${ROOT}/Fox`, true)] }));
      api.setLibraryRoot.mockResolvedValue(makeStatus({ root: NEW_ROOT, source: "config" }));
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Change…" }));
      await flush();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Use that folder/ }));
      await flush();
      expect(api.bringInProjects).toHaveBeenCalledWith({ dirs: [`${ROOT}/Fox`], mode: "leave" });
      expect(api.setLibraryRoot).toHaveBeenCalledWith({ root: NEW_ROOT, mode: "switch" });
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
      expect(screen.getByRole("status")).toHaveTextContent("That folder is already your Node Banana folder.");
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
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Move everything there/ }));
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

  describe("projects in other folders", () => {
    const outside = ["/Users/me/test-files/test workflows/A", "/Users/me/pet-hype"];
    const elsewhere = {
      count: 2,
      dirs: outside,
      bytes: 3.3 * 1000 ** 3,
      groups: [
        { label: "~/test-files/test workflows", count: 1 },
        { label: "~/pet-hype", count: 1 },
      ],
    };
    const withElsewhere = (overrides: Partial<ProjectsOverview> = {}) =>
      makeOverview({
        projects: [makeProject(`${ROOT}/Fox`, true), ...outside.map((dir) => makeProject(dir, false))],
        elsewhere,
        ...overrides,
      });

    it("offers to move them in, saying where they are", async () => {
      api.fetchProjects.mockResolvedValue(withElsewhere());
      await renderTab();
      const offer = screen.getByRole("region", { name: "Projects in other folders" });
      expect(offer).toHaveTextContent("2 projects live in other folders");
      expect(offer).toHaveTextContent(
        "test-files › test workflows (1) and pet-hype (1), 3.3 GB. Move them into your Node Banana folder to keep everything in one place."
      );
    });

    it("moves them in and follows the move", async () => {
      api.fetchProjects.mockResolvedValue(withElsewhere());
      api.bringInProjects.mockResolvedValue({ root: ROOT, job: makeJob({ id: "projects-2", type: "projects", total: 860 }) });
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Move them in" }));
      await flush();
      expect(api.bringInProjects).toHaveBeenCalledWith({ dirs: outside, mode: "move" });
      expect(screen.getByRole("progressbar", { name: "Moving 2 projects" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Projects in other folders" })).not.toBeInTheDocument();
    });

    it("keeps them where they are, and does not offer again", async () => {
      api.fetchProjects.mockResolvedValue(withElsewhere());
      await renderTab();
      fireEvent.click(screen.getByRole("button", { name: "Keep where they are" }));
      await flush();
      expect(api.dismissProjectsOffer).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("region", { name: "Projects in other folders" })).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("They stay where they are. You can bring them in later from below.");
    });

    it("makes no offer once it was declined, or with nothing elsewhere", async () => {
      api.fetchProjects.mockResolvedValue(withElsewhere({ offerDismissed: true }));
      const { unmount } = await renderTab();
      expect(screen.queryByRole("region", { name: "Projects in other folders" })).not.toBeInTheDocument();
      unmount();

      api.fetchProjects.mockResolvedValue(makeOverview());
      await renderTab();
      expect(screen.queryByRole("region", { name: "Projects in other folders" })).not.toBeInTheDocument();
    });
  });

  describe("bringing projects in", () => {
    it("opens the Bring-in view and leaves the settings", async () => {
      const onLeave = vi.fn();
      api.fetchLibraryStatus.mockResolvedValue(makeStatus());
      render(<LibrarySettingsTab onLeave={onLeave} />);
      await flush();
      fireEvent.click(screen.getByRole("button", { name: "Choose folder…" }));
      expect(useBringInStore.getState().request).not.toBeNull();
      expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it("waits for a running job", async () => {
      await renderTab(makeStatus({ job: makeJob({ id: "import-8" }) }));
      expect(screen.getByRole("button", { name: "Choose folder…" })).toBeDisabled();
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
    const onKeyDown = vi.fn();
    api.fetchLibraryStatus.mockResolvedValue(makeStatus());
    render(
      <div onKeyDown={onKeyDown}>
        <LibrarySettingsTab />
      </div>
    );
    await flush();
    const button = screen.getByRole("button", { name: "Clean up" });
    fireEvent.keyDown(button, { key: "Enter" });
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: "Tab" });
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

  it("describes a search and counts files", () => {
    const result = { root: "/w", projects: [{ dir: "/w/a", name: "A", mediaCount: 1 }], truncated: false, unreadable: 1 };
    expect(describeScan(result)).toBe("Found 1 project in /w. 1 folder couldn't be read.");
    expect(describeScan({ ...result, projects: [], unreadable: 0, truncated: true })).toBe(
      "No Node Banana projects in /w. The search stopped early; pick a smaller folder to see the rest."
    );
    expect(formatFileCount(1)).toBe("1 file");
    expect(formatFileCount(2500)).toBe("2,500 files");
    expect(formatFileCount(10_000)).toBe("10,000+ files");
  });
});
