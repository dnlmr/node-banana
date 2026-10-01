import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "@/types";
import { researchMessage, researchTargetForSelection } from "../research";

const node = (id: string, type: string, data: Record<string, unknown>, selected = true) =>
  ({ id, type, position: { x: 0, y: 0 }, data, selected }) as unknown as WorkflowNode;

describe("researchTargetForSelection", () => {
  it("names the one selected generator's model", () => {
    const nodes = [
      node("v", "generateVideo", { selectedModel: { provider: "fal", modelId: "fal-ai/kling/i2v", displayName: "Kling I2V" } }),
      node("p", "prompt", {}, false),
    ];
    expect(researchTargetForSelection(nodes)).toEqual({ provider: "fal", modelId: "fal-ai/kling/i2v", name: "Kling I2V", nodeType: "generateVideo" });
  });

  it("reads Generate Image's bare Gemini id", () => {
    expect(researchTargetForSelection([node("g", "nanoBanana", { model: "nano-banana-pro" })])).toEqual({
      provider: "gemini",
      modelId: "nano-banana-pro",
      name: "nano-banana-pro",
      nodeType: "nanoBanana",
    });
  });

  it("offers nothing for no model, another node type, or several selected", () => {
    expect(researchTargetForSelection([node("v", "generateVideo", {})])).toBeNull();
    expect(researchTargetForSelection([node("p", "prompt", { model: "x" })])).toBeNull();
    const kling = { selectedModel: { provider: "fal", modelId: "k" } };
    expect(researchTargetForSelection([node("a", "generateVideo", kling), node("b", "generateVideo", kling)])).toBeNull();
  });

  it("phrases the chat message", () => {
    expect(researchMessage({ provider: "fal", modelId: "k", name: "Kling I2V" })).toBe("Look up prompting tips for Kling I2V");
  });
});
