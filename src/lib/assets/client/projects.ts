/**
 * What this browser's localStorage knows about projects, for the report a
 * page load sends the server once (`reportProjects`): the project folders
 * of `node-banana-workflow-configs` and the old default workflows folder.
 * The two builds keep separate localStorage, so each reports its own.
 */

import { getWorkflowsDirectory, loadSaveConfigs } from "@/store/utils/localStorage";
import type { ReportProjectsRequest } from "../types";

/** Never throws: unreadable storage reports nothing. */
export function collectProjectReport(): ReportProjectsRequest {
  const projects: ReportProjectsRequest["projects"] = [];
  try {
    for (const config of Object.values(loadSaveConfigs() ?? {})) {
      if (!config || typeof config.directoryPath !== "string" || !config.directoryPath.trim()) continue;
      projects.push({
        dir: config.directoryPath.trim(),
        name: typeof config.name === "string" ? config.name : null,
        lastOpenedAt: typeof config.lastSavedAt === "number" ? config.lastSavedAt : null,
      });
    }
  } catch {
    // Corrupt configs: nothing to report from them.
  }
  let workflowsDir: string | null = null;
  try {
    workflowsDir = getWorkflowsDirectory()?.trim() || null;
  } catch {
    workflowsDir = null;
  }
  return { workflowsDir, projects };
}
