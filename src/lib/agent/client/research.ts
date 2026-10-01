/**
 * The "Look up prompting tips" chip: which model the selection points at.
 * Exactly one generator with a model must be selected; anything else offers
 * nothing, rather than guessing which of several the user means.
 */

import type { WorkflowNode } from "@/types";
import type { AgentResearchTarget } from "../types";

const MODEL_NODE_TYPES = new Set(["nanoBanana", "generateVideo", "generate3d", "generateAudio"]);

export function researchTargetForSelection(nodes: readonly WorkflowNode[]): AgentResearchTarget | null {
  const selected = nodes.filter((node) => node.selected);
  if (selected.length !== 1) return null;
  const [node] = selected;
  if (!node.type || !MODEL_NODE_TYPES.has(node.type)) return null;
  const data = node.data as { selectedModel?: { provider?: unknown; modelId?: unknown; displayName?: unknown }; model?: unknown };
  const chosen = data.selectedModel;
  if (chosen && typeof chosen.modelId === "string" && chosen.modelId && typeof chosen.provider === "string" && chosen.provider) {
    const name = typeof chosen.displayName === "string" && chosen.displayName ? chosen.displayName : chosen.modelId;
    return { provider: chosen.provider, modelId: chosen.modelId, name, nodeType: node.type };
  }
  // Generate Image's Gemini models are kept as a bare id.
  if (node.type === "nanoBanana" && typeof data.model === "string" && data.model) {
    return { provider: "gemini", modelId: data.model, name: data.model, nodeType: node.type };
  }
  return null;
}

/** The user's message for a research turn: what the chat shows. */
export function researchMessage(target: AgentResearchTarget): string {
  return `Look up prompting tips for ${target.name ?? target.modelId}`;
}
