// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AGENT_LOCAL_HEADER, AGENT_LOCAL_SECRET_ENV } from "@/lib/agent/server/sameOrigin";
import { LibraryError } from "@/lib/assets/server";
import { ASSET_ID_PATTERN, WORKFLOW_ID_PATTERN } from "@/lib/assets/types";
import { logger } from "@/utils/logger";
import {
  HttpError,
  JOB_ID_PATTERN,
  UPLOAD_ID_PATTERN,
  checkDeclaredLength,
  errorResponse,
  formatLimit,
  handle,
  isLibraryError,
  mediaType,
  pathParam,
  readBytes,
  readJson,
} from "../http";

afterEach(() => {
  delete process.env[AGENT_LOCAL_SECRET_ENV];
  vi.clearAllMocks();
});

const put = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost:3000/api/assets/x", { method: "PUT", body, headers });

/** A body that arrives in chunks and never declares its length. */
function chunked(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    pull(controller) {
      const next = chunks.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
}

const streamed = (stream: ReadableStream<Uint8Array>) =>
  new Request("http://localhost:3000/api/assets/x", { method: "PUT", body: stream, duplex: "half" } as RequestInit);

describe("errorResponse", () => {
  it("answers an HttpError with its status and code", async () => {
    const response = errorResponse(new HttpError(404, "No such asset."), "t");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No such asset.", code: "not_found" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a LibraryError with its status and code", async () => {
    const response = errorResponse(new LibraryError("That folder is inside the library.", 409, "conflict"), "t");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "That folder is inside the library.", code: "conflict" });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("answers a paused library with 503 and Retry-After: 5, whatever status it carried", async () => {
    const response = errorResponse(new LibraryError("The library is moving.", 409, "paused"), "t");
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await response.json()).toEqual({ error: "The library is moving.", code: "paused" });
  });

  it("recognises a LibraryError from another copy of the module by its shape", () => {
    const foreign = Object.assign(new Error("Busy"), { name: "LibraryError", status: 423, code: "locked" });
    expect(isLibraryError(foreign)).toBe(true);
    expect(errorResponse(foreign, "t").status).toBe(423);
    expect(isLibraryError(Object.assign(new Error("x"), { name: "LibraryError" }))).toBe(false);
    expect(isLibraryError({ name: "LibraryError", status: 400, code: "x" })).toBe(false);
  });

  it("keeps a nonsense status out of the response and logs library 5xx", async () => {
    expect(errorResponse(new LibraryError("odd", 200, "odd"), "t").status).toBe(500);
    const unavailable = errorResponse(new LibraryError("Disk is read-only.", 507, "read_only"), "assets.record");
    expect(unavailable.status).toBe(507);
    expect(logger.warn).toHaveBeenCalledWith(
      "api.error",
      "Asset library failed: assets.record",
      expect.objectContaining({ status: 507, code: "read_only" }),
    );
  });

  it("answers anything else with 500 and logs it", async () => {
    const boom = new Error("EACCES: permission denied");
    const response = errorResponse(boom, "assets.list");
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "EACCES: permission denied", code: "internal" });
    expect(logger.error).toHaveBeenCalledWith("api.error", "Asset route failed: assets.list", { route: "assets.list" }, boom);
    expect(await errorResponse("weird", "t").json()).toEqual({
      error: "The asset library could not answer.",
      code: "internal",
    });
  });
});

