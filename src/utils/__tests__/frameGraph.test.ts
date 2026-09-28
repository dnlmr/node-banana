import { describe, it, expect } from "vitest";
import { frameLoadedGraph, LOADED_GRAPH_MARGIN, LOADED_GRAPH_ZOOM } from "../frameGraph";

describe("frameLoadedGraph", () => {
  it("shows a loaded graph at 0.8", () => {
    expect(LOADED_GRAPH_ZOOM).toBe(0.8);
    expect(frameLoadedGraph({ x: 0, y: 0, width: 100, height: 100 }, 1000, 800)?.zoom).toBe(0.8);
  });

  it("centres a graph that fits the canvas", () => {
    // 500 × 300 flow units → 400 × 240 on screen, centred in 1440 × 900, offset by the graph's own origin
    const viewport = frameLoadedGraph({ x: 200, y: -100, width: 500, height: 300 }, 1440, 900);
    expect(viewport).toEqual({ x: 520 - 160, y: 330 + 80, zoom: 0.8 });
  });

  it("puts the left of a wide graph at the margin, so the graph's start is on screen", () => {
    // 4000 flow units wide → 3200 on screen, wider than the canvas
    const viewport = frameLoadedGraph({ x: 1000, y: 0, width: 4000, height: 300 }, 1440, 900);
    expect(viewport?.x).toBe(LOADED_GRAPH_MARGIN - 800);
    // Still centred vertically, since it fits that way
    expect(viewport?.y).toBe(330);
  });

  it("puts the top of a tall graph at the margin too", () => {
    const viewport = frameLoadedGraph({ x: 0, y: 500, width: 300, height: 3000 }, 1440, 900);
    expect(viewport?.y).toBe(LOADED_GRAPH_MARGIN - 400);
    expect(viewport?.x).toBe(600);
  });

  it("has nothing to frame for an empty graph", () => {
    expect(frameLoadedGraph({ x: 0, y: 0, width: 0, height: 0 }, 1440, 900)).toBeNull();
    expect(frameLoadedGraph({ x: Infinity, y: Infinity, width: -Infinity, height: -Infinity }, 1440, 900)).toBeNull();
  });
});
