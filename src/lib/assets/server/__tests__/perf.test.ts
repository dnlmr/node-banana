// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AssetRecord } from "../../types";
import { compareNewest, compileQuery, computeFacets, recordSearchText, type QueryContext } from "../search";

const WORDS = ["neon", "koi", "forest", "portrait", "city", "night", "studio", "watercolor", "macro", "desert", "ocean", "robot"];
const MODELS = ["nano-banana", "nano-banana-pro", "flux-pro", "gpt-image-1", "veo-3", "kling-2"];

function synthetic(count: number): AssetRecord[] {
  const records: AssetRecord[] = [];
  const start = Date.UTC(2025, 0, 1);
  for (let i = 0; i < count; i++) {
    const kind = (["image", "image", "image", "video", "audio", "3d"] as const)[i % 6];
    records.push({
      v: 1,
      id: `a${(start + i * 60_000).toString(36)}${i.toString(36).padStart(8, "0")}`,
      kind,
      origin: i % 5 === 0 ? "edited" : "generated",
      mime: "image/png",
      ext: "png",
      bytes: 1_500_000 + i,
      sha256: i.toString(16).padStart(64, "0"),
      md5: i.toString(16).padStart(32, "0"),
      file: { root: "library", rel: `Generations/2025-01-01/${i}.png` },
      filename: `${i}.png`,
      width: 1024,
      height: 768,
      createdAt: start + i * 60_000,
      prompt: `${WORDS[i % WORDS.length]} ${WORDS[(i * 7) % WORDS.length]} scene number ${i}, cinematic lighting, highly detailed`,
      model: { provider: "p", modelId: MODELS[i % MODELS.length] },
      producer: { nodeId: `n-${i % 40}`, nodeType: "nanoBanana" },
      workflowId: `wf_${i % 120}`,
      workflowName: `Workflow ${i % 120}`,
      runId: `r${i.toString(36).padStart(13, "0")}`,
      tags: i % 9 === 0 ? ["hero", `batch-${i % 30}`] : [],
      favorite: i % 17 === 0,
      ...(i % 41 === 0 ? { trashedAt: start } : {}),
    });
  }
  return records.sort(compareNewest);
}

describe("in-memory query speed", () => {
  it("filters, searches and facets 20k records well under 50 ms", () => {
    const records = synthetic(20_000);
    const search = new Map<string, string>();
    const ctx: QueryContext = {
      workflowOf: (record) => ({ name: record.workflowName, projectPath: record.workflowId.endsWith("7") ? "/p/seven" : null }),
      isMissing: () => false,
      searchText: (record) => {
        let text = search.get(record.id);
        if (text === undefined) {
          text = recordSearchText(record);
          search.set(record.id, text);
        }
        return text;
      },
      projectKey: (p) => p.toLowerCase(),
    };
    // Warm the search-text cache as a running server would have.
    compileQuery({ q: "warm" }, ctx);
    records.forEach((record) => ctx.searchText(record));

    const time = (fn: () => void) => {
      const started = performance.now();
      fn();
      return performance.now() - started;
    };
    // First run includes JIT warm-up; measure the best of a few.
    const best = (fn: () => void) => Math.min(...Array.from({ length: 5 }, () => time(fn)));

    let matched = 0;
    const queryMs = best(() => {
      const match = compileQuery(
        { q: "cinematic neon", kinds: ["image", "video"], models: ["nano-banana", "flux-pro"], projects: ["", "/p/seven"] },
        ctx,
      );
      matched = records.filter(match).length;
    });
    const facetsMs = best(() => computeFacets(records, ctx));
    expect(matched).toBeGreaterThan(0);
    expect(queryMs).toBeLessThan(50);
    expect(facetsMs).toBeLessThan(50);

    const facets = computeFacets(records, ctx);
    expect(facets.total + facets.trash).toBe(20_000);
    expect(facets.models).toHaveLength(MODELS.length);
  });
});
