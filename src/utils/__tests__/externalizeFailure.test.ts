/**
 * One node's media failing to save must not fail the whole workflow save.
 * The save routes refuse bytes they can't decode (a data URL whose payload
 * isn't base64) instead of writing noise; that node keeps its media inline,
 * as an unsaved workflow does, and every other node is written out as usual.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { externalizeWorkflowMedia } from "../mediaStorage";
import type { WorkflowFile } from "@/types";

const GOOD = "data:image/png;base64,aW1hZ2U=";
const BAD = "data:image/png;base64,not base64 at all!";

const workflow = (): WorkflowFile =>
  ({
    nodes: [
      { id: "imageInput-1", type: "imageInput", position: { x: 0, y: 0 }, data: { image: GOOD } },
      { id: "imageInput-2", type: "imageInput", position: { x: 0, y: 0 }, data: { image: BAD } },
    ],
    edges: [],
  }) as unknown as WorkflowFile;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { imageData: string; imageId: string };
      const ok = body.imageData === GOOD;
      return {
        ok,
        status: ok ? 200 : 400,
        json: async () => (ok ? { success: true, imageId: body.imageId } : { success: false, error: "Could not decode the image data" }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("externalizeWorkflowMedia", () => {
  it("keeps a node's media inline when the server refuses it, and saves the rest", async () => {
    const result = await externalizeWorkflowMedia(workflow(), "/projects/demo");
    const [good, bad] = result.nodes.map((node) => node.data as { image: string | null; imageRef?: string });
    expect(good.image).toBeNull();
    expect(good.imageRef).toEqual(expect.any(String));
    expect(bad.image).toBe(BAD);
    expect(bad.imageRef).toBeUndefined();
  });
});
