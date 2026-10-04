import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WorkflowBrowserView } from "@/components/quickstart/WorkflowBrowserView";
import { useSettingsDialogStore } from "@/store/settingsDialogStore";
import type { KnownProject, ProjectsOverview } from "@/lib/assets/types";

const mockFetchProjects = vi.fn();
vi.mock("@/lib/assets/client/api", () => ({
  fetchProjects: (...args: unknown[]) => mockFetchProjects(...args),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

const ROOT = "/Users/ada/Documents/Node Banana";
const HOUR = 60 * 60 * 1000;

function known(patch: Partial<KnownProject>): KnownProject {
  return { dir: `${ROOT}/x`, name: "x", relativePath: "x", inRoot: true, lastModified: Date.now(), mediaCount: 0, ...patch };
}

function overview(projects: KnownProject[]): ProjectsOverview {
  return { root: ROOT, projects, elsewhere: null, offerDismissed: false };
}

describe("WorkflowBrowserView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsDialogStore.setState({ request: null });
  });

  it("lists every known project with where it lives", async () => {
    mockFetchProjects.mockResolvedValue(
      overview([
        known({ dir: `${ROOT}/nood-prod/Supplier Cleanup`, name: "Supplier Cleanup", relativePath: "nood-prod/Supplier Cleanup", lastModified: Date.now() - 2 * HOUR }),
        known({ dir: "/Users/ada/Documents/projects/pet-hype", name: "pet-hype", relativePath: null, inRoot: false, lastModified: Date.now() - 50 * HOUR }),
      ])
    );
    render(<WorkflowBrowserView onWorkflowLoaded={vi.fn()} />);

    expect(await screen.findByText("Supplier Cleanup")).toBeInTheDocument();
    expect(screen.getByText("Your projects")).toBeInTheDocument();
    expect(screen.getByText("2 projects")).toBeInTheDocument();
    expect(screen.getByText("~/Documents/Node Banana")).toBeInTheDocument();
    expect(screen.getByText("nood-prod/Supplier Cleanup")).toBeInTheDocument();
    expect(screen.getByText("~/Documents/projects/pet-hype")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
    expect(screen.getByText("2d ago")).toBeInTheDocument();
  });

  it("opens a project from its folder", async () => {
    const dir = `${ROOT}/cars`;
    mockFetchProjects.mockResolvedValue(overview([known({ dir, name: "Cars" })]));
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({ success: true, workflow: { name: "Cars", nodes: [], edges: [] } }) });
    const onWorkflowLoaded = vi.fn();
    const onClose = vi.fn();
    render(<WorkflowBrowserView onWorkflowLoaded={onWorkflowLoaded} onClose={onClose} />);

    fireEvent.click(await screen.findByText("Cars"));

    await waitFor(() => expect(onWorkflowLoaded).toHaveBeenCalledWith(expect.objectContaining({ name: "Cars" }), dir));
    expect(mockFetch).toHaveBeenCalledWith(`/api/workflow?path=${encodeURIComponent(dir)}&load=true`);
    expect(onClose).toHaveBeenCalled();
  });

  it("says where saved projects go when there are none, with New project and Bring in", async () => {
    mockFetchProjects.mockResolvedValue(overview([]));
    const onNewProject = vi.fn();
    const onBringIn = vi.fn();
    render(<WorkflowBrowserView onWorkflowLoaded={vi.fn()} onNewProject={onNewProject} onBringIn={onBringIn} />);

    expect(await screen.findByText("Projects you save are kept here, in Documents › Node Banana.")).toBeInTheDocument();
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    fireEvent.click(screen.getByRole("button", { name: /Bring in your projects/ }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(onBringIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Choose folder")).not.toBeInTheDocument();
  });

  it("hands Change folder to Settings › Storage", async () => {
    mockFetchProjects.mockResolvedValue(overview([]));
    const onClose = vi.fn();
    render(<WorkflowBrowserView onWorkflowLoaded={vi.fn()} onClose={onClose} />);

    fireEvent.click(await screen.findByRole("button", { name: "Change folder" }));

    expect(onClose).toHaveBeenCalled();
    expect(useSettingsDialogStore.getState().request?.page).toBe("library");
  });

  it("opens a workflow from any folder with Open from elsewhere…", async () => {
    mockFetchProjects.mockResolvedValue(overview([]));
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve({
        json: () =>
          Promise.resolve(url === "/api/browse-directory" ? { success: true, path: "/tmp/other" } : { success: true, workflow: { nodes: [], edges: [] } }),
      })
    );
    const onWorkflowLoaded = vi.fn();
    render(<WorkflowBrowserView onWorkflowLoaded={onWorkflowLoaded} />);

    fireEvent.click(await screen.findByRole("button", { name: /Open from elsewhere/ }));

    await waitFor(() => expect(onWorkflowLoaded).toHaveBeenCalledWith(expect.anything(), "/tmp/other"));
  });

  it("reports a library that cannot list projects", async () => {
    mockFetchProjects.mockRejectedValue(new Error("Couldn't reach the asset library."));
    render(<WorkflowBrowserView onWorkflowLoaded={vi.fn()} />);

    expect(await screen.findByText("Projects could not be listed")).toBeInTheDocument();
    expect(screen.getByText("Couldn't reach the asset library.")).toBeInTheDocument();
  });
});
