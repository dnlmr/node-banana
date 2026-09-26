/**
 * Asset Recording
 *
 * What executors share to hand an output to the asset library through
 * `ctx.recordAsset`: the model, producer, cost and settings in the shape the
 * library stores them, and the carousel id swap a project folder still needs.
 */

import type {
  AssetCost,
  AssetModelRef,
  AssetProducer,
  RecordAssetInput,
  RecordAssetResult,
  RecordedAssetHandle,
} from "@/lib/assets/types";
import type { SelectedModel, WorkflowNodeData } from "@/types";
import type { NodeExecutionContext } from "./types";

/**
 * Record an output in the asset library.
 *
 * Null when the library is not recording this run — the caller then falls
 * back to the generations folder — or when the recorder refused the call: a
 * failed save must never fail a generation that has already been paid for.
 */
export function recordOutput(ctx: NodeExecutionContext, input: RecordAssetInput): RecordedAssetHandle | null {
  if (!ctx.recordAsset) return null;
  try {
    return ctx.recordAsset(input);
  } catch (error) {
    console.error("Failed to record asset:", error);
    return null;
  }
}

/** The model that ran, as the library records it. */
export function assetModel(model: SelectedModel): AssetModelRef {
  return {
    provider: model.provider,
    modelId: model.modelId,
    ...(model.displayName ? { displayName: model.displayName } : {}),
  };
}

/** The node that made an asset, with the title the user gave it, if any. */
export function assetProducer(
  ctx: NodeExecutionContext,
  extra: Omit<AssetProducer, "nodeId" | "nodeType" | "nodeTitle"> = {}
): AssetProducer {
  const { node } = ctx;
  const data = (ctx.getFreshNode(node.id)?.data ?? node.data) as { customTitle?: unknown } | undefined;
  const title = typeof data?.customTitle === "string" ? data.customTitle.trim() : "";
  return {
    nodeId: node.id,
    nodeType: node.type ?? "unknown",
    ...(title ? { nodeTitle: title } : {}),
    ...extra,
  };
}

/** A run's charge as the library stores it: an estimate unless the provider reported it. */
export function assetCost(amount: number | null | undefined, estimated = true): AssetCost | undefined {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return undefined;
  return { amount, currency: "USD", estimated };
}

/** Unbroken base64 this long is media that lost its `data:` prefix. */
const BARE_BASE64 = /^[A-Za-z0-9+/=]{1024,}$/;
const MAX_DEPTH = 4;

function scrub(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.startsWith("data:") || value.startsWith("blob:") || BARE_BASE64.test(value) ? undefined : value;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, depth + 1)).filter((item) => item !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const kept = scrub(item, depth + 1);
    if (kept !== undefined) out[key] = kept;
  }
  return out;
}

/**
 * The settings that ran, without media. A sidecar describes an asset; it is
 * never a second copy of the inputs.
 */
