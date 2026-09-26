import { describe, expect, it } from "vitest";
import type { WorkflowFile } from "@/store/workflowStore";
import type { AssetKind, AssetView } from "../../types";
import { prepareWorkflowForOpen, snapshotOpenedLabel } from "../snapshot";
import { assetView } from "./helpers";

const MEDIA = "data:image/png;base64,QVNTRVQ=";
const OPENED_AT = new Date(2026, 8, 27, 14, 32).getTime();
const LABEL = snapshotOpenedLabel(OPENED_AT, "en-GB");

function file(nodes: unknown[], overrides: Partial<WorkflowFile> = {}): WorkflowFile {
  return {
    version: 1,
    id: "wf_original",
    name: "Cats",
    directoryPath: "/Users/test/Projects/Cats",
    nodes: nodes as WorkflowFile["nodes"],
    edges: [],
    edgeStyle: "curved",
    ...overrides,
  };
}

function node(id: string, type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { id, type, position: { x: 0, y: 0 }, data, ...extra };
}

function assetFor(nodeId: string, nodeType: string, kind: AssetKind = "image", producer: Partial<AssetView["producer"]> = {}) {
  return assetView({ id: "a-asset", kind, producer: { nodeId, nodeType, ...producer } });
}

function dataOf(prepared: WorkflowFile, index = 0): Record<string, unknown> {
  return prepared.nodes[index].data as unknown as Record<string, unknown>;
}

