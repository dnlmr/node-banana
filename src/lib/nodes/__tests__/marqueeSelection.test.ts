import { describe, it, expect } from "vitest";
import { contains, marqueeTakesNode, refineMarqueeChanges, type Box, type NodeBoxes } from "../marqueeSelection";

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
// A generate node: a 300×200 media card with a 300×120 controls card beneath it.
const generate: NodeBoxes = { node: box(100, 100, 400, 420), mediaCard: box(100, 100, 400, 300) };
// A logic node: no media card.
const logic: NodeBoxes = { node: box(500, 100, 700, 200), mediaCard: null };

describe("marqueeTakesNode", () => {
  it("takes a node whose media card is inside whole, even with its controls card outside", () => {
    expect(marqueeTakesNode(box(90, 90, 410, 310), generate)).toBe(true);
  });

  it("does not take a node whose media card is only partly inside", () => {
    expect(marqueeTakesNode(box(90, 90, 410, 250), generate)).toBe(false);
    expect(marqueeTakesNode(box(200, 90, 410, 310), generate)).toBe(false);
  });

  it("takes a node without a media card only when the whole node is inside", () => {
    expect(marqueeTakesNode(box(490, 90, 710, 210), logic)).toBe(true);
    expect(marqueeTakesNode(box(490, 90, 650, 210), logic)).toBe(false);
  });

  it("contains is inclusive of the edges", () => {
    expect(contains(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(true);
  });
});

describe("refineMarqueeChanges", () => {
  const boxes: Record<string, NodeBoxes> = { generate, logic };
  const boxesOf = (id: string) => boxes[id] ?? null;

  it("turns an unearned selection into a deselection and leaves the rest alone", () => {
    const marquee = box(90, 90, 410, 250); // half the generate node's picture
    const out = refineMarqueeChanges(
      [
        { type: "select", id: "generate", selected: true },
        { type: "select", id: "logic", selected: false },
        { type: "position", id: "generate", position: { x: 0, y: 0 } },
      ],
      marquee,
      boxesOf,
    );
    expect(out).toEqual([
      { type: "select", id: "generate", selected: false },
      { type: "select", id: "logic", selected: false },
      { type: "position", id: "generate", position: { x: 0, y: 0 } },
    ]);
  });

  it("keeps a selection the marquee earned, and one for a node it cannot measure", () => {
    const marquee = box(90, 90, 410, 310);
    const out = refineMarqueeChanges(
      [
        { type: "select", id: "generate", selected: true },
        { type: "select", id: "unknown", selected: true },
      ],
      marquee,
      boxesOf,
    );
    expect(out.map((c) => (c.type === "select" ? c.selected : null))).toEqual([true, true]);
  });
});
