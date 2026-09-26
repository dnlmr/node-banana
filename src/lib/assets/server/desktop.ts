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
import { errnoCode, LibraryError } from "./errors";
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

/**
 * Explorer exits non-zero even when it opened the window, so its exit code
 * means nothing. It must not start hidden: a GUI program passes its
 * startup show state (SW_HIDE under windowsHide) to the window it opens.
 */
async function runExplorer(exec: ExecRunner, args: string[], verbatim: boolean): Promise<void> {
  try {
    await exec("explorer.exe", args, { windowsVerbatimArguments: verbatim, windowsHide: false });
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

/** Every path in argv, deleted by Finder in one Apple Event. */
const MAC_FINDER_DELETE = [
  "-e",
  "on run argv",
  "-e",
  "set targets to {}",
  "-e",
  "repeat with p in argv",
  "-e",
  "set end of targets to ((POSIX file (contents of p)) as alias)",
  "-e",
  "end repeat",
  "-e",
  'tell application "Finder" to delete targets',
  "-e",
  "end run",
];

/** Every newline-separated path in NB_TRASH_PATHS to the Recycle Bin (Windows paths can't hold a newline). */
const WINDOWS_RECYCLE =
  "Add-Type -AssemblyName Microsoft.VisualBasic; " +
  "foreach ($p in ($env:NB_TRASH_PATHS -split \"`n\")) { if ($p) { try { " +
  "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') " +
  "} catch { } } }";

/** Paths per trash process: well under argv limits, and under Windows' 32,767-character variable. */
const TRASH_BATCH_FILES = 200;
const TRASH_BATCH_CHARS = 30_000;

function batches(files: string[]): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const file of files) {
    if (current.length && (current.length >= TRASH_BATCH_FILES || chars + file.length + 1 > TRASH_BATCH_CHARS)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(file);
    chars += file.length + 1;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * The OS routes for a batch, in order of preference. Not `interactive`, the
 * ones that may ask the user something (Finder's Automation prompt) are left
 * out.
 */
function trashRoutes(platform: NodeJS.Platform, exec: ExecRunner, interactive: boolean): ((files: string[]) => Promise<void>)[] {
  if (platform === "darwin") {
    // macOS 15+ ships /usr/bin/trash; Finder via AppleScript covers older systems.
    const routes = [(files: string[]) => exec("/usr/bin/trash", files, {})];
    if (interactive) routes.push((files) => exec("osascript", [...MAC_FINDER_DELETE, ...files], {}));
    return routes;
  }
  if (platform === "win32") {
    return [
      (files) =>
        exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_RECYCLE], {
          env: { ...process.env, NB_TRASH_PATHS: files.join("\n") },
        }),
    ];
  }
  return [(files) => exec("gio", ["trash", ...files], {})];
}

/** Finder can't be asked at all: not allowed to send it Apple Events (-1743), timed out (-1712), not running (-600). */
const APPLE_EVENTS_REFUSED = /\((?:-1743|-1712|-600)\)|not (?:authori[sz]ed|permitted) to send apple events/i;

/**
 * The route failed as a whole, not over one of the files: the tool is
 * missing, it was stopped (the exec timeout — a prompt nobody answered), or
 * macOS refused it the Apple Events it needs. Retrying file by file would
 * only fail the same way, once per file.
 */
function routeUnavailable(error: unknown): boolean {
  if (errnoCode(error) === "ENOENT") return true;
  const failure = (error ?? {}) as { killed?: unknown; signal?: unknown; message?: unknown; stderr?: unknown };
  if (failure.killed === true || (typeof failure.signal === "string" && failure.signal !== "")) return true;
  return APPLE_EVENTS_REFUSED.test(`${String(failure.message ?? "")}\n${String(failure.stderr ?? "")}`);
}

export interface TrashOptions extends DesktopDeps {
  /**
   * False for work nobody asked for just now (the 30-day purge at startup):
   * routes that may put up a prompt are skipped, and what the others can't
   * take is unlinked.
   */
  interactive?: boolean;
}

/**
 * Sends files to the OS Trash/Recycle Bin, so a permanent delete in the app
 * stays recoverable from the system. One tool process takes a whole batch
 * (not one per file). Each file falls back to unlinking only when every
 * trash route failed to move it (no Finder, no gio). Returns how each file
 * went; a file missing from the result could not be removed at all.
 */
export async function trashFiles(files: readonly string[], options: TrashOptions = {}): Promise<Map<string, TrashMethod>> {
  const { platform, exec, bridge } = resolveDeps(options);
  const results = new Map<string, TrashMethod>();
  let pending = [...new Set(files)];
  if (bridge) {
    const left: string[] = [];
    for (const file of pending) {
      try {
        const result = await bridge.request("trash", { path: file });
        if (result.ok) {
          results.set(file, "bridge");
          continue;
        }
      } catch {
        // Fall through to the OS tools.
      }
      left.push(file);
    }
    pending = left;
  }
  for (const route of trashRoutes(platform, exec, options.interactive !== false)) {
    if (!pending.length) break;
    let down = false;
    for (const batch of batches(pending)) {
      if (down) break;
      try {
        await route(batch);
      } catch (error) {
        down = routeUnavailable(error);
        // One bad path can fail a whole batch; retry its files one by one, while the route itself works.
        for (const file of down || batch.length === 1 ? [] : batch) {
          if (!(await exists(file))) continue;
          try {
            await route([file]);
          } catch (single) {
            if ((down = routeUnavailable(single))) break;
          }
        }
      }
    }
    // A tool can exit 0 without moving anything (a declined Automation prompt), or move only some.
    const left: string[] = [];
    for (const file of pending) {
      if (await exists(file)) left.push(file);
      else results.set(file, "os");
    }
    pending = left;
  }
  for (const file of pending) {
    try {
      await unlinkWithRetry(file);
      results.set(file, "unlink");
    } catch (error) {
      console.warn("[assets] could not remove", file, error);
    }
  }
  return results;
}

/** {@link trashFiles} for one file; throws when it could not be removed. */
export async function trashFile(file: string, options: TrashOptions = {}): Promise<TrashMethod> {
  const method = (await trashFiles([file], options)).get(file);
  if (!method) throw new LibraryError(`Could not remove ${path.basename(file)}`, 500, "trash_failed");
  return method;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
