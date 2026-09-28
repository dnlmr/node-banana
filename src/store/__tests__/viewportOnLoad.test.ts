/**
 * A workflow opened from a file has no viewport of its own; the canvas frames
 * its graph once the nodes are measured (WorkflowCanvas), which it does only
 * while the store holds no viewport.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkflowStore } from "../workflowStore";

const initial = useWorkflowStore.getState();

const file = () => ({
  version: 1 as const,
  id: "wf-1",
  name: "Mannequin",
  nodes: [],
  edges: [],
  edgeStyle: "angular" as const,
});

describe("viewport on load", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkflowStore.setState({ ...initial, nodes: [], edges: [], groups: {} });
  });

  it("drops the previous graph's viewport when a file is opened", async () => {
    useWorkflowStore.getState().setCanvasViewport({ x: -4000, y: 200, zoom: 1.2 });
    await useWorkflowStore.getState().loadWorkflow(file());
    expect(useWorkflowStore.getState().canvasViewport).toBeNull();
    expect(useWorkflowStore.getState().workflowLoadCount).toBeGreaterThan(0);
  });
});
