// @vitest-environment node
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addProjects, emptyRegistry, parseRegistry, ProjectRegistry, readRegistry, registryDir, relocateProjects } from "../registry";
import { tempDir } from "./helpers";

let base: string;
let file: string;

beforeEach(() => {
  base = tempDir("nb-registry-");
  file = path.join(base, ".node-banana", "projects.json");
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe("registryDir", () => {
  it("keeps absolute folders, resolved, and refuses the rest", () => {
    expect(registryDir("/a/b/", "linux")).toBe("/a/b");
    expect(registryDir("/a/./b", "linux")).toBe("/a/b");
    expect(registryDir("C:\\Work/Project\\", "win32")).toBe("C:\\Work\\Project");
    expect(registryDir("relative/dir", "linux")).toBeNull();
    expect(registryDir("/a/../b", "linux")).toBeNull();
    expect(registryDir("/", "linux")).toBeNull();
    expect(registryDir("C:\\", "win32")).toBeNull();
    expect(registryDir(42, "linux")).toBeNull();
    expect(registryDir("/a\0b", "linux")).toBeNull();
  });
});

describe("parseRegistry", () => {
  it("reads what it can of a hand-edited file and dedupes folders", () => {
    const parsed = parseRegistry(
      {
        v: 1,
        projects: [
          { dir: "/p/One", name: "One", addedAt: 5, lastOpenedAt: 9, indexedStamp: "1:2" },
          { dir: "/p/One/", name: "Twice" },
          { dir: "p/relative" },
          "junk",
          { dir: "/p/Two", name: 3, addedAt: "soon" },
        ],
        offer: { dismissed: true },
        adoption: "yes",
      },
      "linux",
    );
    expect(parsed).toEqual({
      v: 1,
      projects: [
        { dir: "/p/One", name: "One", addedAt: 5, lastOpenedAt: 9, indexedStamp: "1:2" },
        { dir: "/p/Two", name: null, addedAt: 0, lastOpenedAt: null, indexedStamp: null },
      ],
      offer: { dismissed: true },
      adoption: { done: false },
    });
  });

  it("treats folders that differ only in case as one where the disk folds case", () => {
    const projects = [{ dir: "/p/One" }, { dir: "/P/one" }];
    expect(parseRegistry({ projects }, "darwin").projects).toHaveLength(1);
    expect(parseRegistry({ projects }, "linux").projects).toHaveLength(2);
  });

  it("reads a missing or torn file as empty", async () => {
    expect(await readRegistry(file)).toEqual(emptyRegistry());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"projects": [');
    expect(await readRegistry(file)).toEqual(emptyRegistry());
  });
});

describe("addProjects", () => {
  it("adds new folders, and a newer open updates a known one", () => {
    const registry = emptyRegistry();
    expect(addProjects(registry, [{ dir: "/p/A", name: "A", lastOpenedAt: 10 }], 100, "linux")).toEqual(["/p/A"]);
    expect(addProjects(registry, [{ dir: "/p/A/", name: "A renamed", lastOpenedAt: 20 }, { dir: "/p/B" }], 200, "linux")).toEqual([
      "/p/B",
    ]);
    expect(registry.projects).toEqual([
      { dir: "/p/A", name: "A renamed", addedAt: 100, lastOpenedAt: 20, indexedStamp: null },
      { dir: "/p/B", name: null, addedAt: 200, lastOpenedAt: null, indexedStamp: null },
    ]);
    // An older open changes nothing
    addProjects(registry, [{ dir: "/p/A", name: "Old", lastOpenedAt: 5 }], 300, "linux");
    expect(registry.projects[0]).toMatchObject({ name: "A renamed", lastOpenedAt: 20 });
  });
});

describe("relocateProjects", () => {
  it("moves an entry and the ones nested in it, merging into one already there", () => {
    const registry = emptyRegistry();
    addProjects(
      registry,
      [
        { dir: "/old/Proj", name: "Proj", lastOpenedAt: 5 },
        { dir: "/old/Proj/Nested" },
        { dir: "/old/Projector" },
        { dir: "/root/Proj", lastOpenedAt: 1 },
      ],
      1,
      "linux",
    );
    registry.projects[0].indexedStamp = "7:3";
    relocateProjects(registry, "/old/Proj", "/root/Proj", "linux");
    expect(registry.projects.map((project) => project.dir).sort()).toEqual(["/old/Projector", "/root/Proj", "/root/Proj/Nested"]);
    expect(registry.projects.find((project) => project.dir === "/root/Proj")).toMatchObject({
      name: "Proj",
      lastOpenedAt: 5,
      indexedStamp: "7:3",
    });
  });

  it("matches the old folder whatever its case where the disk folds case", () => {
    const registry = emptyRegistry();
    addProjects(registry, [{ dir: "/Old/Proj/Nested" }], 1, "darwin");
    relocateProjects(registry, "/old/proj", "/Root/Proj", "darwin");
    expect(registry.projects[0].dir).toBe("/Root/Proj/Nested");
  });
});

describe("ProjectRegistry", () => {
  it("writes atomically, only when something changed, and reads what the other build wrote", async () => {
    const registry = new ProjectRegistry(file, process.platform, () => 1000);
    expect(await registry.add([{ dir: path.join(base, "One"), name: "One" }])).toEqual([path.join(base, "One")]);
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(written).toMatchObject({ v: 1, projects: [{ dir: path.join(base, "One"), name: "One", addedAt: 1000 }] });

    const mtime = fs.statSync(file).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await registry.add([{ dir: path.join(base, "One") }])).toEqual([]);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);

    // Another process adds a folder; this one's next change keeps it
    written.projects.push({ dir: path.join(base, "Two"), addedAt: 5 });
    fs.writeFileSync(file, JSON.stringify(written));
    await registry.dismissOffer();
    const after = await registry.read();
    expect(after.projects.map((project) => path.basename(project.dir))).toEqual(["One", "Two"]);
    expect(after.offer.dismissed).toBe(true);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["projects.json"]);
  });

  it("serialises concurrent changes", async () => {
    const registry = new ProjectRegistry(file);
    await Promise.all(Array.from({ length: 10 }, (_, i) => registry.add([{ dir: path.join(base, `P${i}`) }])));
    expect((await registry.read()).projects).toHaveLength(10);
  });

  it("records indexed stamps, adding folders the registry did not list", async () => {
    const registry = new ProjectRegistry(file);
    await registry.add([{ dir: path.join(base, "Known") }]);
    await registry.setIndexed([
      { dir: path.join(base, "Known"), stamp: "1:1" },
      { dir: path.join(base, "Found"), name: "Found it", stamp: "2:2" },
    ]);
    const { projects } = await registry.read();
    expect(projects.map((project) => [path.basename(project.dir), project.name, project.indexedStamp])).toEqual([
      ["Known", null, "1:1"],
      ["Found", "Found it", "2:2"],
    ]);
    await registry.markAdopted();
    expect((await registry.read()).adoption.done).toBe(true);
  });
});
