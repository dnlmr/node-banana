/**
 * Where the library lives.
 *
 * Resolution order:
 *   1. `NODE_BANANA_ASSET_LIBRARY` (source `env`) — tests and Electron test
 *      profiles; config and cache then live under the override too, so an
 *      isolated run never touches `~/.node-banana` or the OS cache folder.
 *   2. `~/.node-banana/library.json` (source `config`, or `default`/`fallback`
 *      when that is how the saved root was chosen) — shared by the desktop
 *      app and the browser build, whose localStorage origins differ.
 *   3. `NODE_BANANA_DEFAULT_LIBRARY` (set by Electron main) or the platform
 *      default (source `default`), persisted on first successful use.
 *
 * Every function takes a {@link PathContext} so tests can simulate another
 * platform without touching the real home folder.
 */

import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { LibraryRootSource, LibraryStatus } from "../types";
import { errnoCode } from "./errors";
import { atomicWriteFile, isInsideRoot } from "./fsutil";

export const LIBRARY_FOLDER_NAME = "Node Banana";
export const DATA_DIR_NAME = ".nodebanana";

/** Environment variables as a plain map (`process.env` fits; tests pass their own). */
export type EnvMap = Readonly<Record<string, string | undefined>>;

export interface PathContext {
  platform: NodeJS.Platform;
  env: EnvMap;
  homedir: string;
  /**
   * Windows only: the expanded "Personal" shell folder. Undefined queries
   * the registry (cached per process); null means "unknown, use the fallback".
   */
  winDocumentsDir?: string | null;
}

export function currentPathContext(): PathContext {
  return { platform: process.platform, env: process.env, homedir: os.homedir() };
}

export function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/** Env lookup that ignores case on Windows, where injected env objects may not. */
export function envVar(ctx: PathContext, name: string): string | undefined {
  const direct = ctx.env[name];
  if (direct !== undefined || ctx.platform !== "win32") return direct || undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(ctx.env)) {
    if (key.toLowerCase() === lower) return value || undefined;
  }
  return undefined;
}

/** Hosted deployments (Vercel) have a read-only filesystem and no local user. */
export function isHostedServer(env: EnvMap = process.env): boolean {
  return Boolean(env.VERCEL);
}

/* ------------------------------------------------------------------ */
/* Platform defaults                                                   */
/* ------------------------------------------------------------------ */

function userProfile(ctx: PathContext): string {
  return envVar(ctx, "USERPROFILE") || ctx.homedir;
}

/** Expands `%VAR%` references the way the registry's REG_EXPAND_SZ values expect. */
export function expandWindowsEnv(value: string, ctx: PathContext): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => envVar({ ...ctx, platform: "win32" }, name) ?? whole);
}

/** Parses `reg query … /v "Personal"` output. */
export function parseRegistryDocuments(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*Personal\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/.exec(line);
    if (match) return match[1];
  }
  return null;
}

const REGISTRY_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

/** Runs a console tool and resolves with its stdout (rejects when it fails). */
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 5000, encoding: "utf8" }, (error, stdout) =>
      error ? reject(error) : resolve(String(stdout)),
    );
  });

/** Asks for UTF-8 output: PowerShell otherwise writes the console code page, like reg.exe does. */
const DOCUMENTS_SCRIPT =
  "[Console]::OutputEncoding = [Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')";

/** The first line of a tool's answer, or null when it is empty or was mangled in decoding (U+FFFD). */
function folderFromOutput(output: string | null | undefined): string | null {
  const line = output
    ?.replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean);
  return line && !line.includes("�") ? line : null;
}

/**
 * The Documents folder as Windows resolves it, from PowerShell with UTF-8
 * output. `reg query` is only the fallback when PowerShell can't run: it
 * writes the OEM code page, so a non-ASCII path from it is mangled — and
 * then dropped, rather than persisted as the library root.
 */
