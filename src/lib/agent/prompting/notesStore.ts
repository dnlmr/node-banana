/**
 * Prompting notes the user had the agent look up for one model, kept on this
 * computer so every later chat and project can use them. Server-only.
 *
 * One JSON file per model: `<dir>/<provider>/<encoded model id>.json`, where
 * dir is `~/.node-banana/prompt-notes` (`NODE_BANANA_PROMPT_NOTES_DIR` moves
 * it; tests must set it or pass their own store).
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PROMPT_NOTES_MAX_CHARS = 4_000;
export const PROMPT_NOTES_MAX_SOURCES = 10;

export interface PromptNotesEntry {
  provider: string;
  modelId: string;
  /** The name the model's listing shows, for display. */
  modelName?: string;
  /** Short prompting advice in the agent's words. */
  notes: string;
  /** Pages the advice came from (http or https). */
  sources: string[];
  /** ISO time it was saved. */
  savedAt: string;
}

export interface PromptNotesStore {
  read(provider: string, modelId: string): Promise<PromptNotesEntry | null>;
  write(entry: PromptNotesEntry): Promise<void>;
  remove(provider: string, modelId: string): Promise<boolean>;
}

export function defaultPromptNotesDir(): string {
  return process.env.NODE_BANANA_PROMPT_NOTES_DIR?.trim() || path.join(os.homedir(), ".node-banana", "prompt-notes");
}

/** A provider name or model id as one safe path segment. */
function segment(value: string): string {
  const encoded = encodeURIComponent(value.trim().toLowerCase());
  if (!encoded || encoded === "." || encoded === "..") throw new Error(`Invalid name: ${JSON.stringify(value)}`);
  return encoded;
}

/** Keeps only what the store promises: bounded notes, http(s) sources. */
export function cleanPromptNotes(entry: PromptNotesEntry): PromptNotesEntry {
  const sources = [...new Set(entry.sources.map((s) => s.trim()).filter((s) => /^https?:\/\/\S+$/i.test(s)))].slice(0, PROMPT_NOTES_MAX_SOURCES);
  return {
    provider: entry.provider.trim(),
    modelId: entry.modelId.trim(),
    ...(entry.modelName?.trim() ? { modelName: entry.modelName.trim().slice(0, 120) } : {}),
    notes: entry.notes.trim().slice(0, PROMPT_NOTES_MAX_CHARS),
    sources,
    savedAt: entry.savedAt,
  };
}

function isEntry(value: unknown): value is PromptNotesEntry {
  const v = value as Partial<PromptNotesEntry> | null;
  return (
    !!v &&
    typeof v.provider === "string" &&
    typeof v.modelId === "string" &&
    typeof v.notes === "string" &&
    Array.isArray(v.sources) &&
    v.sources.every((s) => typeof s === "string") &&
    typeof v.savedAt === "string"
  );
}

export function filePromptNotesStore(dir: string = defaultPromptNotesDir()): PromptNotesStore {
  const fileOf = (provider: string, modelId: string) => path.join(dir, segment(provider), `${segment(modelId)}.json`);
  return {
    async read(provider, modelId) {
      try {
        const parsed: unknown = JSON.parse(await readFile(fileOf(provider, modelId), "utf8"));
        return isEntry(parsed) ? cleanPromptNotes(parsed) : null;
      } catch {
        return null;
      }
    },
    async write(entry) {
      const clean = cleanPromptNotes(entry);
      const file = fileOf(clean.provider, clean.modelId);
      await mkdir(path.dirname(file), { recursive: true });
      // Write then rename, so a reader never sees half a file.
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
      await rename(temp, file);
    },
    async remove(provider, modelId) {
      try {
        await rm(fileOf(provider, modelId));
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** For tests and callers that keep notes elsewhere. */
export function memoryPromptNotesStore(initial: PromptNotesEntry[] = []): PromptNotesStore {
  const key = (provider: string, modelId: string) => `${provider.trim().toLowerCase()}\0${modelId.trim().toLowerCase()}`;
  const entries = new Map(initial.map((e) => [key(e.provider, e.modelId), cleanPromptNotes(e)]));
  return {
    async read(provider, modelId) {
      return entries.get(key(provider, modelId)) ?? null;
    },
    async write(entry) {
      const clean = cleanPromptNotes(entry);
      entries.set(key(clean.provider, clean.modelId), clean);
    },
    async remove(provider, modelId) {
      return entries.delete(key(provider, modelId));
    },
  };
}
