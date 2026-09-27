/**
 * The project registry: `~/.node-banana/projects.json` (under the env
 * override, `<root>/.nodebanana/projects.json`). It lists the project
 * folders the app has been told about, wherever they are — the ones each
 * build's localStorage remembered, the ones brought in — with what the
 * auto-index last saw of their `generations/` folder, and two one-time
 * flags: the "N projects live in other folders" offer was dismissed, and
 * the old workflows folder was adopted as the Node Banana folder.
 *
 * Reads are tolerant (a torn or hand-edited file reads as what it can);
 * writes are atomic and serialised in this process. Folders are absolute,
 * resolved, and unique by {@link pathKey}.
 */

import { promises as fs } from "fs";
import path from "path";
import { atomicWriteFile, KeyedMutex, pathKey, rebasePath } from "./fsutil";
import { MAX_PROJECT_DIR_LENGTH } from "./validate";

export interface RegistryProject {
  dir: string;
  name: string | null;
  addedAt: number;
  lastOpenedAt: number | null;
  /** What the auto-index last indexed of `<dir>/generations`: `mtime:entries`. */
  indexedStamp: string | null;
}

export interface RegistryData {
  v: 1;
  projects: RegistryProject[];
  offer: { dismissed: boolean };
  adoption: { done: boolean };
}

/** Most folders the registry keeps; the oldest-added go first. */
export const MAX_REGISTRY_PROJECTS = 2000;

export function emptyRegistry(): RegistryData {
  return { v: 1, projects: [], offer: { dismissed: false }, adoption: { done: false } };
}

function apiFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/** An absolute, resolved folder, or null for anything else. */
export function registryDir(value: unknown, platform: NodeJS.Platform = process.platform): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_PROJECT_DIR_LENGTH || value.includes("\0")) return null;
  if (value.split(/[\\/]/).some((segment) => segment === "..")) return null;
  const api = apiFor(platform);
  if (!api.isAbsolute(value)) return null;
  const resolved = api.resolve(value);
  // A drive or filesystem root is never a project.
  return api.dirname(resolved) === resolved ? null : resolved;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Whatever of `value` is a registry, the rest defaulted. */
export function parseRegistry(value: unknown, platform: NodeJS.Platform = process.platform): RegistryData {
  const registry = emptyRegistry();
  if (!value || typeof value !== "object") return registry;
  const raw = value as { projects?: unknown; offer?: { dismissed?: unknown }; adoption?: { done?: unknown } };
  registry.offer.dismissed = raw.offer?.dismissed === true;
  registry.adoption.done = raw.adoption?.done === true;
  const seen = new Set<string>();
  for (const entry of Array.isArray(raw.projects) ? raw.projects : []) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const dir = registryDir(item.dir, platform);
    if (!dir) continue;
    const key = pathKey(dir, platform);
    if (seen.has(key)) continue;
    seen.add(key);
    registry.projects.push({
      dir,
      name: typeof item.name === "string" && item.name.trim() ? item.name.slice(0, 512) : null,
      addedAt: finiteOrNull(item.addedAt) ?? 0,
      lastOpenedAt: finiteOrNull(item.lastOpenedAt),
      indexedStamp: typeof item.indexedStamp === "string" && item.indexedStamp ? item.indexedStamp.slice(0, 128) : null,
    });
  }
  return registry;
}

export async function readRegistry(file: string, platform: NodeJS.Platform = process.platform): Promise<RegistryData> {
  try {
    return parseRegistry(JSON.parse(await fs.readFile(file, "utf8")), platform);
  } catch {
    return emptyRegistry();
  }
}

/** A project to add, as the client or a bring-in names it. */
export interface RegistryAddition {
  dir: string;
  name?: string | null;
  lastOpenedAt?: number | null;
}

/**
 * Adds folders (a known one keeps its entry; a newer name or open time
 * updates it). Returns the folders that were not listed before.
 */
