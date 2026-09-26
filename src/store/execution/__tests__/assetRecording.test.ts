/**
 * Generators hand every output to the asset library through ctx.recordAsset,
 * with the metadata of what actually ran, and put the asset's id in the
 * carousel entry written with the output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NodeExecutionContext } from "../types";
import type { WorkflowNode, WorkflowNodeData } from "@/types";
import type { RecordAssetInput, RecordAssetResult, RecordedAssetHandle } from "@/lib/assets/types";
import { executeNanoBanana } from "../nanoBananaExecutor";
import { executeGenerateVideo } from "../generateVideoExecutor";
import { executeGenerateAudio } from "../generateAudioExecutor";
import { executeGenerate3D } from "../generate3dExecutor";
import { executeComfyApp } from "../comfyAppExecutor";
import { runBatchIfApplicable } from "../batchExecution";
import {
  adoptLegacyId,
  assetParameters,
  assetProducer,
  parameterFraming,
  resolvedPrompt,
  sizeFromString,
} from "../assetRecording";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/utils/costCalculator", () => ({
  calculateGenerationCost: vi.fn().mockReturnValue(0.05),
}));

vi.mock("@/lib/comfy/settings", () => ({
  getComfySettings: () => ({ jobTimeoutMs: 600_000, randomizeSeeds: true }),
  comfyConfigError: () => null,
  buildComfyHeaders: () => ({ "Content-Type": "application/json" }),
}));

const providerSettings = { providers: {} } as never;

/** A recorder stand-in: numbered ids, and a `done` that settles with `result`. */
function makeRecorder(result: Partial<RecordAssetResult> | null = null) {
  let count = 0;
  const handles: RecordedAssetHandle[] = [];
  const recordAsset = vi.fn((_input: RecordAssetInput): RecordedAssetHandle => {
    count += 1;
    const handle = {
      assetId: `a${String(count).padStart(12, "0")}`,
      done: Promise.resolve(result as RecordAssetResult | null),
    };
    handles.push(handle);
    return handle;
  });
  return { recordAsset, handles };
}

/** A context over a tiny in-memory node map, so later writes can be read back. */
function makeCtx(node: WorkflowNode, overrides: Partial<NodeExecutionContext> = {}, text: string | null = "a red fox") {
  const nodes = new Map<string, WorkflowNode>([[node.id, node]]);
  const updateNodeData = vi.fn((id: string, data: Partial<WorkflowNodeData>) => {
    const current = nodes.get(id);
    if (current) nodes.set(id, { ...current, data: { ...current.data, ...data } as WorkflowNodeData });
  });
  const ctx: NodeExecutionContext = {
    node,
    getConnectedInputs: vi.fn().mockReturnValue({
      images: [],
      videos: [],
      audio: [],
      model3d: null,
      text,
      textItems: [],
      dynamicInputs: {},
      easeCurve: null,
    }),
    updateNodeData,
    getFreshNode: (id: string) => nodes.get(id),
    getEdges: () => [],
    getNodes: () => [...nodes.values()],
    providerSettings,
    addIncurredCost: vi.fn(),
    addToGlobalHistory: vi.fn(),
    generationsPath: null,
    saveDirectoryPath: null,
    trackSaveGeneration: vi.fn(),
    appendOutputGalleryImage: vi.fn(),
    appendOutputGalleryVideo: vi.fn(),
    materializeSplitGridCells: vi.fn().mockReturnValue(false),
    get: vi.fn(),
    ...overrides,
  };
  return { ctx, nodes, updateNodeData };
}

function completeCall(updateNodeData: ReturnType<typeof vi.fn>, field: string) {
  return updateNodeData.mock.calls.find((c) => field in (c[1] as Record<string, unknown>))?.[1] as Record<string, unknown> | undefined;
}

function okJson(body: unknown) {
  return { ok: true, json: async () => body };
}