describe("prepareWorkflowForOpen", () => {
  it("gives the copy a fresh id, no folder and a dated name", () => {
    const prepared = prepareWorkflowForOpen(file([]), {
      asset: assetView(),
      assetMedia: null,
      openedAt: OPENED_AT,
      locale: "en-GB",
    });
    expect(prepared.id).toMatch(/^wf_\d+_[a-z0-9]+$/);
    expect(prepared.id).not.toBe("wf_original");
    expect(prepared).not.toHaveProperty("directoryPath");
    expect(prepared.name).toBe(`Cats (${LABEL})`);
  });

  it("names an unnamed workflow after its library entry, else Untitled", () => {
    const options = { assetMedia: null, openedAt: OPENED_AT, locale: "en-GB" };
    expect(prepareWorkflowForOpen(file([], { name: "" }), { ...options, asset: assetView() }).name).toBe(`Cats (${LABEL})`);
    const nameless = assetView({ workflowName: null, workflow: { id: "wf", name: null, projectPath: null } });
    expect(prepareWorkflowForOpen(file([], { name: "  " }), { ...options, asset: nameless }).name).toBe(`Untitled (${LABEL})`);
  });

  it("formats the label as the locale's day and month with a 24-hour time", () => {
    // ICU spells September "Sep" or "Sept" depending on its version; the order and the clock are what matter.
    expect(LABEL).toMatch(/^27 Sept? 14:32$/);
    expect(snapshotOpenedLabel(OPENED_AT, "en-US")).toMatch(/^Sept? 27 14:32$/);
    expect(snapshotOpenedLabel(new Date(2026, 0, 5, 9, 5).getTime(), "en-GB")).toBe("5 Jan 09:05");
    expect(snapshotOpenedLabel(new Date(2026, 0, 5, 0, 7).getTime(), "en-US")).toBe("Jan 5 00:07");
  });

  it.each([
    ["nanoBanana", "outputImage", "image"],
    ["videoFrameGrab", "outputImage", "image"],
    ["removeBackground", "outputImage", "image"],
    ["imageResize", "outputImage", "image"],
    ["annotation", "outputImage", "image"],
    ["generateVideo", "outputVideo", "video"],
    ["videoStitch", "outputVideo", "video"],
    ["videoTrim", "outputVideo", "video"],
    ["easeCurve", "outputVideo", "video"],
    ["generateAudio", "outputAudio", "audio"],
    ["generate3d", "output3dUrl", "3d"],
    ["gifEncoder", "outputGif", "image"],
  ] as const)("puts the asset into a %s node's %s", (type, field, kind) => {
    const prepared = prepareWorkflowForOpen(file([node(`${type}-1`, type, { [field]: "old", status: "error", error: "failed later" })]), {
      asset: assetFor(`${type}-1`, type, kind),
      assetMedia: MEDIA,
      openedAt: OPENED_AT,
    });
    expect(dataOf(prepared)).toMatchObject({ [field]: MEDIA, status: "complete", error: null });
  });

  it("leaves nodes it has no output field for, and other nodes, alone", () => {
    const prepared = prepareWorkflowForOpen(
      file([node("splitGrid-1", "splitGrid", { sourceImage: "src" }), node("nanoBanana-2", "nanoBanana", { outputImage: "other" })]),
      { asset: assetFor("splitGrid-1", "splitGrid"), assetMedia: MEDIA, openedAt: OPENED_AT },
    );
    expect(dataOf(prepared, 0)).toEqual({ sourceImage: "src" });
    expect(dataOf(prepared, 1).outputImage).toBe("other");
  });

  it("injects nothing when the asset's bytes could not be loaded", () => {
    const prepared = prepareWorkflowForOpen(file([node("nanoBanana-1", "nanoBanana", { outputImage: "old" })]), {
      asset: assetFor("nanoBanana-1", "nanoBanana"),
      assetMedia: null,
      openedAt: OPENED_AT,
    });
    expect(dataOf(prepared).outputImage).toBe("old");
  });

  it("does not inject into a node whose id now belongs to another type", () => {
    const prepared = prepareWorkflowForOpen(file([node("nanoBanana-1", "generateVideo", { outputVideo: "v" })]), {
      asset: assetFor("nanoBanana-1", "nanoBanana"),
      assetMedia: MEDIA,
      openedAt: OPENED_AT,
    });
    expect(dataOf(prepared).outputVideo).toBe("v");
    expect(dataOf(prepared)).not.toHaveProperty("outputImage");
  });

  it.each([
    ["imageHistory", "selectedHistoryIndex", "nanoBanana"],
    ["videoHistory", "selectedVideoHistoryIndex", "generateVideo"],
    ["audioHistory", "selectedAudioHistoryIndex", "generateAudio"],
  ] as const)("selects the %s entry recorded as this asset", (history, index, type) => {
    const entries = [{ id: "3", assetId: "a-other" }, { id: "2", assetId: "a-asset" }, { id: "1" }];
    const prepared = prepareWorkflowForOpen(file([node("n1", type, { [history]: entries, [index]: 0 })]), {
      asset: assetFor("n1", type),
      assetMedia: MEDIA,
      openedAt: OPENED_AT,
    });
    expect(dataOf(prepared)[index]).toBe(1);
  });

  it("finds the producer by its carousel when the id is gone", () => {
    const prepared = prepareWorkflowForOpen(
      file([node("nanoBanana-9", "nanoBanana", { imageHistory: [{ id: "x", assetId: "a-asset" }], selectedHistoryIndex: 3 })]),
      { asset: assetFor("nanoBanana-1", "nanoBanana"), assetMedia: MEDIA, openedAt: OPENED_AT },
    );
    expect(dataOf(prepared)).toMatchObject({ outputImage: MEDIA, selectedHistoryIndex: 0 });
  });

  it("puts a Comfy app output under its handle and refreshes the typed mirror", () => {
    const app = {
      outputs: [
        { id: "still", type: "image" },
        { id: "clip", type: "video" },
        { id: "alt-clip", type: "video" },
      ],
    };
    const comfy = node("comfyApp-1", "comfyApp", {
      app,
      outputs: { still: "img", clip: "first" },
      outputImage: "img",
      outputVideo: "first",
      jobId: "job",
      runStatus: "in_progress",
      status: "loading",
    });

    const second = prepareWorkflowForOpen(file([comfy]), {
      asset: assetFor("comfyApp-1", "comfyApp", "video", { outputHandle: "alt-clip" }),
      assetMedia: MEDIA,
      openedAt: OPENED_AT,
    });
    // The mirror is the first declared video output, which still holds its own value.
    expect(dataOf(second)).toMatchObject({ outputs: { still: "img", clip: "first", "alt-clip": MEDIA }, outputVideo: "first", status: "complete" });
    expect(dataOf(second)).not.toHaveProperty("jobId");
    expect(dataOf(second)).not.toHaveProperty("runStatus");

    const first = prepareWorkflowForOpen(file([comfy]), {
      asset: assetFor("comfyApp-1", "comfyApp", "video", { outputHandle: "clip" }),
      assetMedia: MEDIA,
      openedAt: OPENED_AT,
    });
    expect(dataOf(first)).toMatchObject({ outputs: { clip: MEDIA }, outputVideo: MEDIA });

    const image = prepareWorkflowForOpen(file([comfy]), {
      asset: assetFor("comfyApp-1", "comfyApp", "image", { outputHandle: "still" }),
      assetMedia: MEDIA,
      openedAt: OPENED_AT,
    });
    expect(dataOf(image)).toMatchObject({ outputs: { still: MEDIA }, outputImage: MEDIA });
  });

  it("resets run state on every node", () => {
    const prepared = prepareWorkflowForOpen(
      file([
        node(
          "a",
          "nanoBanana",
          { status: "loading", jobId: "j", __fallbackModelUsed: "Flux", __usedFallback: true, __primaryError: "x", selected: true, execution: {} },
          { selected: true, dragging: true },
        ),
        node("b", "comfyApp", { status: "queued", runStatus: "queued" }),
        node("c", "generateVideo", { status: "pending" }),
        node("d", "generateAudio", { status: "processing" }),
        node("e", "llmGenerate", { status: "running" }),
        node("f", "prompt", { status: "complete" }),
        node("g", "output", { status: "error", error: "boom" }),
      ]),
      { asset: assetFor("zzz", "nanoBanana"), assetMedia: MEDIA, openedAt: OPENED_AT },
    );
    expect(prepared.nodes.map((n) => (n.data as { status?: string }).status)).toEqual([
      "idle",
      "idle",
      "idle",
      "idle",
      "idle",
      "complete",
      "error",
    ]);
    expect(prepared.nodes[0]).not.toHaveProperty("selected");
    expect(prepared.nodes[0]).not.toHaveProperty("dragging");
    expect(dataOf(prepared, 0)).toEqual({ status: "idle" });
    expect(dataOf(prepared, 1)).toEqual({ status: "idle" });
    expect(dataOf(prepared, 6)).toEqual({ status: "error", error: "boom" });
  });

  it("does not change the file it was given", () => {
    const original = file([node("nanoBanana-1", "nanoBanana", { outputImage: "old", status: "loading" }, { selected: true })]);
    const before = JSON.stringify(original);
    prepareWorkflowForOpen(original, { asset: assetFor("nanoBanana-1", "nanoBanana"), assetMedia: MEDIA, openedAt: OPENED_AT });
    expect(JSON.stringify(original)).toBe(before);
  });
});