export function addProjects(
  registry: RegistryData,
  additions: readonly RegistryAddition[],
  now: number,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const byKey = new Map(registry.projects.map((project) => [pathKey(project.dir, platform), project]));
  const added: string[] = [];
  for (const addition of additions) {
    const dir = registryDir(addition.dir, platform);
    if (!dir) continue;
    const name = typeof addition.name === "string" && addition.name.trim() ? addition.name.trim().slice(0, 512) : null;
    const lastOpenedAt = finiteOrNull(addition.lastOpenedAt);
    const key = pathKey(dir, platform);
    const existing = byKey.get(key);
    if (existing) {
      if (lastOpenedAt !== null && (existing.lastOpenedAt === null || lastOpenedAt > existing.lastOpenedAt)) {
        existing.lastOpenedAt = lastOpenedAt;
        if (name) existing.name = name;
      } else if (name && !existing.name) {
        existing.name = name;
      }
      continue;
    }
    const project: RegistryProject = { dir, name, addedAt: now, lastOpenedAt, indexedStamp: null };
    registry.projects.push(project);
    byKey.set(key, project);
    added.push(dir);
  }
  if (registry.projects.length > MAX_REGISTRY_PROJECTS) {
    registry.projects.sort((a, b) => b.addedAt - a.addedAt);
    registry.projects.length = MAX_REGISTRY_PROJECTS;
  }
  return added;
}

/**
 * Points every entry at or under `fromDir` at the same place under `toDir`
 * (a project that moved takes its nested projects along). An entry already
 * at the destination is merged into.
 */
export function relocateProjects(
  registry: RegistryData,
  fromDir: string,
  toDir: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const moved: RegistryProject[] = [];
  const kept: RegistryProject[] = [];
  for (const project of registry.projects) {
    const dir = rebasePath(fromDir, toDir, project.dir, platform);
    if (dir) {
      moved.push({ ...project, dir });
    } else {
      kept.push(project);
    }
  }
  const byKey = new Map(kept.map((project) => [pathKey(project.dir, platform), project]));
  for (const project of moved) {
    const existing = byKey.get(pathKey(project.dir, platform));
    if (existing) {
      existing.name ??= project.name;
      existing.lastOpenedAt = Math.max(existing.lastOpenedAt ?? 0, project.lastOpenedAt ?? 0) || null;
      existing.indexedStamp = project.indexedStamp;
      continue;
    }
    kept.push(project);
    byKey.set(pathKey(project.dir, platform), project);
  }
  registry.projects = kept;
}

/** Records the stamps the auto-index indexed, adding folders it found that the registry did not list. */
export function setIndexedStamps(
  registry: RegistryData,
  stamps: readonly { dir: string; name?: string | null; stamp: string }[],
  now: number,
  platform: NodeJS.Platform = process.platform,
): void {
  addProjects(registry, stamps.map(({ dir, name }) => ({ dir, name })), now, platform);
  const byKey = new Map(registry.projects.map((project) => [pathKey(project.dir, platform), project]));
  for (const { dir, stamp } of stamps) {
    const project = byKey.get(pathKey(dir, platform));
    if (project) project.indexedStamp = stamp;
  }
}

/**
 * One registry file. `update` reads the file afresh (the other build may
 * have written it), applies the change and writes it back only when
 * something changed.
 */
export class ProjectRegistry {
  private readonly writes = new KeyedMutex();

  constructor(
    readonly file: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly now: () => number = Date.now,
  ) {}

  read(): Promise<RegistryData> {
    return readRegistry(this.file, this.platform);
  }

  async update<T>(change: (registry: RegistryData, now: number) => T): Promise<{ registry: RegistryData; result: T }> {
    return this.writes.run("registry", async () => {
      const registry = await this.read();
      const before = JSON.stringify(registry);
      const result = change(registry, this.now());
      const after = JSON.stringify(registry);
      if (after !== before) {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await atomicWriteFile(this.file, `${JSON.stringify(registry, null, 2)}\n`, { fsync: false });
      }
      return { registry, result };
    });
  }

  add(additions: readonly RegistryAddition[]): Promise<string[]> {
    return this.update((registry, now) => addProjects(registry, additions, now, this.platform)).then(({ result }) => result);
  }

  async relocate(fromDir: string, toDir: string): Promise<void> {
    await this.update((registry) => relocateProjects(registry, fromDir, toDir, this.platform));
  }

  async setIndexed(stamps: readonly { dir: string; name?: string | null; stamp: string }[]): Promise<void> {
    await this.update((registry, now) => setIndexedStamps(registry, stamps, now, this.platform));
  }

  async dismissOffer(): Promise<void> {
    await this.update((registry) => {
      registry.offer.dismissed = true;
    });
  }

  async markAdopted(): Promise<void> {
    await this.update((registry) => {
      registry.adoption.done = true;
    });
  }
}
