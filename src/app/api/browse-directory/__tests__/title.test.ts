// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exec, writeFile } = vi.hoisted(() => ({
  exec: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("child_process", () => ({ exec }));
vi.mock("fs/promises", () => ({ writeFile, unlink: vi.fn().mockResolvedValue(undefined) }));
// The request guard is covered by src/app/api/__tests__/fileRoutesGuard.test.ts.
vi.mock("@/lib/assets/server/guard", () => ({ guardAssetRequest: vi.fn(() => null) }));

import { GET } from "../route";

const LIBRARY_TITLE = "Choose where Node Banana saves your media";
const DEFAULT_TITLE = "Select a folder to save workflows";

const realPlatform = process.platform;
function onPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
}

const pick = (query = "") => GET(new Request(`http://localhost:3000/api/browse-directory${query}`));

beforeEach(() => {
  // promisify(exec) resolves with the callback's second argument.
  exec.mockImplementation((_command: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as (error: null, result: { stdout: string; stderr: string }) => void;
    callback(null, { stdout: "/Users/me/Media\n", stderr: "" });
  });
  writeFile.mockResolvedValue(undefined);
});

afterEach(() => {
  onPlatform(realPlatform);
  vi.resetAllMocks();
});

describe("GET /api/browse-directory picker title", () => {
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
