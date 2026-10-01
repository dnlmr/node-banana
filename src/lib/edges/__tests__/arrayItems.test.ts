import { describe, expect, it } from "vitest";
import type { WorkflowEdge, WorkflowNode } from "@/types";
import {
  arrayEdgeItemIndex,
  arrayEdgeLabel,
  arrayItemWireCounts,
  arrayLabelRows,
  arrayOutputEdges,
  nextArrayItemIndex,
} from "../arrayItems";

const items = ["fox", "lighthouse", "koi", "motel"];

function edge(id: string, data: Record<string, unknown> = {}, sourceHandle: string | null = "text"): WorkflowEdge {
  return { id, source: "arr", target: `t-${id}`, sourceHandle, targetHandle: "text", data };
}

describe("arrayOutputEdges", () => {
  it("keeps only the connections leaving the node's text output", () => {
    const edges = [edge("a"), edge("b", {}, null), { ...edge("c"), source: "other" }, edge("d", {}, "image")];
    expect(arrayOutputEdges("arr", edges).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("arrayEdgeItemIndex", () => {
  it("wraps the stored index to the current count", () => {
    expect(arrayEdgeItemIndex(edge("a", { arrayItemIndex: 5 }), 4)).toBe(1);
  });

  it("is null without an index or without items", () => {
    expect(arrayEdgeItemIndex(edge("a"), 4)).toBeNull();
    expect(arrayEdgeItemIndex(edge("a", { arrayItemIndex: 1 }), 0)).toBeNull();
    expect(arrayEdgeItemIndex(edge("a", { arrayItemIndex: -1 }), 4)).toBeNull();
  });
});

describe("nextArrayItemIndex", () => {
  it("uses the pinned item", () => {
    expect(nextArrayItemIndex("arr", { outputItems: items, selectedOutputIndex: 2, batchMode: false }, [edge("a", { arrayItemIndex: 0 })])).toBe(2);
  });

  it("follows the newest connection and wraps", () => {
    const edges = [
      edge("a", { arrayItemIndex: 3, createdAt: 2 }),
      edge("b", { arrayItemIndex: 1, createdAt: 1 }),
    ];
    expect(nextArrayItemIndex("arr", { outputItems: items, selectedOutputIndex: null, batchMode: false }, edges)).toBe(0);
  });

  it("counts connections that carry no index", () => {
    expect(nextArrayItemIndex("arr", { outputItems: items, selectedOutputIndex: null, batchMode: false }, [edge("a")])).toBe(1);
  });

  it("is 0 when there are no items", () => {
    expect(nextArrayItemIndex("arr", { outputItems: [], selectedOutputIndex: null, batchMode: false }, [edge("a", { arrayItemIndex: 2 })])).toBe(0);
  });
});

describe("arrayItemWireCounts", () => {
  it("counts connections per item", () => {
    const edges = [edge("a", { arrayItemIndex: 0 }), edge("b", { arrayItemIndex: 4 }), edge("c", { arrayItemIndex: 2 })];
    expect([...arrayItemWireCounts("arr", 4, edges)]).toEqual([[0, 2], [2, 1]]);
  });
});

describe("arrayEdgeLabel", () => {
  it("names the item a connection carries", () => {
    expect(arrayEdgeLabel(edge("a", { arrayItemIndex: 6 }), { outputItems: items, selectedOutputIndex: null, batchMode: false })).toBe("Item 3");
  });

  it("says All n in batch mode", () => {
    expect(arrayEdgeLabel(edge("a", { arrayItemIndex: 1 }), { outputItems: items, selectedOutputIndex: null, batchMode: true })).toBe("All 4");
  });

  it("is null with no items, or no index outside batch mode", () => {
    expect(arrayEdgeLabel(edge("a", { arrayItemIndex: 1 }), { outputItems: [], selectedOutputIndex: null, batchMode: false })).toBeNull();
    expect(arrayEdgeLabel(edge("a"), { outputItems: items, selectedOutputIndex: null, batchMode: false })).toBeNull();
  });
});

describe("arrayLabelRows", () => {
  const nodes = (data: Record<string, unknown> = {}) =>
    [
      { id: "arr", type: "array", position: { x: 0, y: 0 }, data: { outputItems: items, selectedOutputIndex: null, batchMode: false, ...data } },
      { id: "p", type: "prompt", position: { x: 0, y: 0 }, data: {} },
    ] as unknown as WorkflowNode[];
  const into = (id: string, data: Record<string, unknown>, source = "arr"): WorkflowEdge => ({
    id, source, sourceHandle: "text", target: "gen", targetHandle: "text", data,
  });

  it("lists the Array connections whose name sits at this node", () => {
    const edges = [into("a", { arrayItemIndex: 0, createdAt: 3 }), into("other", { arrayItemIndex: 0 }, "p")];
    expect(arrayLabelRows(nodes(), edges, "gen")).toEqual([{ edgeId: "a", handleId: "text", createdAt: 3 }]);
  });

  it("skips hidden, named and loop connections, and an Array with no items", () => {
    const edges = [
      into("hidden", { arrayItemIndex: 0, hidden: true }),
      into("named", { arrayItemIndex: 0, label: "hero" }),
      into("loop", { arrayItemIndex: 0, isLoop: true }),
    ];
    expect(arrayLabelRows(nodes(), edges, "gen")).toEqual([]);
    expect(arrayLabelRows(nodes({ outputItems: [] }), [into("a", { arrayItemIndex: 0 })], "gen")).toEqual([]);
  });
});