describe("handle", () => {
  it("refuses before running the handler when the guard says no", async () => {
    const run = vi.fn();
    const response = await handle(new Request("http://localhost:3000/api/assets", { headers: { host: "localhost:3000" } }), "t", run);
    expect(response.status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the handler for the page and maps what it throws", async () => {
    const secret = "s".repeat(40);
    process.env[AGENT_LOCAL_SECRET_ENV] = secret;
    const request = new Request("http://localhost:3000/api/assets", {
      headers: { host: "localhost:3000", "sec-fetch-site": "same-origin", [AGENT_LOCAL_HEADER]: secret },
    });
    expect((await handle(request, "t", async () => new Response("fine"))).status).toBe(200);
    const thrown = await handle(request, "t", async () => {
      throw new HttpError(400, "Invalid asset id.");
    });
    expect(thrown.status).toBe(400);
    expect(await thrown.json()).toEqual({ error: "Invalid asset id.", code: "bad_request" });
  });
});

describe("readJson", () => {
  it("parses a JSON body", async () => {
    expect(await readJson(put(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it("refuses a body that is not JSON, or no body at all, with a 400", async () => {
    await expect(readJson(put("{nope"))).rejects.toMatchObject({ status: 400, message: "The request body is not JSON." });
    await expect(readJson(put(null))).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a declared length over the limit before reading", async () => {
    await expect(readJson(put("{}", { "content-length": "2000" }), 1000)).rejects.toMatchObject({
      status: 413,
      code: "too_large",
    });
  });

  it("refuses a body that streams past the limit without a declared length", async () => {
    const body = chunked([new TextEncoder().encode('{"a":"'), new Uint8Array(2000).fill(97), new TextEncoder().encode('"}')]);
    await expect(readJson(streamed(body), 1000)).rejects.toMatchObject({ status: 413 });
  });

  it("names the limit in the refusal", async () => {
    await expect(readJson(put("{}", { "content-length": String(2 * 1024 * 1024) }))).rejects.toMatchObject({
      message: "The request body is over the 1 MB limit.",
    });
  });
});

describe("readBytes", () => {
  it("reads a small body whole", async () => {
    const bytes = await readBytes(put(new Uint8Array([1, 2, 3])), 10);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("refuses an empty body, and a body over the limit however it arrives", async () => {
    await expect(readBytes(put(null), 10)).rejects.toMatchObject({ status: 400 });
    await expect(readBytes(put(new Uint8Array(0)), 10)).rejects.toMatchObject({ status: 400 });
    await expect(readBytes(put(new Uint8Array(20), { "content-length": "20" }), 10)).rejects.toMatchObject({ status: 413 });
    await expect(readBytes(streamed(chunked([new Uint8Array(6), new Uint8Array(6)])), 10)).rejects.toMatchObject({
      status: 413,
    });
  });
});

describe("pathParam", () => {
  it("accepts a value matching its pattern", () => {
    expect(pathParam("a0123456789abc", ASSET_ID_PATTERN, "asset id")).toBe("a0123456789abc");
  });

  it("decodes before checking, so an encoded workflow id arrives whole", () => {
    expect(pathParam("wf%3Aproject.v2", WORKFLOW_ID_PATTERN, "workflow id")).toBe("wf:project.v2");
    expect(pathParam("wf:project.v2", WORKFLOW_ID_PATTERN, "workflow id")).toBe("wf:project.v2");
  });

  it("refuses anything else with a 400 naming the parameter", () => {
    for (const raw of ["", undefined, "../a0123456789abc", "A0123456789ABC", "a0123456789abc%2F", "%E0%A4%A"]) {
      expect(() => pathParam(raw, ASSET_ID_PATTERN, "asset id"), String(raw)).toThrow(
        expect.objectContaining({ status: 400, message: "Invalid asset id." }),
      );
    }
    expect(() => pathParam("wf%2F..%2Fx", WORKFLOW_ID_PATTERN, "workflow id")).toThrow(HttpError);
  });

  it("upload and job ids are plain tokens", () => {
    expect(UPLOAD_ID_PATTERN.test("3f2a9c1e-7b4d-4e8a-9f00-1c2d3e4f5a6b")).toBe(true);
    expect(UPLOAD_ID_PATTERN.test("../x")).toBe(false);
    expect(JOB_ID_PATTERN.test("job_1")).toBe(true);
    expect(JOB_ID_PATTERN.test("x".repeat(65))).toBe(false);
  });
});

describe("small helpers", () => {
  it("checkDeclaredLength refuses only a declared length over the limit", () => {
    expect(() => checkDeclaredLength(put("x", { "content-length": "11" }), 10)).toThrow(
      expect.objectContaining({ status: 413 }),
    );
    expect(() => checkDeclaredLength(put("x"), 10)).not.toThrow();
  });

  it("mediaType drops parameters and refuses malformed types", () => {
    expect(mediaType("Image/WebP; charset=binary")).toBe("image/webp");
    expect(mediaType("video/mp4")).toBe("video/mp4");
    expect(mediaType("model/gltf-binary")).toBe("model/gltf-binary");
    expect(mediaType("not a type")).toBeNull();
    expect(mediaType("text/html\r\nx: y")).toBeNull();
    expect(mediaType(null)).toBeNull();
  });

  it("formatLimit names gigabytes", () => {
    expect(formatLimit(2 * 1024 * 1024 * 1024)).toBe("2 GB");
    expect(formatLimit(16 * 1024 * 1024)).toBe("16 MB");
  });
});
