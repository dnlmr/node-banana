import type { ArrayNodeData, WorkflowEdge, WorkflowNode } from "@/types";
import { edgeGraphIndex, nodeGraphIndex } from "./graphIndex";
import type { HandleLabelRow } from "./labels";

/**
 * Which Array item each outgoing connection carries. An Array node has one
 * `text` output; every connection from it records `arrayItemIndex`, and the
 * target reads `outputItems[index % length]` (see connectedInputs.ts). In
 * batch mode every connection carries all the items instead.
 */

type ArraySource = Pick<ArrayNodeData, "outputItems" | "selectedOutputIndex" | "batchMode">;

function isIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** The connections leaving an Array node's item output. */
export function arrayOutputEdges(nodeId: string, edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.filter((e) => e.source === nodeId && (e.sourceHandle || "text") === "text");
}

/** The item a connection carries, wrapped to the current count; null when it has no index or there are no items. */
export function arrayEdgeItemIndex(edge: WorkflowEdge, itemCount: number): number | null {
  const index = edge.data?.arrayItemIndex;
  if (!isIndex(index) || itemCount <= 0) return null;
  return index % itemCount;
}

/**
 * The index the next new connection from this node will record: the pinned
 * item when there is one, otherwise the one after the newest connection's.
 */
export function nextArrayItemIndex(nodeId: string, data: ArraySource, edges: WorkflowEdge[]): number {
  const count = data.outputItems?.length ?? 0;
  const selected = data.selectedOutputIndex;
  if (isIndex(selected) && (count === 0 || selected < count)) return selected;
  if (count === 0) return 0;

  const outgoing = arrayOutputEdges(nodeId, edges);
  const newest = outgoing.reduce<WorkflowEdge | null>((latest, edge) => {
    if (!latest) return edge;
    const latestTime = latest.data?.createdAt;
    const edgeTime = edge.data?.createdAt;
    return typeof edgeTime === "number" && typeof latestTime === "number" && edgeTime > latestTime ? edge : latest;
  }, null);
  const lastIndex = newest?.data?.arrayItemIndex;
  const start = isIndex(lastIndex) ? lastIndex + 1 : outgoing.length;
  return start % count;
}

/** How many connections carry each item, by index. */
export function arrayItemWireCounts(nodeId: string, itemCount: number, edges: WorkflowEdge[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const edge of arrayOutputEdges(nodeId, edges)) {
    const index = arrayEdgeItemIndex(edge, itemCount);
    if (index !== null) counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  return counts;
}

/** The label a connection from an Array node wears: "Item 2", or "All 7" in batch mode. */
export function arrayEdgeLabel(edge: WorkflowEdge, data: ArraySource): string | null {
  const count = data.outputItems?.length ?? 0;
  if (count === 0) return null;
  if (data.batchMode) return `All ${count}`;
  const index = arrayEdgeItemIndex(edge, count);
  return index === null ? null : `Item ${index + 1}`;
}

/**
 * The item names that sit at the target ends of the visible Array connections
 * into a node, as rows for the hidden-stub stack beside its handles. Matches
 * when EditableEdge draws the name there: no typed label, not a loop, and the
 * Array has items. Reads the edges through their index, so it stays cheap on
 * every store update.
 */
export function arrayLabelRows(nodes: WorkflowNode[], edges: WorkflowEdge[], targetId: string): HandleLabelRow[] {
  const candidates = edgeGraphIndex(edges).itemEdgesByTarget.get(targetId);
  if (!candidates) return [];
  const { byId } = nodeGraphIndex(nodes);
  const rows: HandleLabelRow[] = [];
  for (const edge of candidates) {
    const source = byId.get(edge.source);
    if (source?.type !== "array" || !arrayEdgeLabel(edge, source.data as ArrayNodeData)) continue;
    rows.push({ edgeId: edge.id, handleId: edge.targetHandle ?? null, createdAt: edge.data?.createdAt || 0 });
  }
  return rows;
}
