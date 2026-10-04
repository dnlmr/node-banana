import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BringInView } from "@/components/quickstart/BringInView";
import type { LibraryJobStatus, ScanProjectsResult } from "@/lib/assets/types";

const api = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  scanProjects: vi.fn(),
  bringInProjects: vi.fn(),
  fetchJob: vi.fn(),
  cancelJob: vi.fn(),
}));
vi.mock("@/lib/assets/client/api", () => api);

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ROOT = "/Users/ada/Documents/Node Banana";
const FOLDER = "/Users/ada/Documents/projects/workflows";

function scan(patch: Partial<ScanProjectsResult> = {}): ScanProjectsResult {
  return {
    root: FOLDER,
    projects: [
      { dir: `${FOLDER}/cars`, name: "Cars", mediaCount: 238, bytes: 2_000_000_000 },
      { dir: `${FOLDER}/blank`, name: "blank", mediaCount: 1, bytes: 1_000_000 },
    ],
    truncated: false,
    unreadable: 0,
    recommendUse: true,
    ...patch,
  };
}

function job(patch: Partial<LibraryJobStatus> = {}): LibraryJobStatus {
  return { id: "job-1", type: "projects", state: "running", done: 912, total: 3822, bytesDone: 500, bytesTotal: 2000, startedAt: 0, ...patch };
}

function pickerAnswers(path: string | null) {
  mockFetch.mockResolvedValue({ json: () => Promise.resolve(path ? { success: true, path } : { success: true, cancelled: true }) });
}

function renderView(props: Partial<Parameters<typeof BringInView>[0]> = {}) {
  const handlers = { onBack: vi.fn(), onClose: vi.fn(), onDone: vi.fn(), ...props };
  render(<BringInView {...handlers} />);
  return handlers;
}

describe("BringInView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchProjects.mockResolvedValue({ root: ROOT, projects: [], elsewhere: null, offerDismissed: false });
    api.scanProjects.mockResolvedValue(scan());
    api.bringInProjects.mockResolvedValue({ root: ROOT, job: null });
    api.cancelJob.mockResolvedValue(undefined);
    pickerAnswers(FOLDER);
  });

  it("opens the import picker at once and goes back when it is cancelled", async () => {
    pickerAnswers(null);
    const { onBack } = renderView();

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith("/api/browse-directory?purpose=import");
    expect(api.scanProjects).not.toHaveBeenCalled();
  });

  it("lists a Node Banana folder's projects and recommends using it", async () => {
    renderView();

    expect(await screen.findByText("What should happen to them?")).toBeInTheDocument();
    expect(screen.getByText("You can change this later in Settings › Storage.")).toBeInTheDocument();
    expect(screen.getByText("2 projects · 2 GB")).toBeInTheDocument();
    expect(screen.getByText("~/Documents/projects/workflows")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Projects found" })).toHaveTextContent("Cars238 assets");

    const use = screen.getByRole("radio", { name: /Make this my Node Banana folder/ });
    expect(use).toHaveAttribute("aria-checked", "true");
    expect(use).toHaveTextContent("Recommended");
    expect(use).toHaveTextContent("go to workflows › Generations.");
    expect(screen.getByRole("radio", { name: /Move them into Documents › Node Banana/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use this folder" })).toBeInTheDocument();
  });

  it("shows where the projects sit, and recommends moving them, when the folder holds more than projects", async () => {
    api.scanProjects.mockResolvedValue(
      scan({
        root: "/Users/ada/Documents/projects",
        recommendUse: false,
        projects: [
          { dir: "/Users/ada/Documents/projects/workflows/a", name: "a", mediaCount: 1 },
          { dir: "/Users/ada/Documents/projects/workflows/b", name: "b", mediaCount: 1 },
          { dir: "/Users/ada/Documents/projects/pet-hype", name: "pet-hype", mediaCount: 1 },
        ],
      })
    );
    renderView();

    const list = await screen.findByRole("list", { name: "Folders with projects" });
    expect(list).toHaveTextContent("workflows2 projects");
    expect(list).toHaveTextContent("pet-hype1 project");
    const move = screen.getByRole("radio", { name: /Move them into/ });
    expect(move).toHaveAttribute("aria-checked", "true");
    expect(move).toHaveTextContent("Moves only the 3 project folders, keeping their subfolders. Nothing else in projects moves.");
    expect(screen.getByRole("button", { name: "Move 3 projects" })).toBeInTheDocument();
  });

  it("uses the folder, then moves on", async () => {
    const { onDone } = renderView();

    fireEvent.click(await screen.findByRole("button", { name: "Use this folder" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.bringInProjects).toHaveBeenCalledWith({ dirs: [`${FOLDER}/cars`, `${FOLDER}/blank`], mode: "use", folder: FOLDER });
  });

  it("adds the projects where they are", async () => {
    const { onDone } = renderView();

    fireEvent.click(await screen.findByRole("radio", { name: /Leave them where they are/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add 2 projects" }));

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.bringInProjects).toHaveBeenCalledWith({ dirs: [`${FOLDER}/cars`, `${FOLDER}/blank`], mode: "leave" });
  });

  it("follows a move and says how far it got when it is stopped", async () => {
    api.bringInProjects.mockResolvedValue({ root: ROOT, job: job() });
    api.fetchJob.mockResolvedValue(job({ state: "cancelled", moved: [{ from: `${FOLDER}/cars`, to: `${ROOT}/cars` }] }));
    const { onDone } = renderView();

    fireEvent.click(await screen.findByRole("radio", { name: /Move them into/ }));
    fireEvent.click(screen.getByRole("button", { name: "Move 2 projects" }));

    expect(await screen.findByText("Moving 2 projects")).toBeInTheDocument();
    expect(screen.getByText("Into Documents › Node Banana. Closing this won’t stop it.")).toBeInTheDocument();
    expect(screen.getByText("912 of 3,822 files · 500 B of 2 KB")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Moving projects" })).toHaveAttribute("aria-valuenow", "912");
    expect(screen.getByText("25%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop move" }));
    await waitFor(() => expect(api.cancelJob).toHaveBeenCalledWith("job-1"));

    expect(await screen.findByText("Move stopped", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 projects moved to Documents › Node Banana.")).toBeInTheDocument();
    expect(screen.getByText(/The other 1 is where it was\. All 2 are in Open and Assets/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("says so when the folder holds no projects", async () => {
    api.scanProjects.mockResolvedValue(scan({ projects: [] }));
    renderView();

    expect(await screen.findByText("No projects found")).toBeInTheDocument();
    expect(screen.getByText("No Node Banana projects in ~/Documents/projects/workflows or its subfolders.")).toBeInTheDocument();
    expect(screen.queryByText("What should happen to them?")).not.toBeInTheDocument();
  });

  it("closes from Cancel when opened without a way back", async () => {
    const { onClose } = renderView({ onBack: undefined });

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
