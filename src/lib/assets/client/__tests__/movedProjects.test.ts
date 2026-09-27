import { afterEach, describe, expect, it } from "vitest";
import { useWorkflowStore } from "@/store/workflowStore";
import { STORAGE_KEY } from "@/store/utils/localStorage";
import type { LibraryJobStatus } from "../../types";
import { __resetMovedProjectsForTests, followMovedProjects } from "../movedProjects";

function projectsJob(moved: LibraryJobStatus["moved"]): LibraryJobStatus {
  return { id: "j1", type: "projects", state: "running", done: 1, total: 2, bytesDone: 0, bytesTotal: 0, startedAt: 1, moved };
}

afterEach(() => {
  localStorage.clear();
  __resetMovedProjectsForTests();
  useWorkflowStore.setState({ saveDirectoryPath: null, generationsPath: null, imageRefBasePath: null });
});

describe("followMovedProjects", () => {
  it("points the open canvas, its parked tabs and the saved configs at the moved folder", () => {
    const tabs = useWorkflowStore.getState().tabs;
    const parked = {
      ...useWorkflowStore.getState(),
      saveDirectoryPath: "/old/Dogs",
      generationsPath: "/old/Dogs/generations",
      imageRefBasePath: null,
    };
    useWorkflowStore.setState({
      saveDirectoryPath: "/old/Cats",
      generationsPath: "/old/Cats/generations",
      imageRefBasePath: "/old/Cats",
      tabs: [...tabs, { id: "parked", snapshot: parked }],
    });
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        wf_1: { workflowId: "wf_1", name: "Cats", directoryPath: "/old/Cats", generationsPath: "/old/Cats/generations", lastSavedAt: 5 },
        wf_2: { workflowId: "wf_2", name: "Owls", directoryPath: "/elsewhere/Owls", generationsPath: null, lastSavedAt: 6 },
      }),
    );

    followMovedProjects(projectsJob([{ from: "/old/Cats", to: "/nb/Cats" }, { from: "/old/Dogs", to: "/nb/Dogs 2" }]));

    const state = useWorkflowStore.getState();
    expect(state).toMatchObject({ saveDirectoryPath: "/nb/Cats", generationsPath: "/nb/Cats/generations", imageRefBasePath: "/nb/Cats" });
    expect(state.tabs.find((tab) => tab.id === "parked")?.snapshot).toMatchObject({
      saveDirectoryPath: "/nb/Dogs 2",
      generationsPath: "/nb/Dogs 2/generations",
    });
    const configs = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(configs.wf_1).toMatchObject({ directoryPath: "/nb/Cats", generationsPath: "/nb/Cats/generations" });
    expect(configs.wf_2).toMatchObject({ directoryPath: "/elsewhere/Owls" });
  });

  it("applies each move once, and ignores a job that moved nothing", () => {
    followMovedProjects(projectsJob([{ from: "/old/Cats", to: "/nb/Cats" }]));
    // A project saved at the old path again later is the user's own choice: a repeat report leaves it be
    useWorkflowStore.setState({ saveDirectoryPath: "/old/Cats" });
    followMovedProjects(projectsJob([{ from: "/old/Cats", to: "/nb/Cats" }]));
    followMovedProjects(projectsJob(undefined));
    followMovedProjects(null);
    expect(useWorkflowStore.getState().saveDirectoryPath).toBe("/old/Cats");
  });
});