export async function queryWindowsDocuments(run: CommandRunner = runCommand): Promise<string | null> {
  try {
    const folder = folderFromOutput(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", DOCUMENTS_SCRIPT]));
    if (folder) return folder;
  } catch {
    // No PowerShell (or it failed): try the registry.
  }
  try {
    return folderFromOutput(parseRegistryDocuments(await run("reg", ["query", REGISTRY_KEY, "/v", "Personal"])));
  } catch {
    return null;
  }
}

let windowsDocuments: Promise<string | null> | null = null;

function cachedWindowsDocuments(): Promise<string | null> {
  windowsDocuments ??= queryWindowsDocuments();
  return windowsDocuments;
}

/** Parses `XDG_DOCUMENTS_DIR` from a user-dirs.dirs file, as `xdg-user-dir PICTURES` does. */
export function parseXdgDocuments(contents: string, homedir: string): string | null {
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*XDG_DOCUMENTS_DIR\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (!match) continue;
    const value = match[1].replace(/^\$HOME|^\$\{HOME\}/, homedir);
    const resolved = path.posix.isAbsolute(value) ? value : path.posix.join(homedir, value);
    // xdg-user-dirs disables a folder by pointing it at $HOME itself.
    if (path.posix.resolve(resolved) === path.posix.resolve(homedir)) return null;
    return path.posix.resolve(resolved);
  }
  return null;
}

async function linuxDocumentsDir(ctx: PathContext): Promise<string> {
  const configHome = envVar(ctx, "XDG_CONFIG_HOME") || path.posix.join(ctx.homedir, ".config");
  try {
    const contents = await fs.readFile(path.posix.join(configHome, "user-dirs.dirs"), "utf8");
    const dir = parseXdgDocuments(contents, ctx.homedir);
    if (dir) return dir;
  } catch {
    // No user-dirs file: the XDG default applies.
  }
  return path.posix.join(ctx.homedir, "Documents");
}

/** The user's Documents folder on this platform. */
export async function platformDocumentsDir(ctx: PathContext): Promise<string> {
  const api = pathApi(ctx.platform);
  if (ctx.platform === "win32") {
    const raw = ctx.winDocumentsDir !== undefined ? ctx.winDocumentsDir : await cachedWindowsDocuments();
    const expanded = raw ? expandWindowsEnv(raw, ctx) : null;
    if (expanded && api.isAbsolute(expanded) && !expanded.includes("%") && !expanded.includes("�")) {
      return api.resolve(expanded);
    }
    return api.join(userProfile(ctx), "Documents");
  }
  if (ctx.platform === "darwin") return api.join(ctx.homedir, "Documents");
  return linuxDocumentsDir(ctx);
}

/** OneDrive's sync roots, from the environment variables its client sets. */
export function oneDriveRoots(ctx: PathContext): string[] {
  const api = pathApi(ctx.platform);
  return ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
    .map((name) => envVar(ctx, name))
    .filter((value): value is string => Boolean(value) && api.isAbsolute(value!));
}

/** True when `candidate` is `root` or inside it, with the platform's case rules. */
export function isSameOrInside(root: string, candidate: string, platform: NodeJS.Platform): boolean {
  return isInsideRoot(root, candidate, { platform, allowEqual: true });
}

/**
 * The folder this machine uses when nothing was chosen. On Windows a Documents
 * folder redirected into OneDrive (Known Folder Move) is skipped: gigabytes of
 * generations would sync and placeholders would make browsing slow offline.
 */
export async function platformDefaultRoot(ctx: PathContext): Promise<string> {
  const api = pathApi(ctx.platform);
  const provided = envVar(ctx, "NODE_BANANA_DEFAULT_LIBRARY");
  if (provided && api.isAbsolute(provided)) return api.resolve(provided);
  const documents = await platformDocumentsDir(ctx);
  if (ctx.platform === "win32" && oneDriveRoots(ctx).some((root) => isSameOrInside(root, documents, "win32"))) {
    return api.join(userProfile(ctx), LIBRARY_FOLDER_NAME);
  }
  return api.join(documents, LIBRARY_FOLDER_NAME);
}

/** Where a default root that cannot be written falls back to. */
export function fallbackRoot(ctx: PathContext): string {
  return pathApi(ctx.platform).join(ctx.platform === "win32" ? userProfile(ctx) : ctx.homedir, LIBRARY_FOLDER_NAME);
}

/** The rebuildable cache (thumbnails) for a non-overridden library. */
export function platformCacheDir(ctx: PathContext): string {
  const api = pathApi(ctx.platform);
  if (ctx.platform === "darwin") return api.join(ctx.homedir, "Library", "Caches", LIBRARY_FOLDER_NAME);
  if (ctx.platform === "win32") {
    const local = envVar(ctx, "LOCALAPPDATA") || api.join(userProfile(ctx), "AppData", "Local");
    return api.join(local, LIBRARY_FOLDER_NAME, "Cache");
  }
  const cacheHome = envVar(ctx, "XDG_CACHE_HOME");
  return cacheHome && api.isAbsolute(cacheHome)
    ? api.join(cacheHome, "node-banana")
    : api.join(ctx.homedir, ".cache", "node-banana");
}

