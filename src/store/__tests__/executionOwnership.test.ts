/**
 * A run that was stopped can still be finishing: its requests settle, its
 * executors write, its cleanup runs. None of that may land on a run started
 * after it, or on a canvas that replaced its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkflowStore } from "../workflowStore";
import { executeNanoBanana, executeGlbViewer, executeVideoTrim } from "../execution";
import type { NodeExecutionContext } from "../execution";
import type { WorkflowNode } from "@/types";
import { hydrateWorkflowMedia } from "@/utils/mediaStorage";

vi.mock("@/utils/mediaStorage", () => ({
  externalizeWorkflowMedia: vi.fn(async (workflow) => workflow),
  hydrateWorkflowMedia: vi.fn(async (workflow) => workflow),
}));
vi.mock("../execution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../execution")>()),
  executeNanoBanana: vi.fn(),
  executeGlbViewer: vi.fn(),
  executeVideoTrim: vi.fn(),
  runBatchIfApplicable: vi.fn(async () => false),
}));
vi.mock("@/components/Toast", () => ({ useToast: { getState: () => ({ show: vi.fn() }) } }));
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    startSession: vi.fn(async () => undefined),
    endSession: vi.fn(async () => undefined),
    getCurrentSession: vi.fn(() => null),
  },
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const store = () => useWorkflowStore.getState();
const node = (id: string, type = "nanoBanana"): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data: { status: "idle", outputImage: "original" } }) as WorkflowNode;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hydrateWorkflowMedia).mockImplementation(async (workflow) => workflow);
  store().clearWorkflow();
  store().clearClipboard();
  useWorkflowStore.setState({ nodes: [node("generate-1")], isSaving: false });
});
afterEach(() => {
  store().clearWorkflow();
  vi.restoreAllMocks();
});

const runners = {
  workflow: () => store().executeWorkflow(),
  selected: () => store().executeSelectedNodes(["generate-1"]),
  regenerate: () => store().regenerateNode("generate-1"),
};
const kinds = Object.keys(runners) as (keyof typeof runners)[];

describe("a stopped run that finishes after a new one started", () => {
  it.each(kinds)("(%s) neither overwrites the new run's result nor ends it", async (kind) => {
    const first = deferred();
    const second = deferred();
    vi.mocked(executeNanoBanana)
      .mockImplementationOnce(async (ctx) => {
        await first.promise;
        ctx.updateNodeData(ctx.node.id, { outputImage: "stale-first-result" });
      })
      .mockImplementationOnce(async (ctx) => {
        ctx.updateNodeData(ctx.node.id, { outputImage: "second-result" });
        await second.promise;
      });
    const oldRun = runners[kind]();
    await vi.waitFor(() => expect(executeNanoBanana).toHaveBeenCalledTimes(1));
    store().stopWorkflow();
    const newRun = runners[kind]();
    await vi.waitFor(() => expect(executeNanoBanana).toHaveBeenCalledTimes(2));
    const owner = store()._abortController;

    first.resolve();
    await oldRun;
    expect(store().isRunning).toBe(true);
    expect(store()._abortController).toBe(owner);
    expect(store().currentNodeIds).toEqual(["generate-1"]);
    expect(store().nodes[0].data.outputImage).toBe("second-result");
    // Still running, so another start is refused
    await runners[kind]();
    expect(executeNanoBanana).toHaveBeenCalledTimes(2);

    second.resolve();
    await newRun;
    expect(store().isRunning).toBe(false);
  });

  it.each(kinds)("(%s) failing neither clears the new run nor marks its node failed", async (kind) => {
    const first = deferred();
    const second = deferred();
    vi.mocked(executeNanoBanana).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldRun = runners[kind]();
    await vi.waitFor(() => expect(executeNanoBanana).toHaveBeenCalledTimes(1));
    store().stopWorkflow();
    const newRun = runners[kind]();
    await vi.waitFor(() => expect(executeNanoBanana).toHaveBeenCalledTimes(2));
    const owner = store()._abortController;
    first.reject(new Error("Old request failed"));
    await oldRun;
    expect(store()._abortController).toBe(owner);
    expect(store().isRunning).toBe(true);
    expect(store().nodes[0].data.status).toBe("idle");
    second.resolve();
    await newRun;
  });

  it("(regenerate) of a node that finishes straight after its executor leaves the new run alone", async () => {
    useWorkflowStore.setState({ nodes: [node("trim-1", "videoTrim")] });
    const first = deferred();
    const second = deferred();
    vi.mocked(executeVideoTrim).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldRun = store().regenerateNode("trim-1");
    await vi.waitFor(() => expect(executeVideoTrim).toHaveBeenCalledTimes(1));
    store().stopWorkflow();
    const newRun = store().regenerateNode("trim-1");
    await vi.waitFor(() => expect(executeVideoTrim).toHaveBeenCalledTimes(2));
    first.resolve();
    await oldRun;
    expect(store().isRunning).toBe(true);
    expect(store().currentNodeIds).toEqual(["trim-1"]);
    second.resolve();
    await newRun;
    expect(store().isRunning).toBe(false);
  });
});

describe("a stopped run with nothing started after it", () => {
  it("can still put its node back to idle", async () => {
    const pending = deferred();
    vi.mocked(executeNanoBanana).mockImplementationOnce(async (ctx) => {
      ctx.updateNodeData(ctx.node.id, { status: "loading" });
      await pending.promise;
      ctx.updateNodeData(ctx.node.id, { status: "idle" });
    });
    const run = store().executeWorkflow();
    await vi.waitFor(() => expect(store().nodes[0].data.status).toBe("loading"));
    store().stopWorkflow();
    pending.resolve();
    await run;
    expect(store().nodes[0].data.status).toBe("idle");
    expect(store().isRunning).toBe(false);
  });
});

describe("a run started while a workflow's media loads", () => {
  it("is cancelled when the loaded workflow replaces its graph, and writes nothing to it", async () => {
    const hydration = deferred();
    const generation = deferred();
    vi.mocked(hydrateWorkflowMedia).mockImplementationOnce(async (workflow) => {
      await hydration.promise;
      return workflow;
    });
    vi.mocked(executeNanoBanana).mockImplementationOnce(async (ctx) => {
      await generation.promise;
      ctx.updateNodeData(ctx.node.id, { outputImage: "outgoing-graph-result" });
    });
    // The loaded file reuses the outgoing graph's node id
    const loading = store().loadWorkflow(
      {
        version: 1,
        name: "Loaded",
        edgeStyle: "angular",
        edges: [],
        nodes: [{ ...node("generate-1"), data: { status: "idle", outputImage: "loaded-image" } } as WorkflowNode],
      },
      "/loaded",
    );
    const running = store().executeWorkflow();
    await vi.waitFor(() => expect(executeNanoBanana).toHaveBeenCalledOnce());
    const controller = store()._abortController!;

    hydration.resolve();
    await loading;
    expect(controller.signal.aborted).toBe(true);
    expect(store()._abortController).toBeNull();
    expect(store().isRunning).toBe(false);

    generation.resolve();
    await running;
    expect(store().nodes[0].data.outputImage).toBe("loaded-image");
    expect(store().workflowName).toBe("Loaded");
    expect(store().hasUnsavedChanges).toBe(false);
  });
});

describe("downstream consumers of a single-node or selection run", () => {
  it.each(["regenerate", "selected"] as const)("(%s) are cancelled by Stop", async (kind) => {
    useWorkflowStore.setState({
      nodes: [node("generate-1"), node("viewer-1", "glbViewer")],
      edges: [{ id: "e", source: "generate-1", target: "viewer-1" }],
    });
    vi.mocked(executeNanoBanana).mockResolvedValueOnce(undefined);
    const pending = deferred();
    let downstream!: NodeExecutionContext;
    vi.mocked(executeGlbViewer).mockImplementationOnce(async (ctx) => {
      downstream = ctx;
      await pending.promise;
    });
    const run = runners[kind]();
    await vi.waitFor(() => expect(executeGlbViewer).toHaveBeenCalledOnce());
    store().stopWorkflow();
    expect(downstream.signal?.aborted).toBe(true);
    pending.resolve();
    await run;
  });
});

describe("a video output replaced by a run", () => {
  const video = (id: string, outputVideo?: string) =>
    ({ ...node(id, "videoTrim"), data: outputVideo ? { outputVideo } : {} }) as WorkflowNode;

  it.each(["another node", "the clipboard", "another tab", "undo", "redo", "a pending undo step"] as const)(
    "stays alive while %s still holds it",
    (owner) => {
      useWorkflowStore.setState({ nodes: [{ ...video("video-1", "blob:shared"), selected: true }] });
      if (owner === "another node") useWorkflowStore.setState({ nodes: [...store().nodes, video("copy", "blob:shared")] });
      if (owner === "the clipboard") store().copySelectedNodes();
      if (owner === "another tab") {
        store().newTab();
        useWorkflowStore.setState({ nodes: [video("video-1", "blob:shared")] });
      }
      if (owner === "undo") store().addNode("prompt", { x: 0, y: 0 });
      if (owner === "redo") {
        // Undo the change that brought the URL in, so only redo holds it
        useWorkflowStore.setState({ nodes: [video("video-1")] });
        store().updateNodeData("video-1", { outputVideo: "blob:shared" });
        store().undo();
      }
      if (owner === "a pending undo step") store().updateNodeData("video-1", { outputVideo: "blob:replacement" });
      const revoke = vi.spyOn(URL, "revokeObjectURL");
      const ctx = store()._buildExecutionContext(store().nodes[0]);
      // Executors write during a run, which records no undo steps
      useWorkflowStore.setState({ isRunning: true });
      ctx.updateNodeData("video-1", { outputVideo: "blob:replacement" });
      ctx.releaseMediaUrl!("blob:shared");
      expect(revoke).not.toHaveBeenCalledWith("blob:shared");
    },
  );

  it("is released when nothing holds it any more", () => {
    useWorkflowStore.setState({ nodes: [video("video-1", "blob:unshared")], isRunning: true });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const ctx = store()._buildExecutionContext(store().nodes[0]);
    ctx.updateNodeData("video-1", { outputVideo: "blob:replacement" });
    ctx.releaseMediaUrl!("blob:unshared");
    expect(revoke).toHaveBeenCalledWith("blob:unshared");
  });
});

describe("an execution context whose canvas was replaced", () => {
  it("writes nothing, even without a signal", () => {
    const ctx = store()._buildExecutionContext(store().nodes[0]);
    store().clearWorkflow();
    useWorkflowStore.setState({
      nodes: [node("generate-1"), { ...node("gallery", "outputGallery"), data: { images: [], videos: [] } } as WorkflowNode],
    });
    ctx.updateNodeData("generate-1", { outputImage: "stale" });
    ctx.appendOutputGalleryImage("gallery", "stale");
    ctx.appendOutputGalleryVideo("gallery", "stale");
    ctx.addIncurredCost(10);
    ctx.addToGlobalHistory({ image: "stale", timestamp: 0, prompt: "test", model: "nano-banana", aspectRatio: "1:1" });
    expect(store().nodes[0].data.outputImage).toBe("original");
    expect(store().nodes[1].data).toEqual({ images: [], videos: [] });
    expect(store().incurredCost).toBe(0);
    expect(store().globalImageHistory).toEqual([]);
  });
});
