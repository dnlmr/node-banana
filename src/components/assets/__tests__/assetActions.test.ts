import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchAssetBlob: vi.fn(async () => new Blob(["x"], { type: "image/png" })),
  assetFileUrl: (id: string, download = false) => `/api/assets/${id}/file${download ? "?download=1" : ""}`,
}));
vi.mock("@/lib/assets/client/api", () => api);
vi.mock("@/lib/assets/client/openWorkflow", () => ({ openAssetWorkflow: vi.fn(), openWorkflowBlockedReason: vi.fn() }));

import { downloadZip, zipFileName } from "../assetActions";

describe("bulk download", () => {
  const downloads: string[] = [];
  let click: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    downloads.length = 0;
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:zip") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });
  afterEach(() => {
    click.mockRestore();
    vi.useRealTimers();
  });

  it("names the zip by the local date, just after midnight and just before it", () => {
    expect(zipFileName(new Date(2026, 8, 27, 0, 30))).toBe("Node Banana assets 2026-09-27.zip");
    expect(zipFileName(new Date(2026, 8, 27, 23, 30))).toBe("Node Banana assets 2026-09-27.zip");
    expect(zipFileName(new Date(2026, 0, 5, 12, 0))).toBe("Node Banana assets 2026-01-05.zip");
  });

  it("downloads the zip under that name", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const hour of [0, 23]) {
      vi.setSystemTime(new Date(2026, 8, 27, hour, 30));
      await downloadZip([
        { id: "a1", filename: "a.png", bytes: 10 },
        { id: "a2", filename: "a.png", bytes: 10 },
      ]);
    }
    expect(downloads).toEqual(["Node Banana assets 2026-09-27.zip", "Node Banana assets 2026-09-27.zip"]);
  });
});
