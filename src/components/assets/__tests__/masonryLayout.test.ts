import { describe, expect, it } from "vitest";
import {
  fitColumns,
  layoutGrid,
  masonry,
  neighbourIndex,
  tileAspect,
  visibleIndices,
  type GridLayoutOptions,
  type MasonryItem,
} from "../masonryLayout";

const at = (day: number, hour = 12) => new Date(2026, 8, day, hour).getTime();

const image = (id: string, width: number, height: number, createdAt = at(27)): MasonryItem => ({
  id,
  kind: "image",
  width,
  height,
  createdAt,
});

describe("tileAspect", () => {
  it("uses the recorded dimensions when known", () => {
    expect(tileAspect({ kind: "image", width: 200, height: 100 })).toBe(0.5);
    expect(tileAspect({ kind: "video", width: 1080, height: 1920 })).toBeCloseTo(1920 / 1080);
  });

  it("falls back by kind: video 16:9, audio 2:1, 3D and the rest square", () => {
    expect(tileAspect({ kind: "video" })).toBeCloseTo(9 / 16);
    expect(tileAspect({ kind: "audio" })).toBe(0.5);
    // Audio is always the strip, even with dimensions from a cover
    expect(tileAspect({ kind: "audio", width: 100, height: 100 })).toBe(0.5);
    expect(tileAspect({ kind: "3d" })).toBe(1);
    expect(tileAspect({ kind: "image" })).toBe(1);
    expect(tileAspect({ kind: "image", width: 0, height: 10 })).toBe(1);
  });

  it("clamps extreme shapes", () => {
    expect(tileAspect({ kind: "image", width: 100, height: 1000 })).toBe(3);
    expect(tileAspect({ kind: "image", width: 1000, height: 100 })).toBeCloseTo(1 / 3);
  });
});

describe("masonry", () => {
  it("puts each tile in the shortest column, leftmost on a tie", () => {
    const items = [image("a", 100, 100), image("b", 100, 200), image("c", 100, 100), image("d", 100, 100), image("e", 100, 100)];
    const result = masonry(items, 3, 100, 10);
    expect(result.tiles.map((tile) => tile.column)).toEqual([0, 1, 2, 0, 2]);
    expect(result.tiles[3]).toEqual({ x: 0, y: 110, width: 100, height: 100, column: 0 });
    expect(result.tiles[4]).toEqual({ x: 220, y: 110, width: 100, height: 100, column: 2 });
    // Column 1 holds the tall one: 200px; columns 0 and 2: 100 + 10 + 100
    expect(result.height).toBe(210);
    expect(result.columns).toEqual([[0, 3], [1], [2, 4]]);
  });

  it("gives the same result placing a page at a time as all at once", () => {
    const items = Array.from({ length: 450 }, (_, i) => image(`a${i}`, 100 + ((i * 37) % 200), 100 + ((i * 53) % 300)));
    const all = masonry(items, 4, 180, 8);
    let step = masonry(items.slice(0, 200), 4, 180, 8);
    step = masonry(items.slice(0, 400), 4, 180, 8, step);
    step = masonry(items, 4, 180, 8, step);
    expect(step).toEqual(all);
  });

  it("never moves a tile already placed when a page is appended", () => {
    const items = Array.from({ length: 20 }, (_, i) => image(`a${i}`, 100, 50 + i * 10));
    const first = masonry(items.slice(0, 10), 3, 100, 8);
    const second = masonry(items, 3, 100, 8, first);
    expect(second.tiles.slice(0, 10)).toEqual(first.tiles);
    // The previous result is not mutated
    expect(first.tiles).toHaveLength(10);
  });

  it("starts over when the column geometry changes", () => {
    const items = [image("a", 100, 100), image("b", 100, 100)];
    const three = masonry(items, 3, 100, 8);
    const two = masonry(items, 2, 150, 8, three);
    expect(two).toEqual(masonry(items, 2, 150, 8));
  });
});

describe("fitColumns", () => {
  it("fits as many columns as are near the target width and stretches them to fill", () => {
    expect(fitColumns(1000, 240, 8)).toEqual({ columnCount: 4, columnWidth: (1000 - 24) / 4 });
    expect(fitColumns(100, 240, 8).columnCount).toBe(1);
  });
});

describe("layoutGrid", () => {
  const options: GridLayoutOptions = { columnCount: 2, columnWidth: 100, gap: 10, headerHeight: 30, sectionGap: 20 };

  it("splits the list into day sections, each its own masonry under a header", () => {
    const items = [image("a", 100, 100, at(27, 15)), image("b", 100, 100, at(27, 9)), image("c", 100, 200, at(26, 20))];
    const layout = layoutGrid(items, options);
    expect(layout.sections.map((section) => [section.key, section.start, section.masonry.tiles.length])).toEqual([
      ["2026-09-27", 0, 2],
      ["2026-09-26", 2, 1],
    ]);
    // Second section: under the first (header 30 + block 100) and the section gap
    expect(layout.sections[1]!.top).toBe(30 + 100 + 20);
    expect(layout.height).toBe(150 + 30 + 200);
  });

  it("continues the last day across pages and matches a full layout", () => {
    const items = [
      image("a", 100, 100, at(27, 15)),
      image("b", 100, 150, at(27, 14)),
      image("c", 100, 120, at(27, 13)),
      image("d", 100, 100, at(26, 12)),
      image("e", 100, 90, at(26, 11)),
      image("f", 100, 100, at(25, 10)),
    ];
    const full = layoutGrid(items, options);
    let paged = layoutGrid(items.slice(0, 2), options);
    paged = layoutGrid(items.slice(0, 4), options, paged);
    paged = layoutGrid(items, options, paged);
    expect(paged).toEqual(full);
  });

  it("finds visible tiles by binary search, in item order", () => {
    const items = Array.from({ length: 40 }, (_, i) => image(`a${i}`, 100, 100));
    const layout = layoutGrid(items, options);
    // Header 30, then rows of 100 + 10 gap, two per row
    expect(visibleIndices(layout, 0, 50)).toEqual([0, 1]);
    expect(visibleIndices(layout, 30 + 110 * 3 + 5, 30 + 110 * 3 + 95)).toEqual([6, 7]);
    expect(visibleIndices(layout, 10_000, 20_000)).toEqual([]);
  });

  it("walks the sort order sideways and the column up and down, across sections", () => {
    const items = [
      image("a", 100, 100, at(27)),
      image("b", 100, 100, at(27)),
      image("c", 100, 100, at(27)),
      image("d", 100, 100, at(26)),
    ];
    const layout = layoutGrid(items, options);
    expect(neighbourIndex(layout, 0, "right")).toBe(1);
    expect(neighbourIndex(layout, 0, "left")).toBeNull();
    expect(neighbourIndex(layout, 0, "down")).toBe(2);
    expect(neighbourIndex(layout, 2, "up")).toBe(0);
    // b sits in column 1; the next day has only column 0
    expect(neighbourIndex(layout, 1, "down")).toBe(3);
    expect(neighbourIndex(layout, 3, "up")).toBe(2);
    expect(neighbourIndex(layout, 3, "down")).toBeNull();
  });
});
