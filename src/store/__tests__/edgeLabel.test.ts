import { describe, it, expect, beforeEach } from "vitest";
import { useWorkflowStore } from "../workflowStore";
import type { WorkflowEdge } from "@/types";

const initial = useWorkflowStore.getState();
const edge = (id: string, data: Record<string, unknown> = {}): WorkflowEdge =>
  ({ id, source: "a", sourceHandle: "text", target: id, targetHandle: "text", data });

describe("setEdgeLabel", () => {
  beforeEach(() => {
    useWorkflowStore.setState({ ...initial, nodes: [], edges: [edge("b", { hasPause: true })], groups: {} });
  });

  it("sets a trimmed label and keeps the rest of the data", () => {
    useWorkflowStore.getState().setEdgeLabel("b", "  hero shot ");
    expect(useWorkflowStore.getState().edges[0].data).toEqual({ hasPause: true, label: "hero shot" });
  });

  it("clears the label when given blank text", () => {
    useWorkflowStore.getState().setEdgeLabel("b", "x");
    useWorkflowStore.getState().setEdgeLabel("b", "   ");
    expect(useWorkflowStore.getState().edges[0].data).toEqual({ hasPause: true });
  });

  it("is a no-op for unchanged text or unknown edges", () => {
    const before = useWorkflowStore.getState().edges;
    useWorkflowStore.getState().setEdgeLabel("b", "");
    useWorkflowStore.getState().setEdgeLabel("nope", "x");
    expect(useWorkflowStore.getState().edges).toBe(before);
  });

  it("can be undone", () => {
    useWorkflowStore.getState().setEdgeLabel("b", "x");
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().edges[0].data?.label).toBeUndefined();
  });
});

describe("setEdgesLabel", () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      ...initial,
      nodes: [],
      edges: [edge("b", { hidden: true }), edge("c", { hidden: true, label: "old" }), edge("d", { hidden: true })],
      groups: {},
    });
  });

  const labels = () => useWorkflowStore.getState().edges.map((e) => e.data?.label);

  it("labels every given connection with the trimmed text", () => {
    useWorkflowStore.getState().setEdgesLabel(["b", "c"], "  Model ");
    expect(labels()).toEqual(["Model", "Model", undefined]);
    expect(useWorkflowStore.getState().edges[0].data).toEqual({ hidden: true, label: "Model" });
  });

  it("clears the label from each when given blank text", () => {
    useWorkflowStore.getState().setEdgesLabel(["b", "c"], "Model");
    useWorkflowStore.getState().setEdgesLabel(["b", "c"], "  ");
    expect(useWorkflowStore.getState().edges[1].data).toEqual({ hidden: true });
    expect(labels()).toEqual([undefined, undefined, undefined]);
  });

  it("is a no-op when nothing would change", () => {
    useWorkflowStore.getState().setEdgesLabel(["b"], "Model");
    const before = useWorkflowStore.getState().edges;
    useWorkflowStore.getState().setEdgesLabel(["b"], " Model");
    useWorkflowStore.getState().setEdgesLabel(["nope"], "x");
    useWorkflowStore.getState().setEdgesLabel([], "x");
    expect(useWorkflowStore.getState().edges).toBe(before);
  });

  it("is undone in one step", () => {
    useWorkflowStore.getState().setEdgesLabel(["b", "c", "d"], "Model");
    useWorkflowStore.getState().undo();
    expect(labels()).toEqual([undefined, "old", undefined]);
  });
});