/** `~/.node-banana/library.json`. */
export function userConfigFile(ctx: PathContext): string {
  return pathApi(ctx.platform).join(ctx.homedir, ".node-banana", "library.json");
}

/** Which cloud-sync client (if any) owns a folder, for the status warning. */
export function detectSynced(root: string, ctx: PathContext): LibraryStatus["synced"] {
  const api = pathApi(ctx.platform);
  if (oneDriveRoots(ctx).some((dir) => isSameOrInside(dir, root, ctx.platform))) return "onedrive";
  if (ctx.platform === "darwin") {
    const cloudStorage = api.join(ctx.homedir, "Library", "CloudStorage");
    if (isSameOrInside(cloudStorage, root, "darwin")) {
      const provider = api.relative(cloudStorage, root).split(api.sep)[0].toLowerCase();
      if (provider.startsWith("onedrive")) return "onedrive";
      if (provider.startsWith("dropbox")) return "dropbox";
      if (provider.startsWith("icloud")) return "icloud";
    }
    if (isSameOrInside(api.join(ctx.homedir, "Library", "Mobile Documents"), root, "darwin")) return "icloud";
  }
  const segments = api.resolve(root).split(/[\\/]/).map((segment) => segment.toLowerCase());
  if (segments.some((segment) => segment === "dropbox" || segment.startsWith("dropbox ("))) return "dropbox";
  return null;
}

/* ------------------------------------------------------------------ */
/* Persisted choice                                                    */
/* ------------------------------------------------------------------ */

/** `~/.node-banana/library.json`. `setBy` records how the root was chosen, so the status can say so. */
export interface StoredLibraryConfig {
  v: 1;
  root: string;
  setBy: "default" | "fallback" | "user";
  fallbackReason?: string;
  updatedAt: number;
}

