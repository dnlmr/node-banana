import { describe, it, expect } from "vitest";
import { frameLoadedGraph, LOADED_GRAPH_MARGIN, LOADED_GRAPH_ZOOM } from "../frameGraph";

const box = (x: number, y: number, width = 300, height = 200) => ({ x, y, width, height });

describe("frameLoadedGraph", () => {
  it("shows a loaded graph at 0.8", () => {
    expect(LOADED_GRAPH_ZOOM).toBe(0.8);
    expect(frameLoadedGraph([box(0, 0, 100, 100)], 1000, 800)?.zoom).toBe(0.8);
  });

  it("centres a graph that fits the canvas", () => {
    // 500 × 300 flow units → 400 × 240 on screen, centred in 1440 × 900, offset by the graph's own origin
    const viewport = frameLoadedGraph([box(200, -100, 500, 300)], 1440, 900);
    expect(viewport).toEqual({ x: 520 - 160, y: 330 + 80, zoom: 0.8 });
  });

  it("puts the left of a wide graph at the margin, so the graph's start is on screen", () => {
    // 4000 flow units wide → 3200 on screen, wider than the canvas
    const viewport = frameLoadedGraph([box(1000, 0, 4000, 300)], 1440, 900);
    expect(viewport?.x).toBe(LOADED_GRAPH_MARGIN - 800);
    // Still centred vertically, since it fits that way
    expect(viewport?.y).toBe(330);
  });

  it("puts the top of a tall graph at the margin too", () => {
    const viewport = frameLoadedGraph([box(0, 500, 300, 3000)], 1440, 900);
    expect(viewport?.y).toBe(LOADED_GRAPH_MARGIN - 400);
    expect(viewport?.x).toBe(600);
  });

  it("starts a big graph at its top band's leftmost node, not at an empty corner", () => {
    // The shape of a real workflow: five groups stacked down the canvas, the
    // top one starting far to the right of the leftmost node lower down. The
    // bounding box's corner (-1054, 1150) holds nothing.
    const nodes = [
      box(1820, 1619), box(2240, 1618), box(2680, 1150), box(2680, 1462), box(2680, 1774), box(3080, 1579),
      box(-1054, 5898), box(-615, 5881), box(80, 5404), box(80, 7582), box(1820, 8975), box(4860, 11097),
    ];
    const viewport = frameLoadedGraph(nodes, 1440, 900)!;
    // The top band (900 / 0.8 = 1125 flow units from y 1150) runs to y 2275; its leftmost node is at x 1820.
    expect(viewport.x).toBe(LOADED_GRAPH_MARGIN - 1820 * 0.8);
    expect(viewport.y).toBe(LOADED_GRAPH_MARGIN - 1150 * 0.8);
    // Everything in that band is in the first view.
    const onScreen = nodes.filter((b) => {
      const l = b.x * 0.8 + viewport.x, t = b.y * 0.8 + viewport.y;
      return l >= 0 && t >= 0 && l + b.width * 0.8 <= 1440 && t + b.height * 0.8 <= 900;
    });
    expect(onScreen.length).toBe(6);
  });

  it("ignores nodes that are not measured yet", () => {
    expect(frameLoadedGraph([box(0, 0, 0, 0), box(100, 100, 200, 100)], 1440, 900)).toEqual(frameLoadedGraph([box(100, 100, 200, 100)], 1440, 900));
  });

  it("has nothing to frame for an empty graph", () => {
    expect(frameLoadedGraph([], 1440, 900)).toBeNull();
    expect(frameLoadedGraph([box(0, 0, 0, 0)], 1440, 900)).toBeNull();
  });
});
