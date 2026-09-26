/**
 * "Open original workflow" / "Open project" for an asset.
 *
 * CONTRACT STUB — implemented by the client-core work.
 *
 * - `snapshot`: fetch the run snapshot for the asset, hydrate it, prepare it
 *   (fresh id, never bound to a folder), then `openWorkflowInNewTab`. If a
 *   tab opened earlier from the same run is still open, switch to it
 *   instead. Centres on the producing node when it exists and its output
 *   is this asset.
 * - `project`: load the project folder's workflow file
 *   (GET /api/workflow?path=…&load=true) and open it bound to the folder,
 *   or switch to a tab that already has that workflow id bound to that folder.
 *
 * Never throws. Refuses (with the reason) while `tabsBusyReason()` is set.
 * The caller switches the app back to the canvas view on `ok`.
 */

import type { AssetView } from "../types";

export type OpenWorkflowMode = "snapshot" | "project";

export type OpenWorkflowResult =
  | { ok: true; tabId: string; nodeId: string | null }
  | { ok: false; reason: string };

/** Why an asset's workflow cannot be opened right now (busy tabs, no snapshot, no project), or null. */
export function openWorkflowBlockedReason(_asset: AssetView, _mode: OpenWorkflowMode): string | null {
  return "Not implemented yet";
}

export async function openAssetWorkflow(_asset: AssetView, _mode: OpenWorkflowMode): Promise<OpenWorkflowResult> {
  return { ok: false, reason: "Not implemented yet" };
}
