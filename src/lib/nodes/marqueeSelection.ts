/**
 * What a marquee has to cover to take a node.
 *
 * React Flow offers two rules: the whole node inside the marquee, or any
 * overlap. Neither reads right for our nodes, whose body is the media card
 * with a controls card hanging beneath it: dragging around the picture feels
 * like selecting the node, and a corner of the picture does not. So the canvas
 * runs React Flow on the overlap rule and vetoes, through this module, every
 * selection whose marquee does not hold the node's media card whole. A node
 * without a media card is taken only when it is inside whole, as before.
 */
import type { Node, NodeChange } from "@xyflow/react";

/** A rectangle in one coordinate space (here, the page's client pixels). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A node's boxes on screen: itself, and its media card when it has one. */
export interface NodeBoxes {
  node: Box;
  mediaCard: Box | null;
}

export const contains = (outer: Box, inner: Box): boolean =>
  inner.left >= outer.left && inner.right <= outer.right && inner.top >= outer.top && inner.bottom <= outer.bottom;

/** True when the marquee holds the node's body whole: its media card, else the node itself. */
export function marqueeTakesNode(marquee: Box, boxes: NodeBoxes): boolean {
  return contains(marquee, boxes.mediaCard ?? boxes.node);
}

/**
 * React Flow's selection changes for a marquee, with every "selected" that the
 * marquee has not earned turned into "not selected". Changes of other kinds,
 * deselections, and nodes that cannot be measured pass through untouched.
 */
export function refineMarqueeChanges<N extends Node>(
  changes: NodeChange<N>[],
  marquee: Box,
  boxesOf: (id: string) => NodeBoxes | null,
): NodeChange<N>[] {
  return changes.map((change) => {
    if (change.type !== "select" || !change.selected) return change;
    const boxes = boxesOf(change.id);
    if (!boxes || marqueeTakesNode(marquee, boxes)) return change;
    return { ...change, selected: false };
  });
}

export const boxOf = (rect: { left: number; top: number; right: number; bottom: number }): Box => ({
  left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
});
