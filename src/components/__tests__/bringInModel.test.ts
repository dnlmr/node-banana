import { describe, expect, it } from "vitest";
import { groupFoundProjects, movePercent, moveRowStates } from "@/components/quickstart/bringInModel";
import type { FoundProject, LibraryJobStatus } from "@/lib/assets/types";

const project = (dir: string): FoundProject => ({ dir, name: dir.split("/").pop()!, mediaCount: 0 });

function job(patch: Partial<LibraryJobStatus>): LibraryJobStatus {
  return { id: "j", type: "projects", state: "running", done: 0, total: 0, bytesDone: 0, bytesTotal: 0, startedAt: 0, ...patch };
}

describe("groupFoundProjects", () => {
  it("groups by the folder the projects sit in, folding nested folders into their top group", () => {
    const root = "/Users/ada/Documents/projects";
    const groups = groupFoundProjects(root, [
      project(`${root}/workflows/cars`),
      project(`${root}/workflows/looped`),
      project(`${root}/workflows/nood-prod/Material Application`),
      project(`${root}/workflows/nood-prod/Material Application/swordfish`),
      project(`${root}/test-files/test workflows/test2`),
      project(`${root}/pet-hype`),
    ]);

    expect(groups).toEqual([
      { label: "workflows", count: 4 },
      { label: "pet-hype", count: 1 },
      { label: "test-files › test workflows", count: 1 },
    ]);
  });

  it("reads Windows paths", () => {
    expect(groupFoundProjects("C:\\Users\\ada\\p", [project("C:\\Users\\ada\\p\\a\\one"), project("C:\\Users\\ada\\p\\a\\two")])).toEqual([
      { label: "a", count: 2 },
    ]);
  });
});

describe("moveRowStates", () => {
  const projects = [project("/p/a"), project("/p/a/inner"), project("/p/b"), project("/p/c")];

  it("marks moved folders and what sits in them done, and the next one moving", () => {
    const states = moveRowStates(projects, job({ moved: [{ from: "/p/a", to: "/r/a" }] }));
    expect(states).toEqual(["done", "done", "now", "wait"]);
  });

  it("has nothing moving once the job has stopped", () => {
    expect(moveRowStates(projects, job({ state: "cancelled", moved: [] }))).toEqual(["wait", "wait", "wait", "wait"]);
  });
});

describe("movePercent", () => {
  it("counts bytes when it has them, else files, and never passes 100", () => {
    expect(movePercent(job({ bytesDone: 25, bytesTotal: 100, done: 9, total: 10 }))).toBe(25);
    expect(movePercent(job({ done: 1, total: 4 }))).toBe(25);
    expect(movePercent(job({ bytesDone: 200, bytesTotal: 100 }))).toBe(100);
    expect(movePercent(job({}))).toBe(0);
  });
});
