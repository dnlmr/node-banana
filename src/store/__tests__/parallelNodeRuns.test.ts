/**
 * A node's own Run (regenerateNode) does not wait for another node's: several
 * can run at once. A workflow run still holds the canvas, and Stop ends them all.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { WorkflowNode } from "@/types";
import type { NodeExecutionContext } from "../execution";

// Each output node's run waits on a promise the test settles
const pending = vi.hoisted(() => new Map<string, { resolve: () => void; ctx: unknown }>());

vi.mock("../execution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../execution")>();
  return {
    ...actual,
    executeOutput: vi.fn(
      (ctx: NodeExecutionContext) =>
        new Promise<void>((resolve) => {
          pending.set(ctx.node.id, { resolve, ctx });
        })
    ),
  };
});

import { useWorkflowStore } from "../workflowStore";

const initial = useWorkflowStore.getState();

function outputNode(id: string): WorkflowNode {
  return { id, type: "output", position: { x: 0, y: 0 }, data: {} } as WorkflowNode;
}

/** Lets the store's awaits (log session, the executor starting) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("parallel single-node runs", () => {
  beforeEach(() => {
    pending.clear();
    useWorkflowStore.setState({
      ...initial,
      nodes: [outputNode("a"), outputNode("b")],
      edges: [],
      groups: {},
      isRunning: false,
      currentNodeIds: [],
      batch: null,
    });
  });

  it("runs a second node while the first is still running", async () => {
    const first = useWorkflowStore.getState().regenerateNode("a");
    await flush();
    const second = useWorkflowStore.getState().regenerateNode("b");
    await flush();

    expect([...pending.keys()]).toEqual(["a", "b"]);
    expect(useWorkflowStore.getState().isRunning).toBe(true);
    expect(useWorkflowStore.getState().currentNodeIds).toEqual(["a", "b"]);

    pending.get("a")!.resolve();
    await first;
    expect(useWorkflowStore.getState().isRunning).toBe(true);
    expect(useWorkflowStore.getState().currentNodeIds).toEqual(["b"]);

    pending.get("b")!.resolve();
    await second;
    expect(useWorkflowStore.getState().isRunning).toBe(false);
    expect(useWorkflowStore.getState().currentNodeIds).toEqual([]);
  });

  it("does not start a node that is already running", async () => {
    const first = useWorkflowStore.getState().regenerateNode("a");
    await flush();
    await useWorkflowStore.getState().regenerateNode("a");
    expect(pending.size).toBe(1);
    pending.get("a")!.resolve();
    await first;
  });

  it("waits for a workflow run", async () => {
    useWorkflowStore.setState({ isRunning: true });
    await useWorkflowStore.getState().regenerateNode("a");
    expect(pending.size).toBe(0);
  });

  it("keeps a workflow run waiting while node runs go", async () => {
    const first = useWorkflowStore.getState().regenerateNode("a");
    await flush();
    await useWorkflowStore.getState().executeWorkflow();
    expect(pending.size).toBe(1);
    pending.get("a")!.resolve();
    await first;
  });

  it("Stop ends every node run", async () => {
    const first = useWorkflowStore.getState().regenerateNode("a");
    const second = useWorkflowStore.getState().regenerateNode("b");
    await flush();

    useWorkflowStore.getState().stopWorkflow();
    expect(useWorkflowStore.getState().isRunning).toBe(false);
    for (const { ctx } of pending.values()) {
      expect((ctx as NodeExecutionContext).signal?.aborted).toBe(true);
    }

    // The runs finishing afterwards leave the stopped state alone, and a new run starts cleanly
    for (const { resolve } of pending.values()) resolve();
    await Promise.all([first, second]);
    expect(useWorkflowStore.getState().isRunning).toBe(false);
    pending.clear();
    const again = useWorkflowStore.getState().regenerateNode("a");
    await flush();
    expect(pending.has("a")).toBe(true);
    expect(useWorkflowStore.getState().isRunning).toBe(true);
    pending.get("a")!.resolve();
    await again;
    expect(useWorkflowStore.getState().isRunning).toBe(false);
  });
});
