import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SnapshotMediaRef, SnapshotWorkflow } from "../../types";
import { dataUrlOf, fakeMediaServer, jsonBody, jsonResponse, readText, sha256Of } from "./helpers";

type SnapshotModule = typeof import("../snapshot");
let snapshot: SnapshotModule;

beforeEach(async () => {
  // The module keeps a string→hash map between snapshots; start each test without one.
  vi.resetModules();
  snapshot = await import("../snapshot");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const INPUT = dataUrlOf("INPUT", "image/jpeg");
const OUTPUT = dataUrlOf("OUTPUT");
const VIDEO_URL = "blob:http://localhost/video-1";

function graphFixture(overrides: { nodes?: unknown[] } = {}) {
  return snapshot.captureGraph({
    nodes: overrides.nodes ?? [
      { id: "imageInput-1", type: "imageInput", position: { x: 0, y: 0 }, selected: true, data: { image: INPUT, filename: "in.jpg" } },
      {
        id: "nanoBanana-1",
        type: "nanoBanana",
        position: { x: 300, y: 0 },
        dragging: true,
        data: {
          inputImages: [INPUT],
          outputImage: OUTPUT,
          status: "loading",
          jobId: "job-1",
          abortController: new AbortController(),
          execution: { startedAt: 1 },
          remote: "https://cdn.example.com/a.png",
          prose: "data: the numbers, all of them",
          imageHistory: [{ id: "1", assetId: "a1" }],
          crafted: { $nbMedia: "f".repeat(64), mime: "image/png", $nbMediaEscaped: "keep" },
        },
      },
      { id: "videoStitch-1", type: "videoStitch", position: { x: 600, y: 0 }, data: { outputVideo: VIDEO_URL, status: "complete" } },
    ],
    edges: [{ id: "e1", source: "imageInput-1", target: "nanoBanana-1", selected: true }],
    groups: { g1: { id: "g1", name: "Group" } },
    edgeStyle: "curved",
    edgeAppearance: { thickness: 2 },
    workflowId: "wf_1_cats",
    workflowName: "Cats",
  });
}

function nodeData(workflow: SnapshotWorkflow, index: number): Record<string, unknown> {
  return (workflow.nodes[index] as { data: Record<string, unknown> }).data;
}

describe("captureGraph", () => {
  it("holds the store's fields by reference", () => {
    const nodes: unknown[] = [];
    const graph = snapshot.captureGraph({ nodes, edges: [], edgeStyle: "curved", workflowId: "wf", workflowName: null });
    expect(graph.nodes).toBe(nodes);
    expect(graph.workflowId).toBe("wf");
  });

  it("refuses a workflow without an id", () => {
    expect(() => snapshot.captureGraph({ nodes: [], edges: [], edgeStyle: "curved", workflowId: null, workflowName: null })).toThrow(
      /workflow id/,
    );
  });
});

describe("encodeSnapshot", () => {
  it("replaces media with refs, strips run-time fields and escapes crafted refs", async () => {
    const server = fakeMediaServer();
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    const { workflow, mediaHashes } = await snapshot.encodeSnapshot(graphFixture());

    const inputRef: SnapshotMediaRef = { $nbMedia: await sha256Of("INPUT"), mime: "image/jpeg", bytes: 5 };
    const outputRef: SnapshotMediaRef = { $nbMedia: await sha256Of("OUTPUT"), mime: "image/png", bytes: 6 };
    const videoRef: SnapshotMediaRef = { $nbMedia: await sha256Of("VIDEO"), mime: "video/mp4", bytes: 5 };

    expect(workflow).toMatchObject({ version: 1, id: "wf_1_cats", name: "Cats", edgeStyle: "curved", edgeAppearance: { thickness: 2 } });
    expect(workflow.nodes[0]).not.toHaveProperty("selected");
    expect(workflow.nodes[1]).not.toHaveProperty("dragging");
    expect(nodeData(workflow, 0).image).toEqual(inputRef);
    const generator = nodeData(workflow, 1);
    expect(generator.inputImages).toEqual([inputRef]);
    expect(generator.outputImage).toEqual(outputRef);
    expect(generator).not.toHaveProperty("jobId");
    expect(generator).not.toHaveProperty("abortController");
    expect(generator).not.toHaveProperty("execution");
    expect(generator.status).toBe("loading");
    expect(generator.remote).toBe("https://cdn.example.com/a.png");
    expect(generator.prose).toBe("data: the numbers, all of them");
    expect(generator.crafted).toEqual({ $nbMediaEscaped: "f".repeat(64), mime: "image/png", $nbMediaEscapedEscaped: "keep" });
    expect(nodeData(workflow, 2).outputVideo).toEqual(videoRef);
    expect(workflow.edges[0]).not.toHaveProperty("selected");
    expect(workflow.groups).toEqual({ g1: { id: "g1", name: "Group" } });
    expect(new Set(mediaHashes)).toEqual(new Set([inputRef.$nbMedia, outputRef.$nbMedia, videoRef.$nbMedia]));
    expect(JSON.stringify(workflow)).not.toMatch(/data:image|blob:/);
  });

  it("asks media/has for every hash and uploads only what is missing", async () => {
    const server = fakeMediaServer();
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    server.media.set(await sha256Of("INPUT"), new Blob(["INPUT"]));

    await snapshot.encodeSnapshot(graphFixture());

    const has = server.calls.filter((call) => call.url === "/api/assets/media/has");
    expect(has).toHaveLength(1);
    expect(jsonBody<{ hashes: string[] }>(has[0]).hashes).toHaveLength(3);
    const uploads = server.calls.filter((call) => call.method === "PUT").map((call) => call.url);
    expect(uploads.sort()).toEqual([`/api/assets/media/${await sha256Of("OUTPUT")}`, `/api/assets/media/${await sha256Of("VIDEO")}`].sort());
    await expect(readText(server.media.get(await sha256Of("VIDEO"))!)).resolves.toBe("VIDEO");
    expect(server.media.get(await sha256Of("OUTPUT"))!.type).toBe("image/png");
  });

  it("hashes each string once while the graph keeps it, and forgets strings the graph dropped", async () => {
    const server = fakeMediaServer();
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    const digest = vi.spyOn(crypto.subtle, "digest");

    await snapshot.encodeSnapshot(graphFixture());
    expect(digest).toHaveBeenCalledTimes(3);

    digest.mockClear();
    await snapshot.encodeSnapshot(graphFixture());
    expect(digest).not.toHaveBeenCalled();
    // Nothing is missing any more, so nothing is uploaded again.
    expect(server.calls.filter((call) => call.method === "PUT")).toHaveLength(3);

    // A graph without the output rebuilds the map without it…
    await snapshot.encodeSnapshot(graphFixture({ nodes: [{ id: "imageInput-1", type: "imageInput", data: { image: INPUT } }] }));
    expect(digest).not.toHaveBeenCalled();
    // …so it is hashed again when it comes back.
    await snapshot.encodeSnapshot(graphFixture({ nodes: [{ id: "n", type: "nanoBanana", data: { outputImage: OUTPUT } }] }));
    expect(digest).toHaveBeenCalledTimes(1);
  });

  it("uses a remembered hash without hashing or uploading", async () => {
    const server = fakeMediaServer();
    const digest = vi.spyOn(crypto.subtle, "digest");
    const sha = "c".repeat(64);
    snapshot.rememberMediaHash(OUTPUT, sha, "image/png", 6);
    server.media.set(sha, new Blob(["OUTPUT"]));

    const { workflow } = await snapshot.encodeSnapshot(graphFixture({ nodes: [{ id: "n", type: "nanoBanana", data: { outputImage: OUTPUT } }] }));
    expect(digest).not.toHaveBeenCalled();
    expect(nodeData(workflow, 0).outputImage).toEqual({ $nbMedia: sha, mime: "image/png", bytes: 6 });
    expect(server.calls.filter((call) => call.method === "PUT")).toHaveLength(0);
  });

  it("ignores a remembered hash that is not a SHA-256", async () => {
    fakeMediaServer();
    snapshot.rememberMediaHash(OUTPUT, "not-a-hash", "image/png", 6);
    const { workflow } = await snapshot.encodeSnapshot(graphFixture({ nodes: [{ id: "n", type: "nanoBanana", data: { outputImage: OUTPUT } }] }));
    expect((nodeData(workflow, 0).outputImage as SnapshotMediaRef).$nbMedia).toBe(await sha256Of("OUTPUT"));
  });

  it("binds blob: URLs when the call is made, before a revoke can lose them", async () => {
    const server = fakeMediaServer();
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    const encoding = snapshot.encodeSnapshot(graphFixture());
    server.blobs.delete(VIDEO_URL);
    const { workflow } = await encoding;
    expect((nodeData(workflow, 2).outputVideo as SnapshotMediaRef).$nbMedia).toBe(await sha256Of("VIDEO"));
  });

  it("reads prefetched blob: URLs captured with the graph", async () => {
    const server = fakeMediaServer();
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    const graph = graphFixture();
    const prefetched = snapshot.prefetchBlobUrls(graph);
    server.blobs.delete(VIDEO_URL);
    const { workflow } = await snapshot.encodeSnapshot(graph, { prefetched });
    expect((nodeData(workflow, 2).outputVideo as SnapshotMediaRef).bytes).toBe(5);
  });

  it("stores unreadable media as null", async () => {
    fakeMediaServer();
    const { workflow, mediaHashes } = await snapshot.encodeSnapshot(graphFixture());
    expect(nodeData(workflow, 2).outputVideo).toBeNull();
    expect(mediaHashes).toHaveLength(2);
  });

  it("rejects when a transient upload fails, so the caller can retry", async () => {
    const server = fakeMediaServer((call) =>
      call.method === "PUT" ? jsonResponse({ error: "Moving" }, { status: 503, headers: { "Retry-After": "1" } }) : undefined,
    );
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    await expect(snapshot.encodeSnapshot(graphFixture())).rejects.toMatchObject({ status: 503 });
  });

  it("carries on past a refused upload", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const server = fakeMediaServer((call) =>
      call.method === "PUT" && call.headers["x-nb-mime"] === "video/mp4" ? jsonResponse({ error: "Too big" }, { status: 413 }) : undefined,
    );
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    const { mediaHashes } = await snapshot.encodeSnapshot(graphFixture());
    expect(mediaHashes).toHaveLength(3);
    expect(server.media.size).toBe(2);
  });

  it("rejects when media/has cannot be asked", async () => {
    fakeMediaServer((call) => (call.url === "/api/assets/media/has" ? jsonResponse({ error: "down" }, { status: 503 }) : undefined));
    await expect(snapshot.encodeSnapshot(graphFixture({ nodes: [{ id: "n", data: { image: INPUT } }] }))).rejects.toMatchObject({
      status: 503,
    });
  });

  it("reads back the bytes behind a hash for a later upload", async () => {
    const server = fakeMediaServer();
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    const encoded = await snapshot.encodeSnapshot(graphFixture());
    await expect(readText((await encoded.readMedia!(await sha256Of("INPUT")))!)).resolves.toBe("INPUT");
    await expect(encoded.readMedia!("0".repeat(64))).resolves.toBeNull();
  });
});

describe("hydrateSnapshot", () => {
  it("round-trips an encoded graph back to media strings", async () => {
    const server = fakeMediaServer();
    server.blobs.set(VIDEO_URL, new Blob(["VIDEO"], { type: "video/mp4" }));
    const { workflow } = await snapshot.encodeSnapshot(graphFixture());
    const file = await snapshot.hydrateSnapshot(JSON.parse(JSON.stringify(workflow)) as SnapshotWorkflow);

    expect(file).toMatchObject({ version: 1, id: "wf_1_cats", name: "Cats", edgeStyle: "curved", edgeAppearance: { thickness: 2 } });
    const nodes = file.nodes as unknown as { data: Record<string, unknown> }[];
    expect(nodes[0].data.image).toBe(INPUT);
    expect(nodes[1].data.inputImages).toEqual([INPUT]);
    expect(nodes[1].data.outputImage).toBe(OUTPUT);
    expect(nodes[1].data.crafted).toEqual({ $nbMedia: "f".repeat(64), mime: "image/png", $nbMediaEscaped: "keep" });
    expect(nodes[2].data.outputVideo).toBe(`data:video/mp4;base64,${btoa("VIDEO")}`);
    expect(file.groups).toEqual({ g1: { id: "g1", name: "Group" } });
    // One download per distinct media.
    expect(server.calls.filter((call) => call.method === "GET" && call.url.startsWith("/api/assets/media/"))).toHaveLength(3);
  });

  it("opens a large video as a blob: URL", async () => {
    const server = fakeMediaServer();
    const sha = "d".repeat(64);
    server.media.set(sha, new Blob([new Uint8Array(snapshot.INLINE_VIDEO_LIMIT + 1)], { type: "video/mp4" }));
    const createObjectURL = vi.fn(() => "blob:http://localhost/big");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));

    const file = await snapshot.hydrateSnapshot({
      version: 1,
      name: "Big",
      nodes: [{ id: "v", type: "videoInput", data: { video: { $nbMedia: sha, mime: "video/mp4" } } }],
      edges: [],
      edgeStyle: "curved",
    });
    expect((file.nodes[0].data as { video: string }).video).toBe("blob:http://localhost/big");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("leaves null where the server no longer has the media", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeMediaServer();
    const file = await snapshot.hydrateSnapshot({
      version: 1,
      name: "Gone",
      nodes: [{ id: "i", type: "imageInput", data: { image: { $nbMedia: "e".repeat(64), mime: "image/png" }, list: [{ $nbMedia: "bad" }] } }],
      edges: [],
      edgeStyle: "curved",
    });
    expect(file.nodes[0].data).toEqual({ image: null, list: [null] });
  });

  it("refuses something that is not a snapshot", async () => {
    await expect(snapshot.hydrateSnapshot({ version: 2 } as unknown as SnapshotWorkflow)).rejects.toThrow(/can't be read/);
  });
});
