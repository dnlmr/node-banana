import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import * as crypto from "crypto";

// Mock fs/promises before importing the route
const mockStat = vi.fn();
const mockMkdir = vi.fn();
const mockWriteFile = vi.fn();
const mockReaddir = vi.fn();

vi.mock("fs/promises", () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}));

// Mock logger to avoid console noise during tests
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// The request guard is covered by src/app/api/__tests__/fileRoutesGuard.test.ts.
vi.mock("@/lib/assets/server/guard", () => ({ guardAssetRequest: vi.fn(() => null) }));

// Store original fetch
const originalFetch = global.fetch;

import { POST, getExtensionFromUrl } from "../route";
import { makePng, makeWav, TINY_MP4 } from "@/lib/assets/server/__tests__/helpers";

// Helper to create mock NextRequest for POST
function createMockPostRequest(body: unknown): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

// Helper to compute expected hash for testing
function computeExpectedHash(buffer: Buffer): string {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

// Helper to create base64 data URL from string content
function createBase64DataUrl(content: string, mimeType = "image/png"): string {
  const buffer = Buffer.from(content);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

describe("/api/save-generation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch mock
    global.fetch = originalFetch;
  });

  afterEach(() => {
    vi.resetAllMocks();
    global.fetch = originalFetch;
  });

  describe("POST - Save generation", () => {
    it("should save base64 image with hash-based filename", async () => {
      const imageContent = "test-image-content";
      const base64Image = createBase64DataUrl(imageContent, "image/png");
      const expectedHash = computeExpectedHash(Buffer.from(imageContent));

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: base64Image,
        prompt: "A test image",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.isDuplicate).toBe(false);
      expect(data.filename).toContain(expectedHash);
      expect(data.filename.endsWith(".png")).toBe(true);
      expect(data.filePath).toContain("/test/generations/");
      expect(mockWriteFile).toHaveBeenCalled();
    });

    it("should save base64 video with hash-based filename", async () => {
      const videoContent = "test-video-content";
      const base64Video = createBase64DataUrl(videoContent, "video/mp4");
      const expectedHash = computeExpectedHash(Buffer.from(videoContent));

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        video: base64Video,
        prompt: "A test video",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.isDuplicate).toBe(false);
      expect(data.filename).toContain(expectedHash);
      expect(data.filename.endsWith(".mp4")).toBe(true);
    });

    it("should deduplicate existing files by hash suffix", async () => {
      const imageContent = "duplicate-image-content";
      const base64Image = createBase64DataUrl(imageContent, "image/png");
      const expectedHash = computeExpectedHash(Buffer.from(imageContent));
      const existingFilename = `existing_prompt_${expectedHash}.png`;

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([existingFilename]);

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: base64Image,
        prompt: "Another prompt",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.isDuplicate).toBe(true);
      expect(data.filename).toBe(existingFilename);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it("should reject missing directoryPath", async () => {
      const request = createMockPostRequest({
        image: createBase64DataUrl("content"),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Missing required fields");
    });

    it("should reject missing content (no image or video)", async () => {
      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        prompt: "A prompt without content",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Missing required fields");
    });

    it("should reject non-directory path", async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => false,
      });

      const request = createMockPostRequest({
        directoryPath: "/test/file.txt",
        image: createBase64DataUrl("content"),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Path is not a directory");
    });

    it("should reject non-existent directory", async () => {
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const request = createMockPostRequest({
        directoryPath: "/nonexistent/dir",
        image: createBase64DataUrl("content"),
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Directory does not exist");
    });

    it("should handle various MIME types correctly", async () => {
      const testCases = [
        { mimeType: "image/jpeg", expectedExt: ".jpg" },
        { mimeType: "image/gif", expectedExt: ".gif" },
        { mimeType: "image/webp", expectedExt: ".webp" },
        { mimeType: "video/webm", expectedExt: ".webm" },
        { mimeType: "video/quicktime", expectedExt: ".mov" },
      ];

      for (const { mimeType, expectedExt } of testCases) {
        vi.clearAllMocks();

        const content = `test-content-${mimeType}`;
        const dataUrl = createBase64DataUrl(content, mimeType);

        mockStat.mockResolvedValue({
          isDirectory: () => true,
        });
        mockReaddir.mockResolvedValue([]);
        mockWriteFile.mockResolvedValue(undefined);

        const request = createMockPostRequest({
          directoryPath: "/test/generations",
          image: dataUrl,
          prompt: "Test",
        });

        const response = await POST(request);
        const data = await response.json();

        expect(data.success).toBe(true);
        expect(data.filename.endsWith(expectedExt)).toBe(true);
      }
    });

    it("should handle HTTP URLs by fetching content", async () => {
      const mockContent = "fetched-image-content";
      const expectedHash = computeExpectedHash(Buffer.from(mockContent));

      // Mock fetch
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "image/png"]]),
        arrayBuffer: () => Promise.resolve(new TextEncoder().encode(mockContent).buffer),
      }) as unknown as typeof fetch;

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: "https://example.com/image.png",
        prompt: "Fetched image",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.filename).toContain(expectedHash);
      // Fetch is called with URL and options object containing AbortController signal
      expect(global.fetch).toHaveBeenCalledWith(
        "https://example.com/image.png",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("should handle failed HTTP fetch", async () => {
      // Mock fetch to return error
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      }) as unknown as typeof fetch;

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: "https://example.com/nonexistent.png",
        prompt: "Missing image",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Failed to fetch content");
    });

    it("should handle raw base64 without data URL prefix", async () => {
      const content = "raw-base64-content";
      const rawBase64 = Buffer.from(content).toString("base64");
      const expectedHash = computeExpectedHash(Buffer.from(content));

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: rawBase64,
        prompt: "Raw base64",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.filename).toContain(expectedHash);
      // Falls back to png when no data URL prefix
      expect(data.filename.endsWith(".png")).toBe(true);
    });

    it("should sanitize prompt for filename", async () => {
      const imageContent = "content-for-sanitize-test";
      const base64Image = createBase64DataUrl(imageContent, "image/png");

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: base64Image,
        prompt: "Hello! @World# with $pecial chars%",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      // Prompt should be sanitized - no special chars
      expect(data.filename).toMatch(/^[a-z0-9_]+_[a-f0-9]+\.png$/);
    });

    it("should use 'generation' as default prompt snippet when prompt is empty", async () => {
      const imageContent = "content-no-prompt";
      const base64Image = createBase64DataUrl(imageContent, "image/png");

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: base64Image,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.filename).toMatch(/^generation_[a-f0-9]+\.png$/);
    });

    it("should return 500 on write failure", async () => {
      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockRejectedValue(new Error("Disk full"));

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: createBase64DataUrl("content"),
        prompt: "Test",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Disk full");
    });

    it("should return imageId without extension", async () => {
      const imageContent = "content-for-id-test";
      const base64Image = createBase64DataUrl(imageContent, "image/png");
      const expectedHash = computeExpectedHash(Buffer.from(imageContent));

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/generations",
        image: base64Image,
        prompt: "Test",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.imageId).not.toContain(".png");
      expect(data.imageId).toContain(expectedHash);
    });

    it("should use custom filename when provided", async () => {
      const imageContent = "content-for-custom-filename";
      const base64Image = createBase64DataUrl(imageContent, "image/png");
      const expectedHash = computeExpectedHash(Buffer.from(imageContent));

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/outputs",
        image: base64Image,
        customFilename: "my-custom-output",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(data.filename).toBe(`my-custom-output_${expectedHash}.png`);
    });

    it("should sanitize custom filename", async () => {
      const imageContent = "content-for-sanitize-custom";
      const base64Image = createBase64DataUrl(imageContent, "image/png");
      const expectedHash = computeExpectedHash(Buffer.from(imageContent));

      mockStat.mockResolvedValue({
        isDirectory: () => true,
      });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/outputs",
        image: base64Image,
        customFilename: "My File!@#$%Name",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      // Special chars should be replaced with underscores, multiple underscores collapsed
      expect(data.filename).toBe(`My_File_Name_${expectedHash}.png`);
    });

    it("should create directory when createDirectory is true", async () => {
      const imageContent = "content-for-create-dir";
      const base64Image = createBase64DataUrl(imageContent, "image/png");

      // Directory doesn't exist initially
      mockStat.mockRejectedValue(new Error("ENOENT"));
      mockMkdir.mockResolvedValue(undefined);
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);

      const request = createMockPostRequest({
        directoryPath: "/test/outputs",
        image: base64Image,
        createDirectory: true,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(data.success).toBe(true);
      expect(mockMkdir).toHaveBeenCalledWith("/test/outputs", { recursive: true });
    });

    it("should not create directory when createDirectory is false", async () => {
      // Directory doesn't exist
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const request = createMockPostRequest({
        directoryPath: "/test/nonexistent",
        image: createBase64DataUrl("content"),
        createDirectory: false,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Directory does not exist");
      expect(mockMkdir).not.toHaveBeenCalled();
    });

    it("should handle mkdir failure", async () => {
      // Directory doesn't exist
      mockStat.mockRejectedValue(new Error("ENOENT"));
      mockMkdir.mockRejectedValue(new Error("Permission denied"));

      const request = createMockPostRequest({
        directoryPath: "/test/outputs",
        image: createBase64DataUrl("content"),
        createDirectory: true,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Failed to create output directory");
    });
  });

  // The bug: a data URL the old regex didn't match (no type, octet-stream, parameters) was
  // base64-decoded whole, header included, and the file on disk was noise.
  describe("POST - decoding inline media", () => {
    const png = makePng(5, 3);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';

    async function save(body: Record<string, unknown>) {
      mockStat.mockResolvedValue({ isDirectory: () => true });
      mockReaddir.mockResolvedValue([]);
      mockWriteFile.mockResolvedValue(undefined);
      const response = await POST(createMockPostRequest({ directoryPath: "/test/generations", prompt: "cat", ...body }));
      const data = await response.json();
      const [filePath, bytes] = (mockWriteFile.mock.calls[0] ?? []) as [string?, Buffer?];
      return { status: response.status, data, filePath, bytes };
    }

    it.each([
      ["no media type", `data:;base64,${png.toString("base64")}`],
      ["application/octet-stream", `data:application/octet-stream;base64,${png.toString("base64")}`],
      ["a ;charset= parameter", `data:image/png;charset=utf-8;base64,${png.toString("base64")}`],
    ])("writes the exact bytes of a PNG declared with %s", async (_, image) => {
      const { data, filePath, bytes } = await save({ image });
      expect(data.success).toBe(true);
      expect(Buffer.from(bytes!).equals(png)).toBe(true);
      expect(filePath).toBe(`/test/generations/cat_${computeExpectedHash(png)}.png`);
    });

    it("names the file after the bytes, not the declared type", async () => {
      const { filePath, bytes } = await save({ image: `data:image/png;base64,${jpeg.toString("base64")}` });
      expect(filePath).toBe(`/test/generations/cat_${computeExpectedHash(jpeg)}.jpg`);
      expect(Buffer.from(bytes!).equals(jpeg)).toBe(true);
    });

    it("saves image/svg+xml, percent-encoded or base64", async () => {
      const percent = await save({ image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` });
      expect(percent.filePath?.endsWith(".svg")).toBe(true);
      expect(Buffer.from(percent.bytes!).toString("utf8")).toBe(svg);
      mockWriteFile.mockClear();
      const base64 = await save({ image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` });
      expect(base64.filePath?.endsWith(".svg")).toBe(true);
      expect(Buffer.from(base64.bytes!).toString("utf8")).toBe(svg);
    });

    it("picks by kind within a container, and by the bytes over an empty type", async () => {
      const video = await save({ video: `data:;base64,${TINY_MP4.toString("base64")}` });
      expect(video.filePath?.endsWith(".mp4")).toBe(true);
      expect(Buffer.from(video.bytes!).equals(TINY_MP4)).toBe(true);
      mockWriteFile.mockClear();
      const audio = await save({ audio: `data:application/octet-stream;base64,${TINY_MP4.toString("base64")}` });
      expect(audio.filePath?.endsWith(".m4a")).toBe(true);
      mockWriteFile.mockClear();
      const wav = await save({ audio: `data:audio/mpeg;base64,${makeWav().toString("base64")}` });
      expect(wav.filePath?.endsWith(".wav")).toBe(true);
    });

    it("keeps a name its node can load back when the bytes prove a format the loaders don't serve as that kind", async () => {
      // WebM audio: /api/load-generation serves .webm as video, so an audio node would get nothing back.
      const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0x82, 0x84]);
      const audio = await save({ audio: `data:audio/webm;base64,${webm.toString("base64")}` });
      expect(audio.filePath?.endsWith(".mp3")).toBe(true);
      expect(Buffer.from(audio.bytes!).equals(webm)).toBe(true);
      mockWriteFile.mockClear();
      const untyped = await save({ audio: `data:;base64,${webm.toString("base64")}` });
      expect(untyped.filePath?.endsWith(".mp3")).toBe(true);
      mockWriteFile.mockClear();
      // AVIF: neither /api/workflow-images nor /api/load-generation looks for .avif.
      const avif = Buffer.alloc(32);
      avif.writeUInt32BE(32, 0);
      avif.write("ftypavif", 4, "latin1");
      const image = await save({ image: `data:image/avif;base64,${avif.toString("base64")}` });
      expect(image.filePath?.endsWith(".png")).toBe(true);
      expect(Buffer.from(image.bytes!).equals(avif)).toBe(true);
      mockWriteFile.mockClear();
      // WebM video still names itself.
      const video = await save({ video: `data:;base64,${webm.toString("base64")}` });
      expect(video.filePath?.endsWith(".webm")).toBe(true);
    });

    it("refuses what it can't decode instead of writing noise", async () => {
      const { status, data } = await save({ image: "data:image/png;base64,!!not base64!!" });
      expect(status).toBe(400);
      expect(data.success).toBe(false);
      mockWriteFile.mockClear();
      const raw = await save({ image: "not: base64, at all!" });
      expect(raw.status).toBe(400);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });
  });
});

describe("getExtensionFromUrl", () => {
  it("should extract .glb from a CDN URL", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.glb")).toBe("glb");
  });

  it("should extract .obj extension", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.obj")).toBe("obj");
  });

  it("should extract .fbx extension", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.fbx")).toBe("fbx");
  });

  it("should extract .usdz extension", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.usdz")).toBe("usdz");
  });

  it("should extract .stl extension", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.stl")).toBe("stl");
  });

  it("should extract .gltf extension", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.gltf")).toBe("gltf");
  });

  it("should return null for unrecognized extensions", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/file.xyz")).toBeNull();
  });

  it("should return null for URLs without extensions", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model")).toBeNull();
  });

  it("should return null for invalid URLs", () => {
    expect(getExtensionFromUrl("not-a-url")).toBeNull();
  });

  it("should handle query strings correctly", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.glb?token=abc123")).toBe("glb");
  });

  it("should handle fragments correctly", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.glb#section")).toBe("glb");
  });

  it("should return null for URL ending with dot", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.")).toBeNull();
  });

  it("should not recognize zip as a 3D extension", () => {
    expect(getExtensionFromUrl("https://cdn.example.com/model.zip")).toBeNull();
  });
});
