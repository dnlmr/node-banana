/**
 * Carousel history entries point at files: in the asset library (by
 * `assetId`) and, for a project, in its generations folder (by `id`). Once
 * an entry can be found in neither it can never be shown again, so a loaded
 * workflow drops it.
 */

import type { WorkflowNode, WorkflowNodeData } from "@/types";
import type { AssetExistence } from "@/lib/assets/types";

interface HistoryField {
  list: string;
  index: string;
}

/** Where each node type keeps its carousel entries and the selected one. */
const HISTORY_FIELDS: Partial<Record<string, HistoryField>> = {
  nanoBanana: { list: "imageHistory", index: "selectedHistoryIndex" },
  generateVideo: { list: "videoHistory", index: "selectedVideoHistoryIndex" },
  generateAudio: { list: "audioHistory", index: "selectedAudioHistoryIndex" },
};

export interface HistoryEntry {
  id: string;
  assetId?: string;
}

function entriesOf(node: WorkflowNode): HistoryEntry[] {
  const field = HISTORY_FIELDS[node.type ?? ""];
  if (!field) return [];
  const list = (node.data as Record<string, unknown>)[field.list];
  return Array.isArray(list) ? (list as HistoryEntry[]) : [];
}

/** True when some node carries a carousel entry worth checking. */
export function hasHistoryEntries(nodes: ReadonlyArray<WorkflowNode>): boolean {
  return nodes.some((node) => entriesOf(node).length > 0);
}

/** Every asset id the carousels refer to, once each. */
export function historyAssetIds(nodes: ReadonlyArray<WorkflowNode>): string[] {
  const ids = new Set<string>();
  for (const node of nodes) {
    for (const entry of entriesOf(node)) {
      if (typeof entry?.assetId === "string" && entry.assetId) ids.add(entry.assetId);
    }
  }
  return [...ids];
}

/** What is known about where a workflow's carousel entries live. */
export interface HistorySources {
  /** The ids its generations folder holds; null when it has none or it could not be listed. */
  folderIds: ReadonlySet<string> | null;
  /** The workflow has a generations folder, whether or not it could be listed. */
  hasFolder: boolean;
  /** The asset library's answer for each asset id it was asked about. */
  assetStates: Readonly<Record<string, AssetExistence>>;
}

/**
 * Whether an entry can still be shown. Either home is enough: an asset the
 * library holds (or cannot rule out), or a file in the generations folder.
 * An entry goes only when the library says its asset is gone (or it never
 * had one) and the folder does not hold it either. Entries the folder could
 * not be asked about stay rather than be guessed away.
 */
export function isHistoryEntryAvailable(entry: HistoryEntry, sources: HistorySources): boolean {
  if (entry.assetId) {
    if ((sources.assetStates[entry.assetId] ?? "unknown") !== "gone") return true;
    if (sources.folderIds) return sources.folderIds.has(entry.id);
    return sources.hasFolder;
  }
  // An entry from before the library lives only in the folder
  if (!sources.folderIds) return true;
  return sources.folderIds.has(entry.id);
}

/**
 * Drop every carousel entry that is not available: not in `available` when
 * it is a set of folder ids, or rejected by it when it is a predicate. The
 * selected entry stays selected when it survives; otherwise the newest one is.
 */
export function pruneMissingHistory(
  nodes: ReadonlyArray<WorkflowNode>,
  available: ReadonlySet<string> | ((entry: HistoryEntry) => boolean)
): { nodes: WorkflowNode[]; changed: boolean } {
  const keep = typeof available === "function" ? available : (entry: HistoryEntry) => available.has(entry.id);
  let changed = false;
  const next = nodes.map((node) => {
    const field = HISTORY_FIELDS[node.type ?? ""];
    if (!field) return node;
    const entries = entriesOf(node);
    const kept = entries.filter((entry) => keep(entry));
    if (kept.length === entries.length) return node;
    changed = true;
    const data = node.data as Record<string, unknown>;
    const currentIndex = typeof data[field.index] === "number" ? (data[field.index] as number) : 0;
    // By identity: two entries can share a file name
    const nextIndex = Math.max(0, kept.indexOf(entries[currentIndex]));
    return {
      ...node,
      data: { ...data, [field.list]: kept, [field.index]: nextIndex } as WorkflowNodeData,
    };
  });
  return { nodes: next, changed };
}
