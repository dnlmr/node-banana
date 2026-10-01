import type { Node } from "@xyflow/react";
import { getNodeSize } from "@/utils/nodeDimensions";

export type Arrangement = "horizontal" | "vertical" | "grid";

/** Default space between arranged nodes, in flow pixels. */
export const STACK_GAP = 20;

export interface PositionChange {
  type: "position";
  id: string;
  position: { x: number; y: number };
}

/**
 * Position changes that lay `nodes` out in a row, a column or a grid with
 * `gap` between them, keeping their current order and top-left corner.
 */
export function arrangeNodes(mode: Arrangement, nodes: Node[], gap: number = STACK_GAP): PositionChange[] {
  if (nodes.length === 0) return [];
  if (mode === "horizontal") return stackHorizontally(nodes, gap);
  if (mode === "vertical") return stackVertically(nodes, gap);
  return arrangeAsGrid(nodes, gap);
}

function stackHorizontally(nodes: Node[], gap: number): PositionChange[] {
  // Sort by current x position to maintain relative order
  const sortedNodes = [...nodes].sort((a, b) => a.position.x - b.position.x);

  // Use the topmost y position as the alignment point
  const alignY = Math.min(...sortedNodes.map((n) => n.position.y));

  let currentX = sortedNodes[0].position.x;

  return sortedNodes.map((node) => {
    const change = { type: "position" as const, id: node.id, position: { x: currentX, y: alignY } };
    currentX += getNodeSize(node).width + gap;
    return change;
  });
}

function stackVertically(nodes: Node[], gap: number): PositionChange[] {
  // Sort by current y position to maintain relative order
  const sortedNodes = [...nodes].sort((a, b) => a.position.y - b.position.y);

  // Use the leftmost x position as the alignment point
  const alignX = Math.min(...sortedNodes.map((n) => n.position.x));

  let currentY = sortedNodes[0].position.y;

  return sortedNodes.map((node) => {
    const change = { type: "position" as const, id: node.id, position: { x: alignX, y: currentY } };
    currentY += getNodeSize(node).height + gap;
    return change;
  });
}

function arrangeAsGrid(nodes: Node[], gap: number): PositionChange[] {
  // As square as possible
  const cols = Math.ceil(Math.sqrt(nodes.length));

  // Sort nodes by their current position (top-to-bottom, left-to-right)
  const sortedNodes = [...nodes].sort((a, b) => {
    const rowA = Math.floor(a.position.y / 100);
    const rowB = Math.floor(b.position.y / 100);
    if (rowA !== rowB) return rowA - rowB;
    return a.position.x - b.position.x;
  });

  // Start at the top-left of the bounding box
  const startX = Math.min(...sortedNodes.map((n) => n.position.x));
  const startY = Math.min(...sortedNodes.map((n) => n.position.y));

  // Max node dimensions for consistent spacing
  const maxWidth = Math.max(...sortedNodes.map((n) => getNodeSize(n).width));
  const maxHeight = Math.max(...sortedNodes.map((n) => getNodeSize(n).height));

  return sortedNodes.map((node, index) => ({
    type: "position" as const,
    id: node.id,
    position: {
      x: startX + (index % cols) * (maxWidth + gap),
      y: startY + Math.floor(index / cols) * (maxHeight + gap),
    },
  }));
}
