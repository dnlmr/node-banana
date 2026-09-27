// @vitest-environment node
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Temp folders are never system folders, so one stands in for them: any
// folder named "SystemFolder" is refused like /System or C:\Windows.
vi.mock("@/utils/pathValidation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/pathValidation")>();
  return {
    ...actual,
    validateWorkflowPath: (inputPath: string, pathModule?: import("@/utils/pathValidation").PathModule) =>
      path.basename(inputPath) === "SystemFolder"
        ? { valid: false, resolved: inputPath, error: "Access to SystemFolder is not allowed" }
        : actual.validateWorkflowPath(inputPath, pathModule),
  };
});

import { FOUND_MEDIA_COUNT_CAP, MAX_IMPORT_PROJECTS } from "../../types";
import { __resetAssetLibraryForTests, getLibraryStatus, LibraryError, scanProjects } from "../index";
import { normaliseImportDirs } from "../jobs";
import { findProjects, resolveScanRoot, SCAN_LIMITS } from "../projects";
import { MAX_PROJECT_DIR_LENGTH } from "../validate";
import { makePng, tempDir } from "./helpers";

let base: string;
let root: string;

beforeEach(() => {
  base = tempDir("nb-scan-");
  root = path.join(base, "Projects");
  fs.mkdirSync(root);
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** A project folder: `generations/` holding `media` (PNGs by default), plus any extra files. */
function project(dir: string, media: string[] = ["one.png"], files: Record<string, string | Buffer> = {}): string {
  fs.mkdirSync(path.join(dir, "generations"), { recursive: true });
  media.forEach((name, i) => fs.writeFileSync(path.join(dir, "generations", name), makePng(2, 2, i)));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

/** A saved workflow file, as the app writes it (its name near the start). */
function workflowFile(name: string | null): string {
  return JSON.stringify({ version: 1, id: "wf_1", ...(name === null ? {} : { name }), nodes: [], edges: [], edgeStyle: "curved" });
}

function setMtime(file: string, seconds: number): void {
  fs.utimesSync(file, seconds, seconds);
}

function linkDir(target: string, link: string): void {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

const dirs = (projects: { dir: string }[]) => projects.map((found) => path.relative(root, found.dir).split(path.sep).join("/"));

describe("findProjects", () => {
  it("finds projects inside other projects' subfolders and five levels down", async () => {
    project(path.join(root, "Campaign"));
    project(path.join(root, "Campaign", "Variations"));
    project(path.join(root, "Campaign", "Variations", "Night"));
    project(path.join(root, "clients", "acme", "2026", "spring", "Launch"));
    project(path.join(root, "a", "b", "c", "d", "e"));

    const result = await findProjects(root);

    expect(dirs(result.projects)).toEqual([
      "Campaign",
      "Campaign/Variations",
      "Campaign/Variations/Night",
      "a/b/c/d/e",
      "clients/acme/2026/spring/Launch",
    ]);
    expect(result).toMatchObject({ root, truncated: false, unreadable: 0 });
  });

  it("reports the folder it was given when that is a project", async () => {
    project(root);
    project(path.join(root, "Nested"));
    const result = await findProjects(root);
    expect(result.projects.map((found) => found.dir)).toEqual([root, path.join(root, "Nested")]);
  });

  it("never looks inside a project's generations, inputs, outputs or .images", async () => {
    const campaign = project(path.join(root, "Campaign"));
    for (const media of ["generations", "inputs", "outputs", ".images"]) project(path.join(campaign, media, "Inner"));
    // The same names mean nothing special outside a project.
    project(path.join(root, "outputs", "Final"));

    expect(dirs((await findProjects(root)).projects)).toEqual(["Campaign", "outputs/Final"]);
  });

  it("counts the media files directly in generations, nothing else", async () => {
    const dir = project(path.join(root, "Mixed"), ["a.png", "b.mp4", "c.wav", "d.glb", "notes.txt", "x.png.partial"]);
    fs.mkdirSync(path.join(dir, "generations", "old.png"));
    fs.writeFileSync(path.join(dir, "generations", "sub.png"), "");

    const [found] = (await findProjects(root)).projects;
    // Four media files and an empty one; a folder named like an image is not a file.
    expect(found.mediaCount).toBe(5);
  });

  it("stops counting a project's media at the cap", async () => {
    project(path.join(root, "Big"), ["1.png", "2.png", "3.png", "4.png", "5.png"]);
    const result = await findProjects(root, { limits: { maxMediaCount: 3 } });
    expect(result.projects[0].mediaCount).toBe(3);
    expect(SCAN_LIMITS.maxMediaCount).toBe(FOUND_MEDIA_COUNT_CAP);
  });

  it("does not report a folder whose generations folder holds no media, but searches below it", async () => {
    fs.mkdirSync(path.join(root, "Empty", "generations"), { recursive: true });
    project(path.join(root, "NoMedia"), [], { "generations/readme.txt": "hello" });
    project(path.join(root, "Empty", "Later"));

    expect(dirs((await findProjects(root)).projects)).toEqual(["Empty/Later"]);
  });

  it("skips hidden, package and build folders", async () => {
    for (const skipped of [".hidden", ".git", ".next", "node_modules", "__pycache__", "app/node_modules/pkg"]) {
      project(path.join(root, skipped, "Project"));
    }
    project(path.join(root, "app", "Visible"));

    expect(dirs((await findProjects(root)).projects)).toEqual(["app/Visible"]);
  });

  it("does not search a system folder the import would refuse", async () => {
    project(path.join(root, "SystemFolder", "Project"));
    project(path.join(root, "Mine"));
    expect(dirs((await findProjects(root)).projects)).toEqual(["Mine"]);
  });

  it("does not search a folder whose path is too long for the import, which would refuse the whole batch", async () => {
    const long = project(path.join(root, "x".repeat(40), "Project"));
    const short = project(path.join(root, "Short"));
    const limit = long.length - 1;

    const result = await findProjects(root, { limits: { maxPathLength: limit } });

    expect(result.projects.map((found) => found.dir)).toEqual([short]);
    expect(result).toMatchObject({ truncated: false, unreadable: 0 });
    // What it does report, an import takes.
    expect(normaliseImportDirs(result.projects.map((found) => found.dir))).toEqual([short]);
    expect(SCAN_LIMITS.maxPathLength).toBe(MAX_PROJECT_DIR_LENGTH);
    expect(() => normaliseImportDirs([`/${"x".repeat(MAX_PROJECT_DIR_LENGTH)}`])).toThrow("Invalid project folder");
  });

  it("never follows a symbolic link, so a loop ends and a linked project is found once", async () => {
    project(path.join(root, "Real"));
    linkDir(root, path.join(root, "loop"));
    linkDir(path.join(root, "Real"), path.join(root, "Real link"));
    const elsewhere = project(path.join(base, "Elsewhere"));
    linkDir(elsewhere, path.join(root, "Elsewhere link"));

    const result = await findProjects(root);

    expect(dirs(result.projects)).toEqual(["Real"]);
    expect(result).toMatchObject({ truncated: false, unreadable: 0 });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "counts a folder it can't read and carries on",
    async () => {
      const locked = path.join(root, "Locked");
      project(path.join(locked, "Inside"));
      project(path.join(root, "Open"));
      fs.chmodSync(locked, 0o000);
      try {
        const result = await findProjects(root);
        expect(dirs(result.projects)).toEqual(["Open"]);
        expect(result.unreadable).toBe(1);
        expect(result.truncated).toBe(false);
      } finally {
        fs.chmodSync(locked, 0o755);
      }
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "counts a generations folder it can't read, and reports no project for it",
    async () => {
      const dir = project(path.join(root, "Private"));
      fs.chmodSync(path.join(dir, "generations"), 0o000);
      try {
        const result = await findProjects(root);
        expect(result.projects).toEqual([]);
        expect(result.unreadable).toBe(1);
      } finally {
        fs.chmodSync(path.join(dir, "generations"), 0o755);
      }
    },
  );

  it("never enters an excluded folder, and finds nothing when asked to search inside one", async () => {
    const library = path.join(root, "Node Banana");
    project(path.join(library, "Generations", "Tucked away"));
    project(path.join(library, "My project"));

    const result = await findProjects(root, { exclude: [path.join(library, "Generations")] });
    expect(dirs(result.projects)).toEqual(["Node Banana/My project"]);

    const inside = await findProjects(path.join(library, "Generations"), { exclude: [path.join(library, "Generations")] });
    expect(inside.projects).toEqual([]);
  });

  describe("names", () => {
    it("takes the name of the newest workflow file, ignoring JSON that isn't a workflow", async () => {
      const dir = project(path.join(root, "folder-name"), ["a.png"], {
        "old.json": workflowFile("Old name"),
        "current.json": workflowFile('Spring "hero" shots'),
        "package.json": JSON.stringify({ name: "not-a-workflow", version: "1.0.0" }),
      });
      setMtime(path.join(dir, "old.json"), 1_000);
      setMtime(path.join(dir, "current.json"), 2_000);
      setMtime(path.join(dir, "package.json"), 3_000);

      expect((await findProjects(root)).projects[0].name).toBe('Spring "hero" shots');
    });

    it("falls back to the folder's name without a workflow file, or when the newest has no name", async () => {
      project(path.join(root, "Plain"));
      const unnamed = project(path.join(root, "Unnamed"), ["a.png"], {
        "named.json": workflowFile("Older name"),
        "unnamed.json": workflowFile(null),
      });
      setMtime(path.join(unnamed, "named.json"), 1_000);
      setMtime(path.join(unnamed, "unnamed.json"), 2_000);

      expect((await findProjects(root)).projects.map((found) => found.name)).toEqual(["Plain", "Unnamed"]);
    });

    it("reads only the start of a workflow file", async () => {
      const huge = `{"version":1,"name":"Huge","nodes":[${'{"id":"n","data":{"image":"data:image/png;base64,AAAA"}},'.repeat(50_000)}{}],"edges":[]}`;
      const dir = project(path.join(root, "huge-folder"), ["a.png"], { "workflow.json": huge });
      const read = vi.spyOn(JSON, "parse");
      try {
        expect((await findProjects(root)).projects[0].name).toBe("Huge");
        // "edges" is only at the end of the file.
        expect(read.mock.calls.some(([text]) => String(text).includes('"edges"'))).toBe(false);
      } finally {
        read.mockRestore();
      }
      expect(fs.statSync(path.join(dir, "workflow.json")).size).toBeGreaterThan(1024 * 1024);
    });
  });

  describe("bounds", () => {
    it("searches eight levels below the folder by default, and no deeper", async () => {
      const eight = ["1", "2", "3", "4", "5", "6", "7", "8"];
      project(path.join(root, ...eight));
      project(path.join(root, "x", ...eight));

      const result = await findProjects(root);
      expect(dirs(result.projects)).toEqual(["1/2/3/4/5/6/7/8"]);
      expect(result.truncated).toBe(false);
      expect(SCAN_LIMITS.maxDepth).toBe(8);
    });

    it("keeps to a smaller depth when given one", async () => {
      project(path.join(root, "one", "Second"));
      project(path.join(root, "one", "deeper", "Third"));
      expect(dirs((await findProjects(root, { limits: { maxDepth: 2 } })).projects)).toEqual(["one/Second"]);
    });

    it("stops after reading as many folders as it may, and says so", async () => {
      project(path.join(root, "A"));
      project(path.join(root, "B"));
      project(path.join(root, "C", "Deep"));

      // The root, A and B: C is never read.
      const result = await findProjects(root, { limits: { maxDirs: 3 } });
      expect(dirs(result.projects)).toEqual(["A", "B"]);
      expect(result.truncated).toBe(true);

      // Enough to read every folder: nothing was left.
      const whole = await findProjects(root, { limits: { maxDirs: 5 } });
      expect(dirs(whole.projects)).toEqual(["A", "B", "C/Deep"]);
      expect(whole.truncated).toBe(false);
      expect(SCAN_LIMITS.maxDirs).toBe(20_000);
    });

    it("stops at the project cap, and says so only when there were more", async () => {
      for (const name of ["A", "B", "C"]) project(path.join(root, name));

      const capped = await findProjects(root, { limits: { maxProjects: 2 } });
      expect(dirs(capped.projects)).toEqual(["A", "B"]);
      expect(capped.truncated).toBe(true);

      const exact = await findProjects(root, { limits: { maxProjects: 3 } });
      expect(dirs(exact.projects)).toEqual(["A", "B", "C"]);
      expect(exact.truncated).toBe(false);
      expect(SCAN_LIMITS.maxProjects).toBe(MAX_IMPORT_PROJECTS);
    });

    it("stops when time runs out, keeping what it found", async () => {
      project(path.join(root, "A"));
      project(path.join(root, "B", "Deep"));
      let clock = 0;
      // Each folder read takes a second; three seconds allow the root and level one.
      const result = await findProjects(root, { limits: { timeoutMs: 3_000 }, now: () => (clock += 1_000) });

      expect(dirs(result.projects)).toEqual(["A"]);
      expect(result.truncated).toBe(true);
      expect(SCAN_LIMITS.timeoutMs).toBe(15_000);
    });

    it("answers on time when a folder never does (a network drive gone away)", async () => {
      project(path.join(root, "A"));
      project(path.join(root, "Stuck", "Inside"));
      const stuck = path.join(root, "Stuck");
      const readdir = fs.promises.readdir;
      const hang = vi
        .spyOn(fs.promises, "readdir")
        .mockImplementation(((dir: fs.PathLike, options?: unknown) =>
          String(dir) === stuck ? new Promise(() => {}) : Reflect.apply(readdir, fs.promises, [dir, options])) as typeof readdir);
      try {
        const started = Date.now();
        const result = await findProjects(root, { limits: { timeoutMs: 200 } });

        expect(Date.now() - started).toBeLessThan(2_000);
        expect(dirs(result.projects)).toEqual(["A"]);
        expect(result).toMatchObject({ truncated: true, unreadable: 0 });
        expect(hang).toHaveBeenCalledWith(stuck, { withFileTypes: true });
      } finally {
        hang.mockRestore();
      }
    });
  });
});

describe("resolveScanRoot", () => {
  it("resolves an absolute folder", async () => {
    await expect(resolveScanRoot(`${root}${path.sep}.${path.sep}`)).resolves.toBe(root);
  });

  it("refuses what isn't an absolute folder path", async () => {
    for (const value of [undefined, 42, "", "relative/folder", `${root}${path.sep}..${path.sep}x`, "a\0b"]) {
      const error = await resolveScanRoot(value).catch((e: unknown) => e);
      expect(error, String(value)).toBeInstanceOf(LibraryError);
      expect(error).toMatchObject({ status: 400, code: "bad_request" });
    }
    await expect(resolveScanRoot("relative")).rejects.toThrow("The folder to search must be an absolute path");
    await expect(resolveScanRoot(`${root}/../x`)).rejects.toThrow("The folder to search must not contain '..'");
  });

  it("answers 404 for a folder that doesn't exist and 400 for a file", async () => {
    await expect(resolveScanRoot(path.join(root, "missing"))).rejects.toMatchObject({ status: 404, code: "not_found" });
    const file = path.join(root, "file.txt");
    fs.writeFileSync(file, "x");
    await expect(resolveScanRoot(file)).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });
});

describe("scanProjects", () => {
  let home: string;
  let library: string;

  beforeEach(async () => {
    home = path.join(base, "home");
    library = path.join(home, "Pictures", "Node Banana");
    fs.mkdirSync(library, { recursive: true });
    await __resetAssetLibraryForTests({
      pathContext: {
        platform: process.platform,
        env: { NODE_BANANA_ASSET_LIBRARY: library },
        homedir: home,
        winPicturesDir: path.join(home, "Pictures"),
      },
    });
  });

  afterEach(async () => {
    await __resetAssetLibraryForTests();
  });

  it("leaves out the library's own Generations, data folder and thumbnail cache", async () => {
    const status = await getLibraryStatus();
    expect(status.root).toBe(library);
    // The library's day folders, and anything shaped like a project under them.
    fs.mkdirSync(path.join(library, "Generations", "2026-09-27"), { recursive: true });
    fs.writeFileSync(path.join(library, "Generations", "loose.png"), makePng());
    fs.writeFileSync(path.join(library, "generations.png"), makePng());
    project(path.join(library, "Generations", "Tucked away"));
    project(path.join(library, ".nodebanana", "media"));
    project(path.join(status.cacheDir, "thumbs"));
    project(status.cacheDir);
    // A project saved inside the library folder is still a project.
    project(path.join(library, "Saved here"));

    for (const searched of [home, library]) {
      const result = await scanProjects({ root: searched });
      expect(result.projects.map((found) => found.dir), searched).toEqual([path.join(library, "Saved here")]);
    }
    await expect(scanProjects({ root: path.join(library, "Generations") })).resolves.toMatchObject({ projects: [] });
  });

  it("answers with the resolved folder and what it found", async () => {
    project(path.join(root, "One"), ["a.png", "b.png"], { "flow.json": workflowFile("First") });
    await expect(scanProjects({ root: `${root}${path.sep}` })).resolves.toEqual({
      root,
      projects: [{ dir: path.join(root, "One"), name: "First", mediaCount: 2 }],
      truncated: false,
      unreadable: 0,
    });
  });

  it("refuses a bad request or folder before searching", async () => {
    await expect(scanProjects(null as never)).rejects.toMatchObject({ status: 400 });
    await expect(scanProjects({ root: "relative" })).rejects.toMatchObject({ status: 400 });
    await expect(scanProjects({ root: path.join(root, "nope") })).rejects.toMatchObject({ status: 404 });
  });
});
