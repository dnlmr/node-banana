/**
 * Where the canvas looks when a workflow is opened from a file. The file
 * carries no viewport, and the previous graph's view is usually somewhere
 * the new nodes are not, so the graph is framed at a fixed zoom: centred if it
 * fits, otherwise starting at the top-left of the graph with the rest running
 * off to the right and below.
 *
 * "Top-left of the graph" is a node, not the bounding box's corner: a big
 * graph's corner is often empty (its top row starts far to the right of its
 * leftmost node), and a view of that corner shows nothing. So the view starts
 * at the leftmost node of the graph's top band, one screen tall, which keeps
 * the topmost node on screen too.
 */

/** The zoom a freshly opened graph is shown at. */
export const LOADED_GRAPH_ZOOM = 0.8;
/** Clearance from the canvas's edges when the graph does not fit. */
export const LOADED_GRAPH_MARGIN = 64;

/** A node's box in flow units. */
export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

const usable = (box: NodeBox) =>
  Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width) && Number.isFinite(box.height) && box.width > 0 && box.height > 0;

/** The viewport for a graph of these nodes (flow units) on a canvas this size (pixels), or null for an empty graph. */
export function frameLoadedGraph(nodes: NodeBox[], canvasWidth: number, canvasHeight: number): Viewport | null {
  const boxes = nodes.filter(usable);
  if (!boxes.length) return null;
  const zoom = LOADED_GRAPH_ZOOM;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  const graphWidth = (right - left) * zoom;
  const graphHeight = (bottom - top) * zoom;
  const fitsAcross = graphWidth + LOADED_GRAPH_MARGIN * 2 <= canvasWidth;
  const fitsDown = graphHeight + LOADED_GRAPH_MARGIN * 2 <= canvasHeight;

  // The graph's start: the leftmost node among those in the top band (one
  // screen tall from the topmost node), so that node and the topmost are both
  // in the first view. When the graph fits, the box is simply centred.
  const band = canvasHeight / zoom;
  const startX = boxes.filter((b) => b.y <= top + band).reduce((min, b) => Math.min(min, b.x), Infinity);

  return {
    x: Math.round(fitsAcross ? (canvasWidth - graphWidth) / 2 - left * zoom : LOADED_GRAPH_MARGIN - startX * zoom),
    y: Math.round(fitsDown ? (canvasHeight - graphHeight) / 2 - top * zoom : LOADED_GRAPH_MARGIN - top * zoom),
    zoom,
  };
}
