/**
 * Workflow snapshots for "open original workflow".
 *
 * CONTRACT STUB — implemented by the client-core work.
 *
 * A snapshot is the workflow graph with every data:/blob: media string
 * replaced by `{ $nbMedia: sha256, mime, bytes }`. http(s) strings are left
 * as they are (never dereferenced). Media bytes are hashed in the browser
 * (crypto.subtle SHA-256), the server is asked which it lacks
 * (`mediaHas`), and only those are uploaded. A bounded string→hash map
 * (rebuilt per snapshot from the strings actually found, and seeded by the
 * recorder with every recorded asset) avoids re-hashing the same strings.
 * Keys named `$nbMedia` already present in node data are escaped on encode
 * so a crafted workflow cannot inject refs.
 */

import type { WorkflowFile } from "@/store/workflowStore";
import type { AssetView, SnapshotWorkflow } from "../types";

/** The parts of the store a snapshot needs, held by reference (zustand state is immutable). */
export interface CapturedGraph {
  nodes: unknown[];
  edges: unknown[];
  groups?: Record<string, unknown>;
  edgeStyle: string;
  edgeAppearance?: unknown;
  workflowId: string;
  workflowName: string | null;
}

/** Synchronous: reads the fields, copies nothing. */
export function captureGraph(_state: {
  nodes: unknown[];
  edges: unknown[];
  groups?: Record<string, unknown>;
  edgeStyle: string;
  edgeAppearance?: unknown;
  workflowId: string | null;
  workflowName: string | null;
}): CapturedGraph {
  throw new Error("captureGraph is not implemented yet");
}

export interface EncodedSnapshot {
  workflow: SnapshotWorkflow;
  mediaHashes: string[];
}

/** Replaces media with refs and uploads any bytes the server lacks. Strips `selected`, run status, jobs and abort controllers. */
export async function encodeSnapshot(_graph: CapturedGraph): Promise<EncodedSnapshot> {
  throw new Error("encodeSnapshot is not implemented yet");
}

/** Remember that `media` (a data: URL string) has this hash, so snapshots do not hash or upload it again. */
export function rememberMediaHash(_media: string, _sha256: string, _mime: string, _bytes: number): void {
  throw new Error("rememberMediaHash is not implemented yet");
}

/** Refs → data: URLs (videos over 20 MB → blob: URLs). */
export async function hydrateSnapshot(_workflow: SnapshotWorkflow): Promise<WorkflowFile> {
  throw new Error("hydrateSnapshot is not implemented yet");
}

/**
 * Makes a hydrated snapshot safe to open as a new, unsaved workflow:
 * fresh id, no directoryPath, name "<name> (27 Sep 14:32)", statuses reset
 * (loading/running → idle; jobId, runStatus, abortController, selected
 * dropped), and `assetMedia` injected into the producing node's output
 * field (plus its carousel selection when the node has one).
 */
export function prepareWorkflowForOpen(
  _file: WorkflowFile,
  _options: { asset: AssetView; assetMedia: string | null; openedAt: number },
): WorkflowFile {
  throw new Error("prepareWorkflowForOpen is not implemented yet");
}
