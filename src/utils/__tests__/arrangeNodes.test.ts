import { describe, it, expect } from "vitest";
import type { Node } from "@xyflow/react";
import { arrangeNodes } from "@/utils/arrangeNodes";

const node = (id: string, x: number, y: number, width = 220, height = 200): Node => ({
  id,
  type: "prompt",
  position: { x, y },
  data: {},
  measured: { width, height },
});

describe("arrangeNodes", () => {
  it("stacks horizontally in x order, aligned to the topmost node", () => {
    const changes = arrangeNodes("horizontal", [node("b", 500, 100), node("a", 100, 50, 300)], 20);
    expect(changes).toEqual([
      { type: "position", id: "a", position: { x: 100, y: 50 } },
      { type: "position", id: "b", position: { x: 420, y: 50 } },
    ]);
  });

  it("stacks vertically in y order, aligned to the leftmost node, with the default gap", () => {
    const changes = arrangeNodes("vertical", [node("b", 0, 400, 220, 150), node("a", 40, 0)]);
    expect(changes).toEqual([
      { type: "position", id: "a", position: { x: 0, y: 0 } },
      { type: "position", id: "b", position: { x: 0, y: 220 } },
    ]);
  });

  it("lays out a square-ish grid sized by the largest node", () => {
    const changes = arrangeNodes(
      "grid",
      [node("a", 0, 0), node("b", 300, 0, 260), node("c", 0, 300), node("d", 300, 300, 220, 240)],
      10
    );
    expect(changes.map((change) => change.position)).toEqual([
      { x: 0, y: 0 },
      { x: 270, y: 0 },
      { x: 0, y: 250 },
      { x: 270, y: 250 },
    ]);
  });

  it("returns nothing for no nodes", () => {
    expect(arrangeNodes("grid", [])).toEqual([]);
  });
});
