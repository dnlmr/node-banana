/**
 * Saving a project wrote an Output Gallery's images again on every save, under
 * new names: new images went in front of `images` while `imageRefs` stayed
 * where it was, so old images lost their refs and a new one could take an
 * old one's. The refs now move with the media, and a file saved without a
 * set id is named after its content, so the same bytes land on one file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { externalizeWorkflowMedia } from "../mediaStorage";
import { executeOutputGallery } from "@/store/execution/simpleNodeExecutors";
import type { NodeExecutionContext } from "@/store/execution/types";
import type { OutputGalleryNodeData, WorkflowNode } from "@/types";
import type { WorkflowFile } from "@/store/workflowStore";

const OLD = "data:image/png;base64,b2xkIGltYWdl";
const NEW = "data:image/png;base64,bmV3IGltYWdl";

let posted: { imageId: string; imageData: string }[];

beforeEach(() => {
  posted = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { imageId: string; imageData: string };
      posted.push(body);
      return { ok: true, status: 200, json: async () => ({ success: true, imageId: body.imageId }) };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const gallery = (data: Partial<OutputGalleryNodeData>): WorkflowNode =>
  ({ id: "gallery-1", type: "outputGallery", position: { x: 0, y: 0 }, data: { images: [], ...data } }) as unknown as WorkflowNode;

const save = async (node: WorkflowNode) => {
  const result = await externalizeWorkflowMedia({ nodes: [node], edges: [] } as unknown as WorkflowFile, "/projects/demo");
  return result.nodes[0]!.data as OutputGalleryNodeData;
};

describe("Output Gallery saves", () => {
  it("names a saved image after its content, so saving it again reuses the file", async () => {
    const first = await save(gallery({ images: [OLD] }));
    const second = await save(gallery({ images: [OLD] }));
    expect(first.imageRefs).toEqual(second.imageRefs);
    expect(new Set(posted.map((body) => body.imageId)).size).toBe(1);
  });

  it("keeps each image's ref with it when a run adds images in front", async () => {
    const saved = await save(gallery({ images: [OLD] }));
    const oldRef = saved.imageRefs![0]!;
    posted = [];

    let node = gallery({ images: [OLD], imageRefs: [oldRef] });
    const ctx = {
      node,
      getConnectedInputs: () => ({ images: [NEW], videos: [], audio: [], text: null, dynamicInputs: {}, easeCurve: null }),
      getFreshNode: () => node,
      updateNodeData: (_id: string, updates: Partial<OutputGalleryNodeData>) => {
        node = { ...node, data: { ...node.data, ...updates } } as WorkflowNode;
      },
    } as unknown as NodeExecutionContext;
    await executeOutputGallery(ctx);

    const data = node.data as OutputGalleryNodeData;
    expect(data.images).toEqual([NEW, OLD]);
    expect(data.imageRefs).toEqual(["", oldRef]);

    const next = await save(node);
    // Only the new image is written; the old one keeps its file
    expect(posted.map((body) => body.imageData)).toEqual([NEW]);
    expect(next.imageRefs![1]).toBe(oldRef);
    expect(next.imageRefs![0]).not.toBe(oldRef);
  });
});