function imageNode(data: Record<string, unknown> = {}): WorkflowNode {
  return {
    id: "gen-1",
    type: "nanoBanana",
    position: { x: 0, y: 0 },
    data: {
      outputImage: null,
      inputImages: [],
      inputPrompt: null,
      status: "idle",
      error: null,
      aspectRatio: "1:1",
      resolution: "1K",
      model: "nano-banana",
      useGoogleSearch: false,
      useImageSearch: false,
      selectedModel: { provider: "gemini", modelId: "nano-banana-pro", displayName: "Nano Banana Pro" },
      parameters: {},
      imageHistory: [],
      selectedHistoryIndex: 0,
      ...data,
    },
  } as WorkflowNode;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("recording helpers", () => {
  it("keeps settings but never media in parameters", () => {
    expect(
      assetParameters({
        seed: 7,
        style: "photo",
        image_url: "data:image/png;base64,AAAA",
        mask: "blob:http://localhost/1",
        raw: "A".repeat(2048),
        nested: { ref: "data:image/png;base64,BBBB", strength: 0.4 },
        list: ["data:x", "keep"],
      })
    ).toEqual({ seed: 7, style: "photo", nested: { strength: 0.4 }, list: ["keep"] });
    expect(assetParameters({ image: "data:image/png;base64,AAAA" })).toBeUndefined();
    expect(assetParameters(undefined)).toBeUndefined();
  });

  it("resolves the prompt a request carried", () => {
    expect(resolvedPrompt("typed", { prompt: "dynamic" })).toBe("typed");
    expect(resolvedPrompt(null, { prompt: ["from handle"] })).toBe("from handle");
    expect(resolvedPrompt(null, {})).toBeUndefined();
  });

  it("reads framing from a model's parameters and sizes from a size string", () => {
    expect(parameterFraming({ aspect_ratio: "16:9", resolution: "1080p" })).toEqual({ aspectRatio: "16:9", resolution: "1080p" });
    expect(parameterFraming({ aspectRatio: "4:3" })).toEqual({ aspectRatio: "4:3" });
    expect(parameterFraming({ aspect_ratio: 3 })).toEqual({});
    expect(sizeFromString("1536x864")).toEqual({ width: 1536, height: 864 });
    expect(sizeFromString("auto")).toEqual({});
  });

  it("names the producer by its custom title only when it has one", () => {
    const titled = makeCtx(imageNode({ customTitle: "  Hero shot " })).ctx;
    expect(assetProducer(titled, { operation: "resize" })).toEqual({
      nodeId: "gen-1",
      nodeType: "nanoBanana",
      nodeTitle: "Hero shot",
      operation: "resize",
    });
    expect(assetProducer(makeCtx(imageNode()).ctx)).toEqual({ nodeId: "gen-1", nodeType: "nanoBanana" });
  });

  it("gives the recorded asset's carousel entry the file's name", () => {
    const node = imageNode({ imageHistory: [{ id: "111", assetId: "a1", timestamp: 1, prompt: "", aspectRatio: "1:1", model: "m" }] });
    const { ctx, nodes } = makeCtx(node);
    adoptLegacyId(ctx, "imageHistory", "a1", { legacyId: "a_red_fox_abc" } as RecordAssetResult);
    expect((nodes.get("gen-1")!.data as { imageHistory: { id: string }[] }).imageHistory[0].id).toBe("a_red_fox_abc");

    // Nothing to do without a result, or for an entry that is not there
    const { ctx: other, updateNodeData } = makeCtx(imageNode());
    adoptLegacyId(other, "imageHistory", "a1", null);
    adoptLegacyId(other, "imageHistory", "a1", { legacyId: "x" } as RecordAssetResult);
    expect(updateNodeData).not.toHaveBeenCalled();
  });
});

describe("nanoBanana", () => {
  it("records the image with the model and settings that ran, and keys the carousel entry by it", async () => {
    const { recordAsset, handles } = makeRecorder();
    const node = imageNode({ customTitle: "Fox", useGoogleSearch: true });
    const { ctx, updateNodeData } = makeCtx(node, { recordAsset });
    mockFetch.mockResolvedValueOnce(okJson({ success: true, image: "data:image/png;base64,fox" }));

    await executeNanoBanana(ctx);

    expect(recordAsset).toHaveBeenCalledExactlyOnceWith({
      kind: "image",
      origin: "generated",
      media: "data:image/png;base64,fox",
      prompt: "a red fox",
      model: { provider: "gemini", modelId: "nano-banana-pro", displayName: "Nano Banana Pro" },
      parameters: { useGoogleSearch: true },
      aspectRatio: "1:1",
      resolution: "1K",
      cost: { amount: 0.05, currency: "USD", estimated: true },
      producer: { nodeId: "gen-1", nodeType: "nanoBanana", nodeTitle: "Fox" },
    });
    // The id lands with the output, in one write
    const complete = completeCall(updateNodeData, "imageHistory")!;
    expect(complete.outputImage).toBe("data:image/png;base64,fox");
    expect(complete.imageHistory).toEqual([expect.objectContaining({ assetId: handles[0].assetId, model: "nano-banana-pro" })]);
    // No project: nothing is written to a folder, and nothing holds the tabs
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(ctx.trackSaveGeneration).not.toHaveBeenCalled();
  });

  it("records the fallback model after the primary fails, with its own parameters and framing", async () => {
    const { recordAsset } = makeRecorder();
    const node = imageNode({
      selectedModel: { provider: "gemini", modelId: "nano-banana", displayName: "Nano Banana" },
      fallbackModel: { provider: "fal", modelId: "fal-ai/flux", displayName: "Flux", pricing: { type: "per-run", amount: 0.03 } },
      fallbackParameters: { aspect_ratio: "16:9", seed: 4, image_url: "data:image/png;base64,in" },
    });
    const { ctx, updateNodeData } = makeCtx(node, { recordAsset });
    mockFetch
      .mockResolvedValueOnce(okJson({ success: false, error: "quota" }))
      .mockResolvedValueOnce(okJson({ success: true, image: "data:image/png;base64,flux" }));

    await executeNanoBanana(ctx);

    expect(recordAsset).toHaveBeenCalledOnce();
    const input = recordAsset.mock.calls[0][0];
    expect(input.model).toEqual({ provider: "fal", modelId: "fal-ai/flux", displayName: "Flux" });
    expect(input.parameters).toEqual({ aspect_ratio: "16:9", seed: 4 });
    expect(input.aspectRatio).toBe("16:9");
    expect(input.resolution).toBeUndefined();
    expect(input.cost).toEqual({ amount: 0.03, currency: "USD", estimated: true });
    // The history names the model that ran, not the stale Gemini field
    expect(completeCall(updateNodeData, "imageHistory")!.imageHistory).toEqual([expect.objectContaining({ model: "Flux" })]);
    expect(ctx.addToGlobalHistory).toHaveBeenCalledWith(expect.objectContaining({ model: "Flux" }));
  });

  it("records OpenAI's reported cost and size", async () => {
    const { recordAsset } = makeRecorder();
    const node = imageNode({ selectedModel: { provider: "openai", modelId: "gpt-image-2.5-flare", displayName: "GPT Image 2.5 Flare" } });
    const generation = { modelId: "gpt-image-2.5-flare", size: "1536x864", parameters: {}, cost: { amount: 0.02, currency: "USD", estimated: false } };
    const { ctx } = makeCtx(node, { recordAsset });
    mockFetch.mockResolvedValueOnce(okJson({ success: true, image: "data:image/webp;base64,x", generation }));

    await executeNanoBanana(ctx);

    expect(recordAsset.mock.calls[0][0]).toMatchObject({
      cost: { amount: 0.02, currency: "USD", estimated: false },
      width: 1536,
      height: 864,
    });
    expect(ctx.addIncurredCost).toHaveBeenCalledExactlyOnceWith(0.02);
  });

  it("in a project, swaps the entry's id for the recorded file's name, tracked like a save", async () => {
    const { recordAsset, handles } = makeRecorder({ legacyId: "a_red_fox_9f8e" });
    const { ctx, nodes } = makeCtx(imageNode(), { recordAsset, generationsPath: "/proj/generations" });
    mockFetch.mockResolvedValueOnce(okJson({ success: true, image: "data:image/png;base64,fox" }));

    await executeNanoBanana(ctx);

    // The recorder writes into the project; the old save route is not called
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const track = ctx.trackSaveGeneration as ReturnType<typeof vi.fn>;
    expect(track).toHaveBeenCalledOnce();
    await track.mock.calls[0][1];
    const history = (nodes.get("gen-1")!.data as { imageHistory: { id: string; assetId?: string }[] }).imageHistory;
    expect(history).toEqual([expect.objectContaining({ id: "a_red_fox_9f8e", assetId: handles[0].assetId })]);
  });

  it("saves to the generations folder as before when the library is not recording", async () => {
    const { ctx, updateNodeData } = makeCtx(imageNode(), { generationsPath: "/proj/generations" });
    mockFetch
      .mockResolvedValueOnce(okJson({ success: true, image: "data:image/png;base64,fox" }))
      .mockResolvedValueOnce(okJson({ success: true, imageId: "a_red_fox_1" }));

    await executeNanoBanana(ctx);

    expect(mockFetch.mock.calls[1][0]).toBe("/api/save-generation");
    expect(completeCall(updateNodeData, "imageHistory")!.imageHistory).toEqual([expect.not.objectContaining({ assetId: expect.anything() })]);
  });

  it("falls back to the folder, and still finishes, when the recorder throws", async () => {
    const recordAsset = vi.fn(() => {
      throw new Error("recorder down");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, updateNodeData } = makeCtx(imageNode(), { recordAsset, generationsPath: "/proj/generations" });
    mockFetch
      .mockResolvedValueOnce(okJson({ success: true, image: "data:image/png;base64,fox" }))
      .mockResolvedValueOnce(okJson({ success: true }));

    await executeNanoBanana(ctx);

    expect(completeCall(updateNodeData, "outputImage")!.status).toBe("complete");
    expect(mockFetch.mock.calls[1][0]).toBe("/api/save-generation");
    error.mockRestore();
  });

  it("tags each batch item's asset with its index", async () => {
    const { recordAsset } = makeRecorder();
    const { ctx } = makeCtx(imageNode(), { recordAsset });
    (ctx.getConnectedInputs as ReturnType<typeof vi.fn>).mockReturnValue({
      images: [],
      videos: [],
      audio: [],
      model3d: null,
      text: null,
      textItems: ["one", "two"],
      dynamicInputs: {},
      easeCurve: null,
    });
    mockFetch.mockResolvedValue(okJson({ success: true, image: "data:image/png;base64,x" }));

    await expect(runBatchIfApplicable(ctx)).resolves.toBe(true);

    expect(recordAsset.mock.calls.map((c) => [c[0].prompt, c[0].producer.batchIndex])).toEqual([
      ["one", 0],
      ["two", 1],
    ]);
  });
});

describe("generateVideo", () => {
  function videoNode(data: Record<string, unknown> = {}): WorkflowNode {
    return {
      id: "vid-1",
      type: "generateVideo",
      position: { x: 0, y: 0 },
      data: {
        outputVideo: null,
        inputImages: [],
        inputPrompt: null,
        status: "idle",
        error: null,
        selectedModel: { provider: "fal", modelId: "fal-ai/kling", displayName: "Kling", pricing: { type: "per-run", amount: 0.4 } },
        parameters: { duration: "5", aspect_ratio: "9:16" },
        videoHistory: [],
        selectedVideoHistoryIndex: 0,
        ...data,
      },
    } as WorkflowNode;
  }

  it("records the video, with the prompt a dynamic handle supplied", async () => {
    const { recordAsset, handles } = makeRecorder();
    const { ctx, updateNodeData } = makeCtx(videoNode(), { recordAsset }, null);
    (ctx.getConnectedInputs as ReturnType<typeof vi.fn>).mockReturnValue({
      images: [],
      videos: [],
      audio: [],
      model3d: null,
      text: null,
      textItems: [],
      dynamicInputs: { prompt: "waves at dusk" },
      easeCurve: null,
    });
    mockFetch.mockResolvedValueOnce(okJson({ success: true, videoUrl: "https://cdn.example/v.mp4" }));

    await executeGenerateVideo(ctx);

    expect(recordAsset).toHaveBeenCalledExactlyOnceWith({
      kind: "video",
      origin: "generated",
      media: "https://cdn.example/v.mp4",
      prompt: "waves at dusk",
      model: { provider: "fal", modelId: "fal-ai/kling", displayName: "Kling" },
      parameters: { duration: "5", aspect_ratio: "9:16" },
      aspectRatio: "9:16",
      cost: { amount: 0.4, currency: "USD", estimated: true },
      producer: { nodeId: "vid-1", nodeType: "generateVideo" },
    });
    expect(completeCall(updateNodeData, "videoHistory")!.videoHistory).toEqual([
      expect.objectContaining({ assetId: handles[0].assetId, model: "fal-ai/kling" }),
    ]);
    expect(ctx.trackSaveGeneration).not.toHaveBeenCalled();
  });

  it("records a still when the model answers with an image", async () => {
    const { recordAsset } = makeRecorder();
    const { ctx } = makeCtx(videoNode(), { recordAsset });
    mockFetch.mockResolvedValueOnce(okJson({ success: true, image: "data:image/png;base64,still" }));

    await executeGenerateVideo(ctx);

    expect(recordAsset.mock.calls[0][0]).toMatchObject({ kind: "image", media: "data:image/png;base64,still" });
  });

  it("in a project, swaps the entry's id for the recorded file's name", async () => {
    const { recordAsset } = makeRecorder({ legacyId: "waves_1a2b" });
    const { ctx, nodes } = makeCtx(videoNode(), { recordAsset, generationsPath: "/proj/generations" });
    mockFetch.mockResolvedValueOnce(okJson({ success: true, video: "data:video/mp4;base64,v" }));

    await executeGenerateVideo(ctx);
    await (ctx.trackSaveGeneration as ReturnType<typeof vi.fn>).mock.calls[0][1];

    expect((nodes.get("vid-1")!.data as { videoHistory: { id: string }[] }).videoHistory[0].id).toBe("waves_1a2b");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("generateAudio", () => {
  function audioNode(): WorkflowNode {
    return {
      id: "aud-1",
      type: "generateAudio",
      position: { x: 0, y: 0 },
      data: {
        outputAudio: null,
        inputPrompt: null,
        status: "idle",
        error: null,
        selectedModel: { provider: "kie", modelId: "elevenlabs/tts", displayName: "ElevenLabs" },
        parameters: { voice: "Rachel" },
        audioHistory: [],
        selectedAudioHistoryIndex: 0,
        duration: null,
        format: null,
      },
    } as WorkflowNode;
  }

  it("records the audio and keys the carousel entry by it", async () => {
    const { recordAsset, handles } = makeRecorder();
    const { ctx, updateNodeData } = makeCtx(audioNode(), { recordAsset }, "hello there");
    mockFetch.mockResolvedValueOnce(okJson({ success: true, audio: "data:audio/mpeg;base64,a" }));

    await executeGenerateAudio(ctx);

    expect(recordAsset).toHaveBeenCalledExactlyOnceWith({
      kind: "audio",
      origin: "generated",
      media: "data:audio/mpeg;base64,a",
      prompt: "hello there",
      model: { provider: "kie", modelId: "elevenlabs/tts", displayName: "ElevenLabs" },
      parameters: { voice: "Rachel" },
      producer: { nodeId: "aud-1", nodeType: "generateAudio" },
    });
    expect(completeCall(updateNodeData, "audioHistory")!.audioHistory).toEqual([
      expect.objectContaining({ assetId: handles[0].assetId }),
    ]);
  });

  it("in a project, swaps the entry's id for the recorded file's name", async () => {
    const { recordAsset } = makeRecorder({ legacyId: "hello_there_77" });
    const { ctx, nodes } = makeCtx(audioNode(), { recordAsset, generationsPath: "/proj/generations" }, "hello there");
    mockFetch.mockResolvedValueOnce(okJson({ success: true, audio: "data:audio/mpeg;base64,a" }));

    await executeGenerateAudio(ctx);
    await (ctx.trackSaveGeneration as ReturnType<typeof vi.fn>).mock.calls[0][1];

    expect((nodes.get("aud-1")!.data as { audioHistory: { id: string }[] }).audioHistory[0].id).toBe("hello_there_77");
  });
});

describe("generate3d", () => {
  function modelNode(): WorkflowNode {
    return {
      id: "3d-1",
      type: "generate3d",
      position: { x: 0, y: 0 },
      data: {
        inputImages: [],
        inputPrompt: null,
        output3dUrl: null,
        savedFilename: null,
        savedFilePath: null,
        status: "idle",
        error: null,
        selectedModel: { provider: "fal", modelId: "fal-ai/trellis", displayName: "Trellis", pricing: { type: "per-run", amount: 0.25 } },
        parameters: {},
      },
    } as WorkflowNode;
  }

  const saved = {
    filename: "HHMMSS_chair_12345678.glb",
    legacyId: "HHMMSS_chair_12345678",
    asset: { displayPath: "/Users/me/Pictures/Node Banana/Generations/2026-09-27/HHMMSS_chair_12345678.glb" },
  } as unknown as RecordAssetResult;

  it("records the provider's URL for the server to download, then points the node at the saved file", async () => {
    const { recordAsset } = makeRecorder(saved);
    const { ctx, nodes } = makeCtx(modelNode(), { recordAsset }, "a chair");
    mockFetch.mockResolvedValueOnce(okJson({ success: true, model3dUrl: "https://cdn.example/chair.glb" }));

    await executeGenerate3D(ctx);
    await Promise.resolve();
    await Promise.resolve();

    expect(recordAsset).toHaveBeenCalledExactlyOnceWith({
      kind: "3d",
      origin: "generated",
      media: "https://cdn.example/chair.glb",
      prompt: "a chair",
      model: { provider: "fal", modelId: "fal-ai/trellis", displayName: "Trellis" },
      cost: { amount: 0.25, currency: "USD", estimated: true },
      producer: { nodeId: "3d-1", nodeType: "generate3d" },
    });
    await vi.waitFor(() => {
      expect(nodes.get("3d-1")!.data).toMatchObject({ savedFilename: saved.filename, savedFilePath: saved.asset.displayPath });
    });
    // Not a project: the tabs are not held for it
    expect(ctx.trackSaveGeneration).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("leaves a node that has moved on to another model alone", async () => {
    let settle!: (value: RecordAssetResult) => void;
    const recordAsset = vi.fn(() => ({ assetId: "a000000000001", done: new Promise<RecordAssetResult | null>((r) => (settle = r)) }));
    const { ctx, nodes, updateNodeData } = makeCtx(modelNode(), { recordAsset, generationsPath: "/proj/generations" }, "a chair");
    mockFetch.mockResolvedValueOnce(okJson({ success: true, model3dUrl: "https://cdn.example/chair.glb" }));

    await executeGenerate3D(ctx);
    updateNodeData("3d-1", { output3dUrl: "https://cdn.example/other.glb" });
    settle(saved);
    await (ctx.trackSaveGeneration as ReturnType<typeof vi.fn>).mock.calls[0][1];

    expect(nodes.get("3d-1")!.data).toMatchObject({ savedFilename: null, savedFilePath: null });
  });
});

describe("comfyApp", () => {
  const app = {
    id: "app-1",
    name: "Upscaler",
    description: "",
    source: "upload",
    graph: {},
    inputs: [],
    params: [],
    outputs: [
      { id: "9", label: "Image", type: "image", nodeId: "9", classType: "SaveImage" },
      { id: "12", label: "Video", type: "video", nodeId: "12", classType: "SaveVideo" },
      { id: "15", label: "Caption", type: "text", nodeId: "15", classType: "ShowText" },
    ],
    classTypes: [],
    nodeCount: 3,
    createdAt: 1,
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("records every media output under its handle, and nothing to the folder", async () => {
    vi.useFakeTimers();
    const { recordAsset } = makeRecorder();
    const node = { id: "comfy-1", type: "comfyApp", position: { x: 0, y: 0 }, data: { app, paramValues: { "3:steps": 20 }, status: "idle" } } as unknown as WorkflowNode;
    const { ctx } = makeCtx(node, { recordAsset, generationsPath: "/proj/generations" });
    mockFetch.mockImplementation(async (url: string) =>
      url === "/api/comfy/run"
        ? okJson({ success: true, polling: true, jobId: "job-1", status: "queued" })
        : okJson({
            success: true,
            polling: false,
            status: "success",
            outputs: [
              { handleId: "9", type: "image", value: "data:image/png;base64,big" },
              { handleId: "12", type: "video", value: "data:video/mp4;base64,clip" },
              { handleId: "15", type: "text", value: "a caption" },
            ],
          })
    );

    const run = executeComfyApp(ctx);
    await vi.advanceTimersByTimeAsync(2_000);
    await run;

    expect(recordAsset.mock.calls.map((c) => [c[0].kind, c[0].producer.outputHandle, c[0].media])).toEqual([
      ["image", "9", "data:image/png;base64,big"],
      ["video", "12", "data:video/mp4;base64,clip"],
    ]);
    expect(recordAsset.mock.calls[0][0]).toMatchObject({
      origin: "generated",
      prompt: "Upscaler (steps=20)",
      model: { provider: "comfyui", modelId: "Upscaler", displayName: "Upscaler" },
      parameters: { "3:steps": 20, seedKey: expect.stringMatching(/^comfy-1-\d+$/) },
      producer: { nodeId: "comfy-1", nodeType: "comfyApp" },
    });
    expect(mockFetch.mock.calls.some((c) => c[0] === "/api/save-generation")).toBe(false);
    expect(ctx.addToGlobalHistory).toHaveBeenCalledOnce();
  });
});
