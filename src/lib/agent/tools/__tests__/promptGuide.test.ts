// @vitest-environment node
/** get_prompt_guide through the tool runtime: the node's type, model, inputs and saved notes pick the guide. */

import { describe, expect, it } from "vitest";
import type { ProviderModel } from "@/lib/providers/types";
import type { ModelSource } from "../modelSearch";
import { createAgentToolRuntime } from "../runtime";
import { memoryPromptNotesStore } from "../../prompting/notesStore";
import { call, sequentialIds, snapshotOf, storeEdge, storeNode, type StoreState } from "./testUtils";

const KLING: ProviderModel = {
  id: "fal-ai/kling/i2v",
  name: "Kling I2V",
  description: "Animates a start image.",
  provider: "fal",
  capabilities: ["image-to-video"],
};
const KOKORO: ProviderModel = { id: "fal-ai/kokoro", name: "Kokoro TTS", description: "Text to speech.", provider: "fal", capabilities: ["text-to-audio"] };

const source: ModelSource = {
  async listModels(query) {
    const models = [KLING, KOKORO].filter((m) => !query.search || `${m.id} ${m.name}`.toLowerCase().includes(query.search.toLowerCase()));
    return { ok: true, models, providers: { fal: { success: true, count: models.length } }, availableProviders: ["fal"], cached: false };
  },
  async getModelSchema(_provider, modelId) {
    if (modelId === KLING.id) {
      return {
        ok: true,
        cached: false,
        parameters: [{ name: "negative_prompt", type: "string" }],
        inputs: [
          { name: "prompt", type: "text", required: true, label: "Prompt" },
          { name: "image_url", type: "image", required: true, label: "Start image" },
        ],
      };
    }
    return { ok: true, cached: false, parameters: [{ name: "voice", type: "string" }], inputs: [{ name: "text", type: "text", required: true, label: "Text" }] };
  },
};

function runtime(state: StoreState, notes = memoryPromptNotesStore()) {
  return createAgentToolRuntime(snapshotOf(state), { randomId: sequentialIds(), providerKeys: { fal: "fal-key" }, modelSource: source, promptNotes: notes });
}

const klingNode = (id: string) =>
  storeNode(id, "generateVideo", { x: 400, y: 0 }, { selectedModel: { provider: "fal", modelId: KLING.id, displayName: KLING.name } });

describe("get_prompt_guide", () => {
  it("reads the node's model, infers the task from its inputs, and adds the saved notes", async () => {
    const state: StoreState = {
      nodes: [storeNode("imageInput-1", "imageInput", { x: 0, y: 0 }), klingNode("generateVideo-1")],
      edges: [storeEdge("imageInput-1", "image", "generateVideo-1", "image-0")],
    };
    const notes = memoryPromptNotesStore([
      { provider: "fal", modelId: KLING.id, notes: "Name the camera move first.", sources: ["https://example.com/kling"], savedAt: "2026-10-01T00:00:00.000Z" },
    ]);
    const result = await call(runtime(state, notes), "get_prompt_guide", { node: "generateVideo-1" });
    expect(result.ok).toBe(true);
    expect(result.ops).toEqual([]);
    expect(result.summary).toBe("Read the image-to-video prompt guide for Kling I2V");
    expect(result.text).toContain("task image-to-video");
    expect(result.text).toContain("Takes a negative prompt (negative_prompt)");
    expect(result.text).toContain("Name the camera move first.");
  });

  it("works for a node not made yet, from nodeType and model", async () => {
    const result = await call(runtime({ nodes: [], edges: [] }), "get_prompt_guide", { nodeType: "generateAudio", model: KOKORO.id, provider: "fal" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("task speech");
    expect(result.text).toContain("The voice is chosen in voice (modelParameters)");
  });

  it("still gives the generic guide when the node has no model", async () => {
    const state: StoreState = { nodes: [storeNode("generate3d-1", "generate3d", { x: 0, y: 0 })], edges: [] };
    const result = await call(runtime(state), "get_prompt_guide", { node: "generate3d-1" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain("task text-to-3d");
    expect(result.text).toContain("Model notes: none (no model chosen; the node will use the user's saved default)");
  });

  it("picks edit for an image node with one reference, and lets task override", async () => {
    const state: StoreState = {
      nodes: [storeNode("imageInput-1", "imageInput", { x: 0, y: 0 }), storeNode("nanoBanana-1", "nanoBanana", { x: 400, y: 0 })],
      edges: [storeEdge("imageInput-1", "image", "nanoBanana-1", "image")],
    };
    const rt = runtime(state);
    expect((await call(rt, "get_prompt_guide", { node: "nanoBanana-1" })).text).toContain("task edit");
    expect((await call(rt, "get_prompt_guide", { node: "nanoBanana-1", task: "generate" })).text).toContain("task generate");
  });

  it("refuses a missing node or a node type without a guide", async () => {
    const rt = runtime({ nodes: [storeNode("output-1", "output", { x: 0, y: 0 })], edges: [] });
    expect(await call(rt, "get_prompt_guide", { node: "nope" })).toMatchObject({ ok: false, summary: "Node not found" });
    expect(await call(rt, "get_prompt_guide", { node: "output-1" })).toMatchObject({ ok: false, summary: "No guide for that node" });
    expect(await call(rt, "get_prompt_guide", {})).toMatchObject({ ok: false, summary: "No guide for that node" });
  });
});