export function assetParameters(parameters: Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (!parameters) return undefined;
  const kept = scrub(parameters, 0) as Record<string, unknown>;
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * The prompt a request actually carried: its text input, or else the prompt a
 * model's own prompt handle supplied (which the route falls back to).
 */
export function resolvedPrompt(
  text: string | null | undefined,
  dynamicInputs: Record<string, string | string[]>
): string | undefined {
  if (typeof text === "string" && text) return text;
  const dynamic = dynamicInputs.prompt;
  const value = Array.isArray(dynamic) ? dynamic[0] : dynamic;
  return typeof value === "string" && value ? value : undefined;
}

/** Aspect ratio and resolution from a model's own parameters, where it names them. */
export function parameterFraming(parameters: Record<string, unknown> | null | undefined): {
  aspectRatio?: string;
  resolution?: string;
} {
  const aspectRatio = parameters?.aspect_ratio ?? parameters?.aspectRatio;
  const resolution = parameters?.resolution;
  return {
    ...(typeof aspectRatio === "string" && aspectRatio ? { aspectRatio } : {}),
    ...(typeof resolution === "string" && resolution ? { resolution } : {}),
  };
}

/** Width and height from a "1536x864" size string, when a provider reports one. */
export function sizeFromString(size: string | null | undefined): { width?: number; height?: number } {
  const match = typeof size === "string" ? size.match(/^(\d+)x(\d+)$/) : null;
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** The carousel fields that hold ids of files in the generations folder. */
export type CarouselField = "imageHistory" | "videoHistory" | "audioHistory";

/**
 * A project folder names its files by content, and the carousel reloads them
 * by that name. Once the recorder has written the file, the entry for this
 * asset takes that name, as it always has after a save to the folder.
 */
export function adoptLegacyId(
  ctx: NodeExecutionContext,
  field: CarouselField,
  assetId: string,
  recorded: RecordAssetResult | null
): void {
  if (!recorded?.legacyId) return;
  const currentNode = ctx.getNodes().find((n) => n.id === ctx.node.id);
  const history = (currentNode?.data as Record<string, unknown> | undefined)?.[field];
  if (!Array.isArray(history)) return;
  const index = history.findIndex((entry) => (entry as { assetId?: string } | null)?.assetId === assetId);
  if (index === -1 || history[index].id === recorded.legacyId) return;
  const next = [...history];
  next[index] = { ...next[index], id: recorded.legacyId };
  ctx.updateNodeData(ctx.node.id, { [field]: next } as Partial<WorkflowNodeData>);
}

/** Where each carousel keeps its selected entry. */
const SELECTED_INDEX: Record<CarouselField, string> = {
  imageHistory: "selectedHistoryIndex",
  videoHistory: "selectedVideoHistoryIndex",
  audioHistory: "selectedAudioHistoryIndex",
};

/**
 * A recording that failed left its carousel entry pointing at an asset the
 * library never stored. With a folder save to fall back on the entry keeps
 * its place and loses the asset id, so it lives by its file name, as a save
 * without the library always did. Without one nothing could show it again,
 * so it goes, the way a generation saved nowhere never got an entry.
 */
function forgetFailedAsset(ctx: NodeExecutionContext, field: CarouselField, assetId: string, keepEntry: boolean): void {
  const data = ctx.getNodes().find((n) => n.id === ctx.node.id)?.data as Record<string, unknown> | undefined;
  const history = data?.[field];
  if (!Array.isArray(history)) return;
  const index = history.findIndex((entry) => (entry as { assetId?: string } | null)?.assetId === assetId);
  if (index === -1) return;
  if (keepEntry) {
    const next = [...history];
    const entry = { ...(next[index] as Record<string, unknown>) };
    delete entry.assetId;
    next[index] = entry;
    ctx.updateNodeData(ctx.node.id, { [field]: next } as Partial<WorkflowNodeData>);
    return;
  }
  const selectedField = SELECTED_INDEX[field];
  const selected = typeof data?.[selectedField] === "number" ? (data[selectedField] as number) : 0;
  // The selection stays on its entry; one on the dropped entry moves to the newest
  const nextSelected = selected > index ? selected - 1 : selected === index ? 0 : selected;
  ctx.updateNodeData(ctx.node.id, {
    [field]: history.filter((_, i) => i !== index),
    [selectedField]: nextSelected,
  } as Partial<WorkflowNodeData>);
}

/** The recording's result, or null when it failed (a broken promise counts as failed). */
export function recordingResult(handle: RecordedAssetHandle): Promise<RecordAssetResult | null> {
  return handle.done.catch((error) => {
    console.error("Failed to record asset:", error);
    return null;
  });
}

/**
 * Follow the recording of a generation that has a carousel entry.
 *
 * In a project (`saveToFolder` given) it is tracked, so a workflow save waits
 * for it the way it waits for a save to the generations folder. Once the file
 * is on disk the entry takes the file's name. When the recording fails, the
 * output goes to the generations folder the way a run without the library
 * saves it, so a project's generation always lands in its folder.
 *
 * Outside a project nothing holds the tabs; a failed recording only takes its
 * entry back out of the carousel.
 */
export function followRecording(
  ctx: NodeExecutionContext,
  field: CarouselField,
  key: string,
  handle: RecordedAssetHandle,
  saveToFolder: (() => Promise<unknown>) | null
): void {
  const settled = recordingResult(handle)
    .then(async (recorded) => {
      if (recorded) {
        adoptLegacyId(ctx, field, handle.assetId, recorded);
        return;
      }
      forgetFailedAsset(ctx, field, handle.assetId, saveToFolder !== null);
      if (saveToFolder) await saveToFolder();
    })
    .catch((err) => {
      console.error("Failed to save generation:", err);
    });
  if (saveToFolder) ctx.trackSaveGeneration(key, settled);
}