export async function readLibraryConfig(file: string, ctx: PathContext): Promise<StoredLibraryConfig | null> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<StoredLibraryConfig>;
    const api = pathApi(ctx.platform);
    if (typeof parsed.root !== "string" || !api.isAbsolute(parsed.root)) return null;
    const setBy = parsed.setBy === "default" || parsed.setBy === "fallback" ? parsed.setBy : "user";
    return {
      v: 1,
      root: api.resolve(parsed.root),
      setBy,
      ...(typeof parsed.fallbackReason === "string" ? { fallbackReason: parsed.fallbackReason } : {}),
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function writeLibraryConfig(file: string, config: Omit<StoredLibraryConfig, "v" | "updatedAt">): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const body: StoredLibraryConfig = { v: 1, ...config, updatedAt: Date.now() };
  await atomicWriteFile(file, `${JSON.stringify(body, null, 2)}\n`, { fsync: true });
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

export interface ResolvedLocation {
  root: string;
  source: LibraryRootSource;
  defaultRoot: string;
  fallbackReason?: string;
  cacheDir: string;
  /** Where a choice for this location is persisted (never under ~ when the env override is active). */
  configFile: string;
  /** The root came from library.json. */
  persisted: boolean;
}

export type LocationResult =
  | { ok: true; location: ResolvedLocation }
  | {
      ok: false;
      location: ResolvedLocation | null;
      reason: string;
      /** `unwritable`: the root (and any fallback) failed the write probe. `unavailable`: no usable root at all. */
      code: "unwritable" | "unavailable";
    };

/** Resolves the root without touching the disk beyond reading library.json. */
export async function resolveLibraryLocation(ctx: PathContext): Promise<LocationResult> {
  const api = pathApi(ctx.platform);
  const defaultRoot = await platformDefaultRoot(ctx);
  const override = envVar(ctx, "NODE_BANANA_ASSET_LIBRARY");
  if (override) {
    if (!api.isAbsolute(override)) {
      return {
        ok: false,
        location: null,
        reason: "NODE_BANANA_ASSET_LIBRARY must be an absolute path.",
        code: "unavailable",
      };
    }
    const root = api.resolve(override);
    return {
      ok: true,
      location: {
        root,
        source: "env",
        defaultRoot,
        cacheDir: api.join(root, DATA_DIR_NAME, "cache"),
        configFile: api.join(root, DATA_DIR_NAME, "config.json"),
        persisted: false,
      },
    };
  }
  const configFile = userConfigFile(ctx);
  const cacheDir = platformCacheDir(ctx);
  const stored = await readLibraryConfig(configFile, ctx);
  if (stored) {
    return {
      ok: true,
      location: {
        root: stored.root,
        source: stored.setBy === "user" ? "config" : stored.setBy,
        defaultRoot,
        ...(stored.fallbackReason ? { fallbackReason: stored.fallbackReason } : {}),
        cacheDir,
        configFile,
        persisted: true,
      },
    };
  }
  return {
    ok: true,
    location: { root: defaultRoot, source: "default", defaultRoot, cacheDir, configFile, persisted: false },
  };
}

export interface ProbeFailure {
  code: string;
  message: string;
}

/** Creates the root and its data folder, then writes and removes a probe file. */
export async function probeWritable(root: string): Promise<ProbeFailure | null> {
  try {
    await fs.mkdir(path.join(root, DATA_DIR_NAME), { recursive: true });
    const probe = path.join(root, DATA_DIR_NAME, `.probe-${randomUUID()}`);
    await fs.writeFile(probe, "ok", { flag: "wx" });
    await fs.unlink(probe);
    return null;
  } catch (error) {
    return { code: errnoCode(error) ?? "EUNKNOWN", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Errors a fallback folder can fix (permissions, Controlled Folder Access, a read-only volume, a file in the way). */
const FALLBACK_CODES = new Set(["EPERM", "EACCES", "EROFS", "ENOTDIR", "EEXIST"]);

function describeProbeFailure(root: string, failure: ProbeFailure): string {
  switch (failure.code) {
    case "EPERM":
    case "EACCES":
      return `Node Banana isn't allowed to write to "${root}".`;
    case "EROFS":
      return `"${root}" is on a read-only disk.`;
    case "ENOSPC":
      return `The disk holding "${root}" is full.`;
    case "ENOENT":
      return `"${root}" can't be found. Is the drive connected?`;
    case "ENOTDIR":
    case "EEXIST":
      return `"${root}" is a file, not a folder.`;
    default:
      return `Node Banana can't write to "${root}" (${failure.code}).`;
  }
}

/**
 * Resolves the root, proves it writable, and persists a default so both
 * builds agree from then on. A default that cannot be written falls back to
 * `~/Node Banana`; a folder the user (or the env) chose is reported instead.
 */
export async function initLibraryLocation(ctx: PathContext): Promise<LocationResult> {
  const resolved = await resolveLibraryLocation(ctx);
  if (!resolved.ok) return resolved;
  const location = resolved.location;
  const failure = await probeWritable(location.root);
  if (!failure) {
    if (location.source === "default" && !location.persisted) {
      try {
        await writeLibraryConfig(location.configFile, { root: location.root, setBy: "default" });
        location.persisted = true;
      } catch {
        // Unpersisted still works; the next start tries again.
      }
    }
    return { ok: true, location };
  }

  const reason = describeProbeFailure(location.root, failure);
  const isDefault = location.source === "default" || location.source === "fallback";
  if (!isDefault || !FALLBACK_CODES.has(failure.code)) {
    const hint = location.source === "env"
      ? " It is set by NODE_BANANA_ASSET_LIBRARY."
      : " Choose another folder in Settings → Library.";
    return { ok: false, location, reason: reason + hint, code: "unwritable" };
  }

  const fallback = fallbackRoot(ctx);
  const api = pathApi(ctx.platform);
  if (api.resolve(fallback) === api.resolve(location.root)) {
    return { ok: false, location, reason: `${reason} Choose another folder in Settings → Library.`, code: "unwritable" };
  }
  const fallbackFailure = await probeWritable(fallback);
  if (fallbackFailure) {
    return {
      ok: false,
      location,
      reason: `${reason} ${describeProbeFailure(fallback, fallbackFailure)} Choose another folder in Settings → Library.`,
      code: "unwritable",
    };
  }
  const fallbackReason = `${reason} Generations are saved to "${fallback}" instead.`;
  const next: ResolvedLocation = {
    ...location,
    root: fallback,
    source: "fallback",
    fallbackReason,
  };
  try {
    await writeLibraryConfig(location.configFile, { root: fallback, setBy: "fallback", fallbackReason });
    next.persisted = true;
  } catch {
    next.persisted = false;
  }
  return { ok: true, location: next };
}

/** Test hook: forget the cached Documents answer. */
export function resetPathCachesForTests(): void {
  windowsDocuments = null;
}
