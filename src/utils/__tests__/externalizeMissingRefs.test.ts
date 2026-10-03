import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { demoteMissingRefs, externalizeWorkflowMedia } from "../mediaStorage";
import type { WorkflowFile, WorkflowNode } from "@/types";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const node = (id: string, type: string, data: Record<string, unknown>): WorkflowNode =>
  ({ id, type, position: { x: 0, y: 0 }, data }) as unknown as WorkflowNode;

describe("demoteMissingRefs", () => {
  const present = new Set(["img-here"]);

  it("drops a ref whose file is gone while the media is still embedded, so the save writes it", () => {
    const out = demoteMissingRefs(node("a", "imageInput", { image: PNG, imageRef: "img-gone" }), present);
    expect(out.data).toEqual({ image: PNG });
  });

  it("keeps a ref whose file is there, and a dangling ref with nothing behind it", () => {
    const kept = node("a", "imageInput", { image: PNG, imageRef: "img-here" });
    expect(demoteMissingRefs(kept, present)).toBe(kept);
    const dangling = node("b", "imageInput", { image: null, imageRef: "img-gone" });
    expect(demoteMissingRefs(dangling, present)).toBe(dangling);
  });

  it("clears only the missing entries of a ref array", () => {
    const out = demoteMissingRefs(
      node("c", "nanoBanana", { inputImages: [PNG, PNG, "https://x/y.png"], inputImageRefs: ["img-gone", "img-here", "img-gone"] }),
      present,
    );
    expect((out.data as { inputImageRefs: string[] }).inputImageRefs).toEqual(["", "img-here", "img-gone"]);
  });

  it("handles every ref pairing by name", () => {
    const out = demoteMissingRefs(
      node("d", "annotation", { sourceImage: PNG, sourceImageRef: "img-gone", outputImage: PNG, outputImageRef: "img-here", video: PNG, videoRef: "vid-gone" }),
      present,
    );
    expect(out.data).toEqual({ sourceImage: PNG, outputImage: PNG, outputImageRef: "img-here", video: PNG });
  });
});

describe("externalizeWorkflowMedia with a folder that lacks a ref's file", () => {
  const posts: Array<{ imageId: string; folder: string }> = [];
  beforeEach(() => {
    posts.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).includes("list=1")) return { ok: true, json: async () => ({ success: true, ids: ["img-here"] }) };
        const body = JSON.parse(String(init?.body)) as { imageId: string; folder: string };
        posts.push({ imageId: body.imageId, folder: body.folder });
        return { ok: true, status: 200, json: async () => ({ success: true, imageId: body.imageId }) };
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("writes the embedded image out again instead of trusting the stale ref", async () => {
    const workflow = {
      version: 1, id: "wf", name: "Cars", directoryPath: "/projects/cars-new", edges: [],
      nodes: [node("a", "imageInput", { image: PNG, imageRef: "img-gone" }), node("b", "imageInput", { image: PNG, imageRef: "img-here" })],
    } as unknown as WorkflowFile;
    const out = await externalizeWorkflowMedia(workflow, "/projects/cars-new");
    const a = out.nodes[0].data as { image: string | null; imageRef?: string };
    const b = out.nodes[1].data as { image: string | null; imageRef?: string };
    expect(posts.map((p) => p.folder)).toEqual(["inputs"]);
    expect(a.image).toBeNull();
    expect(a.imageRef).toBe(posts[0].imageId);
    expect(a.imageRef).not.toBe("img-gone");
    expect(b).toEqual({ image: null, imageRef: "img-here" });
  });

  it("trusts refs as before when the folder cannot be listed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({ success: false, error: "no" }) })));
    const workflow = { version: 1, id: "wf", name: "Cars", directoryPath: "/p", edges: [], nodes: [node("a", "imageInput", { image: PNG, imageRef: "img-gone" })] } as unknown as WorkflowFile;
    const out = await externalizeWorkflowMedia(workflow, "/p");
    expect(out.nodes[0].data).toEqual({ image: null, imageRef: "img-gone" });
  });
});
