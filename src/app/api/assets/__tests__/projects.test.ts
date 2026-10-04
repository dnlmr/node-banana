// @vitest-environment node
/** The /api/assets/projects routes: bodies checked at the door, answers passed through. */
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/assets/server", async (importOriginal) =>
  (await import("./support")).mockFacade(await importOriginal()),
);
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as facade from "@/lib/assets/server";
import { LibraryError } from "@/lib/assets/server";
import type { ProjectsOverview } from "@/lib/assets/types";
import { POST as bringIn } from "../projects/bring-in/route";
import { GET as folderName } from "../projects/folder-name/route";
import { POST as offer } from "../projects/offer/route";
import { POST as report } from "../projects/report/route";
import { GET as list } from "../projects/route";
import { jobStatus, page, unvouch, vouch } from "./support";

const ROOT = path.resolve("/tmp-nb-assets", "Node Banana");
const OLD = path.resolve("/tmp-nb-assets", "Old");

beforeEach(vouch);
afterEach(() => {
  unvouch();
  vi.resetAllMocks();
});

describe("GET /api/assets/projects", () => {
  it("answers with the overview", async () => {
    const overview: ProjectsOverview = {
      root: ROOT,
      projects: [{ dir: path.join(ROOT, "A"), name: "A", relativePath: "A", inRoot: true, lastModified: 1, mediaCount: 0 }],
      elsewhere: null,
      offerDismissed: false,
    };
    vi.mocked(facade.listProjects).mockResolvedValue(overview);
    const response = await list(page("/api/assets/projects"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual(overview);
  });

  it("says why when the library is unavailable", async () => {
    vi.mocked(facade.listProjects).mockRejectedValue(new LibraryError("Gone", 503, "unavailable"));
    const response = await list(page("/api/assets/projects"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Gone", code: "unavailable" });
  });
});

describe("POST /api/assets/projects/report", () => {
  it("passes on the folders that pass the checks and drops the rest", async () => {
    vi.mocked(facade.reportProjects).mockResolvedValue({ adopted: false, root: ROOT });
    const response = await report(
      page("/api/assets/projects/report", {
        json: {
          workflowsDir: `${OLD}${path.sep}`,
          projects: [
            { dir: path.join(OLD, "A"), name: "A", lastOpenedAt: 5 },
            { dir: "relative/B" },
            { dir: 42 },
            "junk",
            { dir: path.join(OLD, "C"), lastOpenedAt: "soon" },
          ],
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ adopted: false, root: ROOT });
    expect(facade.reportProjects).toHaveBeenCalledWith({
      workflowsDir: OLD,
      projects: [
        { dir: path.join(OLD, "A"), name: "A", lastOpenedAt: 5 },
        { dir: path.join(OLD, "C"), name: null, lastOpenedAt: null },
      ],
    });
  });

  it("refuses a body that isn't an object", async () => {
    const response = await report(page("/api/assets/projects/report", { json: [1] }));
    expect(response.status).toBe(400);
    expect(facade.reportProjects).not.toHaveBeenCalled();
  });
});

describe("POST /api/assets/projects/bring-in", () => {
  it("answers 202 with the job when a move started", async () => {
    vi.mocked(facade.bringInProjects).mockResolvedValue({ root: ROOT, job: jobStatus({ type: "projects" }) });
    const response = await bringIn(page("/api/assets/projects/bring-in", { json: { dirs: [path.join(OLD, "A")], mode: "move" } }));
    expect(response.status).toBe(202);
    expect(facade.bringInProjects).toHaveBeenCalledWith({ dirs: [path.join(OLD, "A")], mode: "move" });
  });

  it("answers 200 when nothing needs following, and needs a folder to use", async () => {
    vi.mocked(facade.bringInProjects).mockResolvedValue({ root: OLD, job: null });
    const used = await bringIn(page("/api/assets/projects/bring-in", { json: { dirs: [], mode: "use", folder: OLD } }));
    expect(used.status).toBe(200);
    expect(facade.bringInProjects).toHaveBeenCalledWith({ dirs: [], mode: "use", folder: OLD });

    const noFolder = await bringIn(page("/api/assets/projects/bring-in", { json: { dirs: [], mode: "use" } }));
    expect(noFolder.status).toBe(400);
  });

  it("refuses an unknown mode, no folders to move, and a relative folder", async () => {
    for (const json of [
      { dirs: [OLD], mode: "copy" },
      { dirs: [], mode: "move" },
      { dirs: ["relative"], mode: "leave" },
    ]) {
      const response = await bringIn(page("/api/assets/projects/bring-in", { json }));
      expect(response.status, JSON.stringify(json)).toBe(400);
    }
    expect(facade.bringInProjects).not.toHaveBeenCalled();
  });
});

describe("POST /api/assets/projects/offer", () => {
  it("dismisses the offer, and takes nothing else", async () => {
    vi.mocked(facade.setProjectsOffer).mockResolvedValue(undefined);
    const response = await offer(page("/api/assets/projects/offer", { json: { dismissed: true } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(facade.setProjectsOffer).toHaveBeenCalledWith({ dismissed: true });

    const refused = await offer(page("/api/assets/projects/offer", { json: { dismissed: false } }));
    expect(refused.status).toBe(400);
  });
});

describe("GET /api/assets/projects/folder-name", () => {
  it("answers with the folder a project of that name gets", async () => {
    vi.mocked(facade.getProjectFolderName).mockResolvedValue({ folder: "Cats 2", path: path.join(ROOT, "Cats 2"), taken: true });
    const response = await folderName(page(`/api/assets/projects/folder-name?name=${encodeURIComponent("Cats")}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ folder: "Cats 2", path: path.join(ROOT, "Cats 2"), taken: true });
    expect(facade.getProjectFolderName).toHaveBeenCalledWith("Cats");
  });

  it("needs a name", async () => {
    const response = await folderName(page("/api/assets/projects/folder-name"));
    expect(response.status).toBe(400);
    expect(facade.getProjectFolderName).not.toHaveBeenCalled();
  });
});
