import { afterEach, describe, expect, it } from "vitest";
import { STORAGE_KEY, WORKFLOWS_DIRECTORY_KEY } from "@/store/utils/localStorage";
import { collectProjectReport } from "../projects";

afterEach(() => {
  localStorage.clear();
});

describe("collectProjectReport", () => {
  it("reports each saved workflow's folder and the old workflows folder", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        wf_1: { workflowId: "wf_1", name: "Cats", directoryPath: " /work/Cats ", generationsPath: null, lastSavedAt: 5 },
        wf_2: { workflowId: "wf_2", name: "Blank", directoryPath: "", generationsPath: null, lastSavedAt: null },
        wf_3: { workflowId: "wf_3", directoryPath: "/work/Dogs", generationsPath: null, lastSavedAt: null },
      }),
    );
    localStorage.setItem(WORKFLOWS_DIRECTORY_KEY, "/work");
    expect(collectProjectReport()).toEqual({
      workflowsDir: "/work",
      projects: [
        { dir: "/work/Cats", name: "Cats", lastOpenedAt: 5 },
        { dir: "/work/Dogs", name: null, lastOpenedAt: null },
      ],
    });
  });

  it("reports nothing from empty or corrupt storage", () => {
    expect(collectProjectReport()).toEqual({ workflowsDir: null, projects: [] });
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(collectProjectReport()).toEqual({ workflowsDir: null, projects: [] });
  });
});
