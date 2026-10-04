import { describe, expect, it } from "vitest";
import { estimatedNodeHeight } from "../sizes";

const gemini = (modelId: string) => ({ provider: "gemini", modelId, displayName: modelId });

describe("estimatedNodeHeight", () => {
  // NodeShell: media card (clip = width − 10, plus 10) + 8px gap + controls card
  // (2px border + 28px summary + 14px panel padding + 22px per row + 4px between rows).
  const controls = (rows: number) => 2 + 28 + (rows > 0 ? 14 + rows * 22 + (rows - 1) * 4 : 0);

  it("sizes a Gemini image node by its aspect ratio and its model's settings rows", () => {
    expect(estimatedNodeHeight("nanoBanana", { data: { selectedModel: gemini("nano-banana-2-lite"), aspectRatio: "16:9" } })).toBe(173 + 8 + controls(2));
    expect(estimatedNodeHeight("nanoBanana", { data: { selectedModel: gemini("nano-banana-2"), aspectRatio: "1:1" } })).toBe(300 + 8 + controls(5));
    expect(estimatedNodeHeight("nanoBanana", { data: { selectedModel: gemini("nano-banana-pro"), aspectRatio: "9:16" } })).toBe(516 + 10 + 8 + controls(4));
    // The legacy model field when there is no selection; the node's own width.
    expect(estimatedNodeHeight("nanoBanana", { data: { model: "nano-banana" }, width: 410 })).toBe(410 + 8 + controls(2));
  });

  it("sizes Gemini video by Veo's four settings and a node without a model by its summary row", () => {
    expect(estimatedNodeHeight("generateVideo", { data: { selectedModel: gemini("veo-3.1/image-to-video") } })).toBe(173 + 8 + controls(4));
    expect(estimatedNodeHeight("generateVideo", { data: {} })).toBe(173 + 8 + controls(0));
    expect(estimatedNodeHeight("generate3d", { data: {} })).toBe(112 + 10 + 8 + controls(0));
  });

  it("drops the panel when settings are collapsed", () => {
    expect(estimatedNodeHeight("nanoBanana", { data: { selectedModel: gemini("nano-banana-2"), aspectRatio: "1:1", parametersExpanded: false } })).toBe(300 + 8 + controls(0));
  });

  it("keeps the long-panel estimate when the settings are not known here", () => {
    expect(estimatedNodeHeight("nanoBanana")).toBe(460);
    expect(estimatedNodeHeight("nanoBanana", { data: { selectedModel: { provider: "fal", modelId: "fal-ai/flux" } } })).toBe(460);
    expect(estimatedNodeHeight("generateVideo", { data: { selectedModel: { provider: "replicate", modelId: "a/b" } } })).toBe(460);
    expect(estimatedNodeHeight("nanoBanana", { data: { selectedModel: gemini("nano-banana-9") } })).toBe(460);
    // Other types keep their default height.
    expect(estimatedNodeHeight("prompt", { data: {} })).toBe(220);
  });
});
