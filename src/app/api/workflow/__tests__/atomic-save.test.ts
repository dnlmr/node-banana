// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Faults to inject: a disk that fills after a few bytes of any write, and a
// rename that is refused.
const fault = vi.hoisted(() => ({ diskFull: false, renameRefused: false }));

const diskFull = () => Object.assign(new Error("No space left on device"), { code: "ENOSPC" });

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  const promises = {
    ...actual.promises,
    open: async (...args: Parameters<typeof actual.promises.open>) => {
      const handle = await actual.promises.open(...args);
      if (!fault.diskFull) return handle;
      return new Proxy(handle, {
        get: (target, key) =>
          key === "writeFile"
            ? async () => {
                await target.writeFile('{"version":');
                throw diskFull();
              }
            : Reflect.get(target, key, target),
      });
    },
    rename: (from: string, to: string) =>
      fault.renameRefused
        ? Promise.reject(Object.assign(new Error("Permission denied"), { code: "EACCES" }))
        : actual.promises.rename(from, to),
  };
  return { ...actual, promises, default: { ...actual, promises } };
});
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  const writeFile = async (...args: Parameters<typeof actual.writeFile>) => {
    if (!fault.diskFull) return actual.writeFile(...args);
    await actual.writeFile(args[0], '{"version":');
    throw diskFull();
  };
  return { ...actual, writeFile, default: { ...actual, writeFile } };
});
vi.mock("@/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/assets/server/guard", () => ({ guardAssetRequest: vi.fn(() => null) }));

import { POST } from "../route";

const previous = JSON.stringify({ version: 1, nodes: [{ id: "last-good-save" }], edges: [] });
const updated = { version: 1, nodes: [{ id: "new-save" }], edges: [] };
let directory: string;
let destination: string;

function save() {
  return POST(
    new NextRequest("http://localhost:3000/api/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directoryPath: directory, filename: "workflow", workflow: updated }),
    }),
  );
}

describe("saving a workflow over an existing file", () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "node-banana-workflow-save-"));
    destination = join(directory, "workflow.json");
    await writeFile(destination, previous);
  });

  afterEach(async () => {
    fault.diskFull = false;
    fault.renameRefused = false;
    await rm(directory, { recursive: true, force: true });
  });

  it("replaces it with the new workflow and leaves no temporary file", async () => {
    expect((await save()).status).toBe(200);
    expect(JSON.parse(await readFile(destination, "utf8"))).toEqual(updated);
    expect((await readdir(directory)).sort()).toEqual(["generations", "inputs", "workflow.json"]);
  });

  it("keeps the last good save when the disk fills midway through the new one", async () => {
    fault.diskFull = true;
    expect((await save()).status).toBe(500);
    expect(await readFile(destination, "utf8")).toBe(previous);
    expect((await readdir(directory)).sort()).toEqual(["generations", "inputs", "workflow.json"]);
  });

  it("keeps the last good save when the new one cannot be put in place", async () => {
    fault.renameRefused = true;
    expect((await save()).status).toBe(500);
    expect(await readFile(destination, "utf8")).toBe(previous);
    expect((await readdir(directory)).sort()).toEqual(["generations", "inputs", "workflow.json"]);
  });
});
