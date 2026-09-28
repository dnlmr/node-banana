/**
 * Where the canvas looks when a workflow is opened from a file. The file
 * carries no viewport, and the previous graph's view is usually somewhere
 * the new nodes are not, so the graph is framed at a fixed zoom: centred if it
 * fits, otherwise with its left (and top) edge at the margin, so the start of
 * the graph is on screen and the rest runs off to the right.
 */

/** The zoom a freshly opened graph is shown at. */
export const LOADED_GRAPH_ZOOM = 0.8;
/** Clearance from the canvas's edges when the graph does not fit. */
export const LOADED_GRAPH_MARGIN = 64;

export interface GraphBounds {
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

/** The viewport for a graph with these bounds (flow units) on a canvas this size (pixels), or null for an empty graph. */
export function frameLoadedGraph(bounds: GraphBounds, canvasWidth: number, canvasHeight: number): Viewport | null {
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) return null;
  const zoom = LOADED_GRAPH_ZOOM;
  const graphWidth = bounds.width * zoom;
  const graphHeight = bounds.height * zoom;
  const fitsAcross = graphWidth + LOADED_GRAPH_MARGIN * 2 <= canvasWidth;
  const fitsDown = graphHeight + LOADED_GRAPH_MARGIN * 2 <= canvasHeight;
  const left = fitsAcross ? (canvasWidth - graphWidth) / 2 : LOADED_GRAPH_MARGIN;
  const top = fitsDown ? (canvasHeight - graphHeight) / 2 : LOADED_GRAPH_MARGIN;
  return {
    x: Math.round(left - bounds.x * zoom),
    y: Math.round(top - bounds.y * zoom),
    zoom,
  };
}
