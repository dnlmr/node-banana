import { describe, it, expect, beforeEach } from "vitest";
import { useWorkflowStore } from "../workflowStore";
import type { WorkflowEdge } from "@/types";

const initial = useWorkflowStore.getState();
const edge = (id: string, data: Record<string, unknown> = {}, selected = false): WorkflowEdge =>
  ({ id, source: "a", sourceHandle: "text", target: id, targetHandle: "text", data, selected });

describe("setEdgesHidden", () => {
  beforeEach(() => {
    useWorkflowStore.setState({ ...initial, nodes: [], edges: [edge("b", {}, true), edge("c")], groups: {} });
  });

  it("hides the given edges and drops their selection", () => {
    useWorkflowStore.getState().setEdgesHidden(["b"], true);
    const b = useWorkflowStore.getState().edges.find((e) => e.id === "b");
    expect(b?.data?.hidden).toBe(true);
    expect(b?.selected).toBe(false);
    expect(useWorkflowStore.getState().edges.find((e) => e.id === "c")?.data?.hidden).toBeUndefined();
  });

  it("shows them again and can be undone", () => {
    useWorkflowStore.getState().setEdgesHidden(["b", "c"], true);
    useWorkflowStore.getState().setEdgesHidden(["c"], false);
    expect(useWorkflowStore.getState().edges.map((e) => Boolean(e.data?.hidden))).toEqual([true, false]);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().edges.map((e) => Boolean(e.data?.hidden))).toEqual([true, true]);
  });

  it("does nothing when every edge already matches", () => {
    const before = useWorkflowStore.getState().edges;
    useWorkflowStore.getState().setEdgesHidden(["c"], false);
    expect(useWorkflowStore.getState().edges).toBe(before);
  });
});

describe("hiding a noodle beside a labelled stack", () => {
  const wire = (id: string, data: Record<string, unknown> = {}, sourceHandle = "image"): WorkflowEdge =>
    ({ id, source: "img", sourceHandle, target: id, targetHandle: "image", data, selected: false });

  beforeEach(() => {
    useWorkflowStore.setState({ ...initial, nodes: [], groups: {}, edges: [
      wire("m1", { hidden: true, label: "Model" }),
      wire("m2", { hidden: true, label: "Model" }),
      wire("fresh"),
      wire("named", { label: "Backdrop" }),
      wire("other-handle", {}, "reference"),
    ] });
  });

  const label = (id: string) => useWorkflowStore.getState().edges.find((e) => e.id === id)?.data?.label;

  it("takes the label every hidden noodle on that handle already carries", () => {
    useWorkflowStore.getState().setEdgesHidden(["fresh"], true);
    expect(label("fresh")).toBe("Model");
  });

  it("keeps its own label, and leaves a different handle alone", () => {
    useWorkflowStore.getState().setEdgesHidden(["named", "other-handle"], true);
    expect(label("named")).toBe("Backdrop");
    expect(label("other-handle")).toBeUndefined();
  });

  it("inherits nothing when the hidden noodles disagree, or none is hidden", () => {
    useWorkflowStore.setState({ edges: [wire("m1", { hidden: true, label: "Model" }), wire("m2", { hidden: true, label: "Look" }), wire("fresh")] });
    useWorkflowStore.getState().setEdgesHidden(["fresh"], true);
    expect(label("fresh")).toBeUndefined();
    useWorkflowStore.setState({ edges: [wire("m1", { label: "Model" }), wire("fresh")] });
    useWorkflowStore.getState().setEdgesHidden(["fresh"], true);
    expect(label("fresh")).toBeUndefined();
  });

  it("is one undo step with the hide", () => {
    useWorkflowStore.getState().setEdgesHidden(["fresh"], true);
    useWorkflowStore.getState().undo();
    const fresh = useWorkflowStore.getState().edges.find((e) => e.id === "fresh");
    expect(fresh?.data?.hidden).toBeUndefined();
    expect(fresh?.data?.label).toBeUndefined();
  });
});

describe("setAllEdgesHidden", () => {
  beforeEach(() => {
    useWorkflowStore.setState({ ...initial, nodes: [], edges: [edge("b"), edge("c", { hidden: true })], groups: {} });
  });

  it("hides and shows every edge", () => {
    useWorkflowStore.getState().setAllEdgesHidden(true);
    expect(useWorkflowStore.getState().edges.every((e) => e.data?.hidden)).toBe(true);
    useWorkflowStore.getState().setAllEdgesHidden(false);
    expect(useWorkflowStore.getState().edges.some((e) => e.data?.hidden)).toBe(false);
  });

  it("does nothing when nothing would change", () => {
    useWorkflowStore.getState().setAllEdgesHidden(false);
    const before = useWorkflowStore.getState().edges;
    useWorkflowStore.getState().setAllEdgesHidden(false);
    expect(useWorkflowStore.getState().edges).toBe(before);
  });
});

describe("setHoveredHandle", () => {
  it("stores the handle under the pointer and ignores repeats", () => {
    useWorkflowStore.setState({ ...initial, hoveredHandle: null });
    useWorkflowStore.getState().setHoveredHandle({ nodeId: "a", handleId: "image", type: "source" });
    const first = useWorkflowStore.getState().hoveredHandle;
    expect(first).toEqual({ nodeId: "a", handleId: "image", type: "source" });
    useWorkflowStore.getState().setHoveredHandle({ nodeId: "a", handleId: "image", type: "source" });
    expect(useWorkflowStore.getState().hoveredHandle).toBe(first);
    useWorkflowStore.getState().setHoveredHandle(null);
    expect(useWorkflowStore.getState().hoveredHandle).toBeNull();
  });
});

describe("setExpandedStubGroup", () => {
  it("remembers which handle's hidden connections are expanded", () => {
    useWorkflowStore.setState({ ...initial, expandedStubGroup: null });
    useWorkflowStore.getState().setExpandedStubGroup("b:target:image");
    expect(useWorkflowStore.getState().expandedStubGroup).toBe("b:target:image");
    useWorkflowStore.getState().setExpandedStubGroup(null);
    expect(useWorkflowStore.getState().expandedStubGroup).toBeNull();
  });
});

describe("setStubGroupWidth", () => {
  it("records a collapsed pill's width by group key without churning on repeats", () => {
    useWorkflowStore.setState({ ...initial, stubGroupWidths: {} });
    useWorkflowStore.getState().setStubGroupWidth("b:target:image", 80);
    const widths = useWorkflowStore.getState().stubGroupWidths;
    expect(widths).toEqual({ "b:target:image": 80 });
    useWorkflowStore.getState().setStubGroupWidth("b:target:image", 80);
    expect(useWorkflowStore.getState().stubGroupWidths).toBe(widths);
  });
});
