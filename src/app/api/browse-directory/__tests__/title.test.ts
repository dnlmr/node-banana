// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exec, writeFile } = vi.hoisted(() => ({
  exec: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("child_process", () => ({ exec }));
vi.mock("fs/promises", () => ({ writeFile, unlink: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { AGENT_LOCAL_HEADER, AGENT_LOCAL_SECRET_ENV } from "@/lib/agent/server/sameOrigin";
import { LIBRARY_GUARD_MESSAGE } from "@/lib/assets/server/guard";
import { GET } from "../route";

const LIBRARY_TITLE = "Choose where Node Banana saves your media";
const EXPORT_TITLE = "Choose a folder to export to";
const IMPORT_TITLE = "Choose a folder of Node Banana projects";
const DEFAULT_TITLE = "Select a folder to save workflows";

const realPlatform = process.platform;
function onPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

/** What server.js stamps on a request that came over a loopback connection. */
const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

/** The page's own fetch(), over a stamped loopback connection. */
const pick = (query = "") =>
  GET(
    new Request(`http://localhost:3000/api/browse-directory${query}`, {
      headers: { host: "localhost:3000", "sec-fetch-site": "same-origin", [AGENT_LOCAL_HEADER]: SECRET },
    })
  );

/** The same request from a page on another device on the network. */
const pickFromElsewhere = (query = "") =>
  GET(
    new Request(`http://192.168.1.5:3000/api/browse-directory${query}`, {
      headers: { host: "192.168.1.5:3000", "sec-fetch-site": "same-origin" },
    })
  );

beforeEach(() => {
  process.env[AGENT_LOCAL_SECRET_ENV] = SECRET;
  // promisify(exec) resolves with the callback's second argument.
  exec.mockImplementation((_command: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as (error: null, result: { stdout: string; stderr: string }) => void;
    callback(null, { stdout: "/Users/me/Media\n", stderr: "" });
  });
  writeFile.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env[AGENT_LOCAL_SECRET_ENV];
  onPlatform(realPlatform);
  vi.resetAllMocks();
});

describe("GET /api/browse-directory picker title", () => {
  it("asks for an export folder when ?purpose=export (Export, Save a copy…)", async () => {
    onPlatform("darwin");
    await pick("?purpose=export");
    expect(exec.mock.calls[0][0]).toContain(`choose folder with prompt "${EXPORT_TITLE}"`);
    onPlatform("win32");
    await pick("?purpose=export");
    expect(writeFile.mock.calls[0][1]).toContain(`[FolderPicker]::Show("${EXPORT_TITLE}")`);
  });

  it("asks for a folder of projects when ?purpose=import (Find projects in a folder…), on every platform", async () => {
    onPlatform("darwin");
    await pick("?purpose=import");
    expect(exec.mock.calls[0][0]).toContain(`choose folder with prompt "${IMPORT_TITLE}"`);
    onPlatform("win32");
    await pick("?purpose=import");
    expect(writeFile.mock.calls[0][1]).toContain(`[FolderPicker]::Show("${IMPORT_TITLE}")`);
    onPlatform("linux");
    await pick("?purpose=import");
    expect(exec.mock.calls.at(-1)?.[0]).toContain(`--title="${IMPORT_TITLE}"`);
  });

  it("asks where to save media when ?purpose=library (macOS)", async () => {
    onPlatform("darwin");
    const response = await pick("?purpose=library");
    expect(await response.json()).toEqual({ success: true, cancelled: false, path: "/Users/me/Media" });
    expect(exec.mock.calls[0][0]).toContain(`choose folder with prompt "${LIBRARY_TITLE}"`);
  });

  it("keeps the workflow title otherwise", async () => {
    onPlatform("darwin");
    await pick();
    await pick("?purpose=other");
    expect(exec.mock.calls[0][0]).toContain(`prompt "${DEFAULT_TITLE}"`);
    expect(exec.mock.calls[1][0]).toContain(`prompt "${DEFAULT_TITLE}"`);
  });

  it("titles the Windows folder dialog", async () => {
    onPlatform("win32");
    await pick("?purpose=library");
    expect(writeFile.mock.calls[0][1]).toContain(`[FolderPicker]::Show("${LIBRARY_TITLE}")`);
  });

  it("titles the Linux folder dialog", async () => {
    onPlatform("linux");
    await pick("?purpose=library");
    expect(exec.mock.calls[0][0]).toContain(`--title="${LIBRARY_TITLE}"`);
  });
});

describe("GET /api/browse-directory for the library", () => {
  it("opens no picker for a page the asset library does not answer", async () => {
    onPlatform("darwin");
    const response = await pickFromElsewhere("?purpose=library");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: LIBRARY_GUARD_MESSAGE, code: "forbidden" });
    expect(exec).not.toHaveBeenCalled();
  });

  it("refuses the workflow folder picker to other devices too", async () => {
    onPlatform("darwin");
    const response = await pickFromElsewhere();
    expect(response.status).toBe(403);
    expect(exec).not.toHaveBeenCalled();
  });
});
