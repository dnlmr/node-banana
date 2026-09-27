// @vitest-environment node
/**
 * Kie takes media as a base64 upload. A data URL its old regex didn't match
 * (no media type, parameters before the base64 flag) was base64-decoded
 * whole, header included, and the model received noise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadMediaToKie } from "../kie";
import { makePng } from "@/lib/assets/server/__tests__/helpers";

const fetchMock = vi.fn();
const png = makePng(3, 2);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, code: 200, data: { downloadUrl: "https://cdn.kie.ai/u/a.png" } })));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function uploaded(): { base64Data: string; fileName: string; uploadPath: string } {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe("uploadMediaToKie", () => {
  it.each([
    ["no media type", `data:;base64,${png.toString("base64")}`],
    ["application/octet-stream", `data:application/octet-stream;base64,${png.toString("base64")}`],
    ["a parameter", `data:image/png;charset=binary;base64,${png.toString("base64")}`],
  ])("uploads the exact bytes of a PNG declared with %s", async (_, media) => {
    await expect(uploadMediaToKie("r1", "key", media)).resolves.toBe("https://cdn.kie.ai/u/a.png");
    const body = uploaded();
    expect(body.base64Data).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(body.fileName).toMatch(/\.png$/);
    expect(body.uploadPath).toBe("images");
  });

  it("refuses a data URL it can't read instead of uploading noise", async () => {
    await expect(uploadMediaToKie("r1", "key", "data:image/png;base64,!!!")).rejects.toThrow(/not a readable data URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
