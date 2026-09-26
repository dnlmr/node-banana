/**
 * Native file actions: show a file in Finder/Explorer, open a folder, and
 * send a file to the OS Trash/Recycle Bin.
 *
 * In the desktop app, electron/server.cjs installs `globalThis.__nodeBananaDesktop`
 * and the main process does the work with `shell`. In web mode the server
 * runs the OS tools itself — always through execFile with the path as its own
 * argument, never through a shell, so no path can inject a command.
 */

import { execFile, type ExecFileOptions } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import type { DesktopServerBridge } from "../types";
import { LibraryError } from "./errors";
import { unlinkWithRetry } from "./fsutil";

export type ExecRunner = (
  command: string,
  args: string[],
  options: ExecFileOptions & { windowsVerbatimArguments?: boolean },
) => Promise<void>;

const defaultExec: ExecRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 30_000, windowsHide: true, ...options }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

export interface DesktopDeps {
  platform?: NodeJS.Platform;
  exec?: ExecRunner;
  bridge?: DesktopServerBridge | null;
}

/** The Electron bridge when running inside the desktop app. */
export function desktopBridge(): DesktopServerBridge | null {
  const bridge = (globalThis as typeof globalThis & { __nodeBananaDesktop?: DesktopServerBridge }).__nodeBananaDesktop;
  return bridge && typeof bridge.request === "function" ? bridge : null;
}

function resolveDeps(deps: DesktopDeps) {
  return {
    platform: deps.platform ?? process.platform,
    exec: deps.exec ?? defaultExec,
    bridge: deps.bridge === undefined ? desktopBridge() : deps.bridge,
  };
}

/** Explorer exits non-zero even when it opened the window, so its exit code means nothing. */
async function runExplorer(exec: ExecRunner, args: string[], verbatim: boolean): Promise<void> {
  try {
    await exec("explorer.exe", args, { windowsVerbatimArguments: verbatim });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "number") {
      return;
    }
    throw error;
  }
}

/** Shows a file selected in its folder. */
export async function revealFile(file: string, deps: DesktopDeps = {}): Promise<void> {
  const { platform, exec, bridge } = resolveDeps(deps);
  if (bridge) {
    const result = await bridge.request("reveal", { path: file });
    if (result.ok) return;
    throw new LibraryError(result.error || "Could not show the file", 500, "reveal_failed");
  }
  try {
    if (platform === "darwin") await exec("open", ["-R", file], {});
    else if (platform === "win32") {
      // libuv would quote `/select,"C:\a b\x"` into a form Explorer misparses;
      // verbatim passes the one argument exactly as Explorer expects it.
      await runExplorer(exec, [`/select,"${file}"`], true);
    } else await exec("xdg-open", [path.dirname(file)], {});
  } catch (error) {
    throw new LibraryError(
      `Could not show the file: ${error instanceof Error ? error.message : String(error)}`,
      500,
      "reveal_failed",
    );
  }
}

/** Opens a folder in Finder/Explorer. */
export async function openFolder(dir: string, deps: DesktopDeps = {}): Promise<void> {
  const { platform, exec, bridge } = resolveDeps(deps);
  try {
    if (platform === "darwin") await exec("open", [dir], {});
    else if (platform === "win32") await runExplorer(exec, [dir], false);
    else await exec("xdg-open", [dir], {});
  } catch (error) {
    // The desktop app can still select the folder in its parent.
    if (bridge) {
      const result = await bridge.request("reveal", { path: dir });
      if (result.ok) return;
    }
    throw new LibraryError(
      `Could not open the folder: ${error instanceof Error ? error.message : String(error)}`,
      500,
      "reveal_failed",
    );
  }
}

export type TrashMethod = "bridge" | "os" | "unlink";

const MAC_FINDER_DELETE = [
  "-e",
  "on run argv",
  "-e",
  'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
  "-e",
  "end run",
];

const WINDOWS_RECYCLE =
  "Add-Type -AssemblyName Microsoft.VisualBasic; " +
  "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:NB_TRASH_PATH, 'OnlyErrorDialogs', 'SendToRecycleBin')";

/**
 * Sends a file to the OS Trash/Recycle Bin, so a permanent delete in the app
 * stays recoverable from the system. Falls back to unlinking only when every
 * trash route fails (no Finder, no gio).
 */
export async function trashFile(file: string, deps: DesktopDeps = {}): Promise<TrashMethod> {
  const { platform, exec, bridge } = resolveDeps(deps);
  if (bridge) {
    try {
      const result = await bridge.request("trash", { path: file });
      if (result.ok) return "bridge";
    } catch {
      // Fall through to the OS tools.
    }
  }
  const attempts: (() => Promise<void>)[] = [];
  if (platform === "darwin") {
    // macOS 15+ ships /usr/bin/trash; Finder via AppleScript covers older systems.
    attempts.push(() => exec("/usr/bin/trash", [file], {}));
    attempts.push(() => exec("osascript", [...MAC_FINDER_DELETE, file], {}));
  } else if (platform === "win32") {
    attempts.push(() =>
      exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_RECYCLE], {
        env: { ...process.env, NB_TRASH_PATH: file },
      }),
    );
  } else {
    attempts.push(() => exec("gio", ["trash", file], {}));
  }
  for (const attempt of attempts) {
    try {
      await attempt();
      // A tool can exit 0 without moving anything (a declined Automation prompt).
      if (!(await exists(file))) return "os";
    } catch {
      // Try the next route.
    }
  }
  await unlinkWithRetry(file);
  return "unlink";
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
