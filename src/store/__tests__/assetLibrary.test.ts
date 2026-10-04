/**
 * The workflow store's side of the asset library: every run is bracketed for
 * the recorder, workflows get an id before their first asset, projects are
 * classified when they are set up or saved, UI edits are recorded as runs of
 * their own, and carousels are pruned against the library and the folder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeExecutionContext } from "../execution";
import type { WorkflowNode } from "@/types";

const recorder = vi.hoisted(() => ({
  enabled: true,
  isRecorderEnabled: vi.fn(() => recorder.enabled),
  beginRun: vi.fn(),
  endRun: vi.fn(),
  recordAsset: vi.fn(),
}));
vi.mock("@/lib/assets/client/recorder", () => ({
  isRecorderEnabled: recorder.isRecorderEnabled,
  beginRun: recorder.beginRun,
  endRun: recorder.endRun,
  recordAsset: recorder.recordAsset,
}));

// The captured graph is the store state itself, so a test can tell which canvas it came from
vi.mock("@/lib/assets/client/snapshot", () => ({
  captureGraph: (state: { nodes: unknown[]; workflowId: string | null }) => ({ nodes: state.nodes, workflowId: state.workflowId }),
}));

let runCounter = 0;
vi.mock("@/lib/assets/client/ids", () => ({
  newRunId: () => `r-test-${++runCounter}`,
}));

const api = vi.hoisted(() => ({
  upsertWorkflowEntry: vi.fn(),
  fetchAssetExistence: vi.fn(),
}));
vi.mock("@/lib/assets/client/api", () => api);

vi.mock("@/utils/mediaStorage", () => ({
  externalizeWorkflowMedia: vi.fn(async (workflow: unknown) => workflow),
  hydrateWorkflowMedia: vi.fn(async (workflow: unknown) => workflow),
}));

vi.mock("@/components/Toast", () => ({
  useToast: { getState: () => ({ show: vi.fn() }) },
}));

vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startSession: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    getCurrentSession: vi.fn().mockReturnValue(null),
  },
}));

// A prompt node's executor stands in for any node: it hands its context to the
// test, and can be held open to replace the canvas mid-run.
const exec = vi.hoisted(() => ({
  contexts: [] as unknown[],
  hold: null as Promise<void> | null,
}));
vi.mock("../execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../execution")>();
  return {
    ...actual,
    executePrompt: vi.fn(async (ctx: unknown) => {
      exec.contexts.push(ctx);
      if (exec.hold) await exec.hold;
    }),
  };
});

import { useWorkflowStore } from "../workflowStore";

const initial = useWorkflowStore.getState();
const store = () => useWorkflowStore.getState();
const mockFetch = vi.fn();

const promptNode = (id = "prompt-1"): WorkflowNode =>
  ({ id, type: "prompt", position: { x: 0, y: 0 }, data: { prompt: "a fox" } }) as WorkflowNode;

function hold(): () => void {
  let release!: () => void;
  exec.hold = new Promise<void>((resolve) => (release = resolve));
  return release;
}

beforeEach(() => {
  vi.clearAllMocks();
  recorder.enabled = true;
  exec.contexts = [];
  exec.hold = null;
  runCounter = 0;
  api.upsertWorkflowEntry.mockResolvedValue({});
  api.fetchAssetExistence.mockResolvedValue({});
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  useWorkflowStore.setState({
    ...initial,
    nodes: [promptNode()],
    edges: [],
    groups: {},
    workflowId: null,
    workflowName: null,
    saveDirectoryPath: null,
    generationsPath: null,
    isRunning: false,
    _currentRun: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ensureWorkflowId", () => {
  it("gives an unsaved canvas an id once, and keeps an existing one", () => {
    const minted = store().ensureWorkflowId();
    expect(minted).toMatch(/^wf_/);
    expect(store().workflowId).toBe(minted);
    expect(store().ensureWorkflowId()).toBe(minted);

    useWorkflowStore.setState({ workflowId: "wf-existing" });
    expect(store().ensureWorkflowId()).toBe("wf-existing");
  });
});

describe("runs", () => {
  it("brackets a workflow run: begins with the start graph, records through the context, ends with the final graph", async () => {
    useWorkflowStore.setState({ workflowName: "Fox", saveDirectoryPath: "/projects/fox" });

    await store().executeWorkflow();

    const workflowId = store().workflowId;
    expect(workflowId).toMatch(/^wf_/);
    expect(recorder.beginRun).toHaveBeenCalledOnce();
    const [run, startGraph] = recorder.beginRun.mock.calls[0];
    expect(run).toEqual({
      runId: "r-test-1",
      workflowId,
      workflowName: "Fox",
      projectDir: "/projects/fox",
      startedAt: expect.any(Number),
    });
    expect(startGraph).toEqual({ nodes: [promptNode()], workflowId });

    // Each node's context carries the run and a recorder bound to it
    const ctx = exec.contexts[0] as NodeExecutionContext;
    expect(ctx.assetRun).toEqual(run);
    const input = { kind: "image", origin: "generated", media: "data:,", producer: { nodeId: "prompt-1", nodeType: "prompt" } } as const;
    ctx.recordAsset!(input);
    expect(recorder.recordAsset).toHaveBeenCalledWith(input, run);

    expect(recorder.endRun).toHaveBeenCalledExactlyOnceWith("r-test-1", { nodes: store().nodes, workflowId });
    expect(store()._currentRun).toBeNull();
  });

  it("brackets a regenerated node", async () => {
    await store().regenerateNode("prompt-1");

    expect(recorder.beginRun).toHaveBeenCalledOnce();
    expect(recorder.endRun).toHaveBeenCalledExactlyOnceWith("r-test-1", expect.objectContaining({ workflowId: store().workflowId }));
  });

  it("brackets a run of the selected nodes", async () => {
    await store().executeSelectedNodes(["prompt-1"]);

    expect(recorder.beginRun).toHaveBeenCalledOnce();
    expect((exec.contexts[0] as NodeExecutionContext).recordAsset).toBeTypeOf("function");
    expect(recorder.endRun).toHaveBeenCalledExactlyOnceWith("r-test-1", expect.anything());
  });

  it("ends with no final graph when the canvas was replaced mid-run", async () => {
    const release = hold();
    const running = store().executeWorkflow();
    await vi.waitFor(() => expect(exec.contexts).toHaveLength(1));

    store().clearWorkflow();
    release();
    await running;

    expect(recorder.endRun).toHaveBeenCalledExactlyOnceWith("r-test-1", null);
  });

  it("ends with no final graph when the workflow took another id mid-run", async () => {
    const release = hold();
    const running = store().executeWorkflow();
    await vi.waitFor(() => expect(exec.contexts).toHaveLength(1));

    useWorkflowStore.setState({ workflowId: "wf-forked" });
    release();
    await running;

    expect(recorder.endRun).toHaveBeenCalledExactlyOnceWith("r-test-1", null);
  });

  it("ends the run when it is stopped", async () => {
    const release = hold();
    const running = store().executeWorkflow();
    await vi.waitFor(() => expect(exec.contexts).toHaveLength(1));

    store().stopWorkflow();
    expect(recorder.endRun).toHaveBeenCalledExactlyOnceWith("r-test-1", expect.objectContaining({ nodes: store().nodes }));
    release();
    await running;
    expect(recorder.endRun).toHaveBeenCalledOnce();
  });

  it("leaves runs alone while the library is off", async () => {
    recorder.enabled = false;

    await store().executeWorkflow();

    expect(recorder.beginRun).not.toHaveBeenCalled();
    expect(recorder.endRun).not.toHaveBeenCalled();
    expect(store().workflowId).toBeNull();
    expect((exec.contexts[0] as NodeExecutionContext).recordAsset).toBeUndefined();
  });
});

describe("recordUiAsset", () => {
  const annotated = {
    kind: "image",
    origin: "edited",
    media: "data:image/png;base64,drawn",
    producer: { nodeId: "ann-1", nodeType: "annotation", operation: "annotate" },
  } as const;

  it("records a UI edit as a run of its own, with the node's custom title", () => {
    useWorkflowStore.setState({
      nodes: [{ id: "ann-1", type: "annotation", position: { x: 0, y: 0 }, data: { customTitle: "Markup" } } as WorkflowNode],
      saveDirectoryPath: "/projects/fox",
      workflowName: "Fox",
    });
    recorder.recordAsset.mockReturnValue({ assetId: "a000000000001", done: Promise.resolve(null) });

    const handles = store().recordUiAsset(annotated);

    const workflowId = store().workflowId;
    expect(handles).toEqual([{ assetId: "a000000000001", done: expect.any(Promise) }]);
    const run = { runId: "r-test-1", workflowId, workflowName: "Fox", projectDir: "/projects/fox", startedAt: expect.any(Number) };
    expect(recorder.beginRun).toHaveBeenCalledWith(run, expect.objectContaining({ workflowId }));
    expect(recorder.recordAsset).toHaveBeenCalledWith(
      { ...annotated, producer: { ...annotated.producer, nodeTitle: "Markup" } },
      expect.objectContaining({ runId: "r-test-1" })
    );
    expect(recorder.endRun).toHaveBeenCalledWith("r-test-1", expect.objectContaining({ workflowId }));
  });

  it("records several edits in one run", () => {
    recorder.recordAsset.mockImplementation(() => ({ assetId: "a", done: Promise.resolve(null) }));

    expect(store().recordUiAsset([annotated, annotated])).toHaveLength(2);
    expect(recorder.beginRun).toHaveBeenCalledOnce();
    expect(recorder.endRun).toHaveBeenCalledOnce();
  });

  it("does nothing while the library is off", () => {
    recorder.enabled = false;

    expect(store().recordUiAsset(annotated)).toEqual([]);
    expect(recorder.beginRun).not.toHaveBeenCalled();
    expect(store().workflowId).toBeNull();
  });
});

describe("classification", () => {
  it("files the workflow under its project when the project is set up", () => {
    store().setWorkflowMetadata("wf-1", "Fox", "/projects/fox");

    return vi.waitFor(() => {
      expect(api.upsertWorkflowEntry).toHaveBeenCalledExactlyOnceWith("wf-1", { name: "Fox", projectPath: "/projects/fox", asOf: expect.any(Number) });
    });
  });

  it("stamps the entry with when it was filed, so a run that started earlier cannot put its old name back", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(42_000);
    store().setWorkflowMetadata("wf-1", "Wolf", "/projects/wolf");
    now.mockRestore();

    return vi.waitFor(() => {
      expect(api.upsertWorkflowEntry).toHaveBeenCalledExactlyOnceWith("wf-1", { name: "Wolf", projectPath: "/projects/wolf", asOf: 42_000 });
    });
  });

  it("files the workflow again after each successful save", async () => {
    useWorkflowStore.setState({ workflowId: "wf-1", workflowName: "Fox", saveDirectoryPath: "/projects/fox", useExternalImageStorage: false });
    mockFetch.mockResolvedValue({ json: async () => ({ success: true }) });

    await expect(store().saveToFile()).resolves.toBe(true);

    await vi.waitFor(() => {
      expect(api.upsertWorkflowEntry).toHaveBeenCalledExactlyOnceWith("wf-1", { name: "Fox", projectPath: "/projects/fox", asOf: expect.any(Number) });
    });
  });

  it("files a save into another folder as a fork, leaving the old id where it was", async () => {
    useWorkflowStore.setState({
      workflowId: "wf-old",
      workflowName: "Fox",
      saveDirectoryPath: "/projects/fox-copy",
      imageRefBasePath: "/projects/fox",
      useExternalImageStorage: true,
    });
    mockFetch.mockResolvedValue({ json: async () => ({ success: true }) });

    await expect(store().saveToFile()).resolves.toBe(true);

    const newId = store().workflowId;
    expect(newId).not.toBe("wf-old");
    await vi.waitFor(() => {
      expect(api.upsertWorkflowEntry).toHaveBeenCalledExactlyOnceWith(newId, {
        name: "Fox",
        projectPath: "/projects/fox-copy",
        forkedFrom: "wf-old",
        asOf: expect.any(Number),
      });
    });
  });

  it("moving a project to another folder in Settings leaves the old id's assets with the old folder", async () => {
    useWorkflowStore.setState({
      workflowId: "wf-old",
      workflowName: "Fox",
      saveDirectoryPath: "/projects/fox",
      generationsPath: "/projects/fox/generations",
      imageRefBasePath: "/projects/fox",
      useExternalImageStorage: true,
    });
    mockFetch.mockResolvedValue({ json: async () => ({ success: true }) });

    // What FloatingMenu does after the settings dialog: metadata, then save
    store().setWorkflowMetadata("wf-old", "Fox", "/projects/fox-copy");
    await expect(store().saveToFile()).resolves.toBe(true);

    const newId = store().workflowId;
    expect(newId).not.toBe("wf-old");
    await vi.waitFor(() => {
      expect(api.upsertWorkflowEntry).toHaveBeenCalledWith(newId, {
        name: "Fox",
        projectPath: "/projects/fox-copy",
        forkedFrom: "wf-old",
        asOf: expect.any(Number),
      });
    });
    expect(api.upsertWorkflowEntry).not.toHaveBeenCalledWith("wf-old", expect.anything());
  });

  it("a move that keeps the id files the id under the new folder once it is saved", async () => {
    useWorkflowStore.setState({
      workflowId: "wf-1",
      workflowName: "Fox",
      saveDirectoryPath: "/projects/fox",
      imageRefBasePath: null,
      useExternalImageStorage: false,
    });
    mockFetch.mockResolvedValue({ json: async () => ({ success: true }) });

    store().setWorkflowMetadata("wf-1", "Fox", "/projects/fox-moved");
    await Promise.resolve();
    // Nothing is filed until the save says the folder holds the workflow
    expect(api.upsertWorkflowEntry).not.toHaveBeenCalled();
    await expect(store().saveToFile()).resolves.toBe(true);

    expect(store().workflowId).toBe("wf-1");
    await vi.waitFor(() => {
      expect(api.upsertWorkflowEntry).toHaveBeenCalledExactlyOnceWith("wf-1", { name: "Fox", projectPath: "/projects/fox-moved", asOf: expect.any(Number) });
    });
  });

  it("files a new project made from a saved canvas under its own new id", () => {
    useWorkflowStore.setState({ workflowId: "wf-old", workflowName: "Fox", saveDirectoryPath: "/projects/fox" });

    store().setWorkflowMetadata("wf-new", "Wolf", "/projects/wolf");

    return vi.waitFor(() => {
      expect(api.upsertWorkflowEntry).toHaveBeenCalledExactlyOnceWith("wf-new", { name: "Wolf", projectPath: "/projects/wolf", asOf: expect.any(Number) });
    });
  });

  it("does not file a failed save", async () => {
    useWorkflowStore.setState({ workflowId: "wf-1", workflowName: "Fox", saveDirectoryPath: "/projects/fox", useExternalImageStorage: false });
    mockFetch.mockResolvedValue({ json: async () => ({ success: false, error: "disk full" }) });

    await expect(store().saveToFile()).resolves.toBe(false);
    await Promise.resolve();

    expect(api.upsertWorkflowEntry).not.toHaveBeenCalled();
  });

  it("does not file anything while the library is off", async () => {
    recorder.enabled = false;
    store().setWorkflowMetadata("wf-1", "Fox", "/projects/fox");
    await Promise.resolve();

    expect(api.upsertWorkflowEntry).not.toHaveBeenCalled();
  });
});

describe("pruneMissingHistory", () => {
  const entry = (id: string, assetId?: string) => ({ id, ...(assetId ? { assetId } : {}), timestamp: 1, prompt: "", aspectRatio: "1:1", model: "m" });
  const withHistory = (history: ReturnType<typeof entry>[], selected = 0) =>
    ({ id: "gen-1", type: "nanoBanana", position: { x: 0, y: 0 }, data: { imageHistory: history, selectedHistoryIndex: selected } }) as unknown as WorkflowNode;
  const kept = () => (store().nodes[0].data as { imageHistory: { id: string }[] }).imageHistory.map((e) => e.id);

  it("keeps an entry the library or the folder can still show", async () => {
    useWorkflowStore.setState({
      generationsPath: "/projects/fox/generations",
      nodes: [
        withHistory([
          entry("present", "a1"),
          entry("in-folder", "a2"),
          entry("lost", "a3"),
          entry("legacy-kept"),
          entry("legacy-lost"),
          entry("unknown", "a4"),
        ]),
      ],
    });
    api.fetchAssetExistence.mockResolvedValue({ a1: "present", a2: "gone", a3: "gone", a4: "unknown" });
    mockFetch.mockResolvedValue({ json: async () => ({ success: true, ids: ["in-folder", "legacy-kept"] }) });

    await store().pruneMissingHistory();

    expect(api.fetchAssetExistence).toHaveBeenCalledExactlyOnceWith(["a1", "a2", "a3", "a4"]);
    expect(kept()).toEqual(["present", "in-folder", "legacy-kept", "unknown"]);
    expect(store().hasUnsavedChanges).toBe(true);
  });

  it("without a folder, asks only the library, and keeps entries from before it", async () => {
    useWorkflowStore.setState({ nodes: [withHistory([entry("gone", "a1"), entry("legacy"), entry("here", "a2")], 2)] });
    api.fetchAssetExistence.mockResolvedValue({ a1: "gone", a2: "present" });

    await store().pruneMissingHistory();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(kept()).toEqual(["legacy", "here"]);
    expect((store().nodes[0].data as { selectedHistoryIndex: number }).selectedHistoryIndex).toBe(1);
  });

  it("keeps the library's losses when the folder cannot be listed", async () => {
    useWorkflowStore.setState({ generationsPath: "/projects/fox/generations", nodes: [withHistory([entry("x", "a1"), entry("y")])] });
    api.fetchAssetExistence.mockResolvedValue({ a1: "gone" });
    mockFetch.mockRejectedValue(new Error("offline"));

    await store().pruneMissingHistory();

    expect(kept()).toEqual(["x", "y"]);
  });

  it("drops its answers when another canvas replaced the one it asked for", async () => {
    useWorkflowStore.setState({
      workflowId: "wf-a",
      generationsPath: "/projects/a/generations",
      nodes: [withHistory([entry("a-file"), entry("a-lost")])],
    });
    let listFolder!: (ids: string[]) => void;
    mockFetch.mockReturnValue(
      new Promise((resolve) => (listFolder = (ids) => resolve({ json: async () => ({ success: true, ids }) })))
    );

    const pruning = store().pruneMissingHistory();
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledOnce());
    // The user switches to project B while A's folder is still being listed
    const other = [withHistory([entry("b-1"), entry("b-2")])];
    useWorkflowStore.setState({
      workflowId: "wf-b",
      generationsPath: "/projects/b/generations",
      nodes: other,
      canvasGeneration: store().canvasGeneration + 1,
      hasUnsavedChanges: false,
    });
    listFolder(["a-file"]);
    await pruning;

    expect(store().nodes).toBe(other);
    expect(store().hasUnsavedChanges).toBe(false);
  });

  it("while the library is off, keeps entries with an asset id and prunes the rest by the folder", async () => {
    recorder.enabled = false;
    useWorkflowStore.setState({ generationsPath: "/projects/fox/generations", nodes: [withHistory([entry("x", "a1"), entry("y"), entry("z")])] });
    mockFetch.mockResolvedValue({ json: async () => ({ success: true, ids: ["z"] }) });

    await store().pruneMissingHistory();

    expect(api.fetchAssetExistence).not.toHaveBeenCalled();
    expect(kept()).toEqual(["x", "z"]);
  });
});
