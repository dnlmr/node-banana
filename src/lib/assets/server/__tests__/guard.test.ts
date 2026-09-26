// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AGENT_ALLOWED_HOSTS_ENV, AGENT_LOCAL_HEADER, AGENT_LOCAL_SECRET_ENV } from "@/lib/agent/server/sameOrigin";
import { logger } from "@/utils/logger";
import {
  LIBRARY_ALLOWED_HOSTS_ENV,
  LIBRARY_GUARD_MESSAGE,
  LIBRARY_UNVOUCHED_MESSAGE,
  checkAssetRequest,
  guardAssetRequest,
} from "../guard";

/** What server.js stamps on a request that came over a loopback connection. */
const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
const STAMP = { [AGENT_LOCAL_HEADER]: SECRET };

function request(
  headers: Record<string, string>,
  { url = "http://localhost:3000/api/assets/bulk", method = "POST" }: { url?: string; method?: string } = {},
): Request {
  return new Request(url, { method, headers });
}

/** The page's own fetch() POST, over a stamped loopback connection. */
const pagePost = (host = "localhost:3000", extra: Record<string, string> = {}) =>
  request({ host, origin: `http://${host}`, "sec-fetch-site": "same-origin", ...STAMP, ...extra });

/** An `<img src="/api/assets/thumb/…">` load: same-origin fetch metadata, no Origin. */
const imageGet = (host = "localhost:3000", extra: Record<string, string> = {}) =>
  request(
    { host, "sec-fetch-site": "same-origin", "sec-fetch-dest": "image", ...STAMP, ...extra },
    { url: `http://${host}/api/assets/thumb/${"a".repeat(64)}?w=320`, method: "GET" },
  );

async function body(response: Response | null): Promise<{ error: string; code: string }> {
  expect(response).not.toBeNull();
  return (await response!.json()) as { error: string; code: string };
}

beforeEach(() => {
  process.env[AGENT_LOCAL_SECRET_ENV] = SECRET;
});

afterEach(() => {
  delete process.env[AGENT_LOCAL_SECRET_ENV];
  delete process.env[LIBRARY_ALLOWED_HOSTS_ENV];
  delete process.env[AGENT_ALLOWED_HOSTS_ENV];
  vi.clearAllMocks();
});

describe("guardAssetRequest: lets through", () => {
  it("a fetch from Node Banana's own page", () => {
    expect(guardAssetRequest(pagePost())).toBeNull();
  });

  it("an <img>/<video> subresource load (Sec-Fetch-Site: same-origin, no Origin)", () => {
    expect(guardAssetRequest(imageGet())).toBeNull();
  });

  it("the desktop app's origin (127.0.0.1:47831, every request stamped)", () => {
    expect(guardAssetRequest(pagePost("127.0.0.1:47831"))).toBeNull();
    expect(guardAssetRequest(imageGet("127.0.0.1:47831"))).toBeNull();
  });

  it("a GET from a browser without fetch metadata that sends a same-host Referer", () => {
    const req = request(
      { host: "localhost:3000", referer: "http://localhost:3000/", ...STAMP },
      { method: "GET", url: "http://localhost:3000/api/assets" },
    );
    expect(guardAssetRequest(req)).toBeNull();
  });

  it("a LAN name listed in NB_LIBRARY_ALLOWED_HOSTS, without a stamp", () => {
    process.env[LIBRARY_ALLOWED_HOSTS_ENV] = " Studio.lan , other.lan";
    const req = request(
      { host: "studio.lan:3000", origin: "http://studio.lan:3000" },
      { url: "http://studio.lan:3000/api/assets/bulk" },
    );
    expect(guardAssetRequest(req)).toBeNull();
  });
});

describe("guardAssetRequest: refuses with a 403", () => {
  it("another website's request (Sec-Fetch-Site: cross-site)", async () => {
    const response = guardAssetRequest(pagePost("localhost:3000", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }));
    expect(response?.status).toBe(403);
    expect(await body(response)).toEqual({ error: LIBRARY_GUARD_MESSAGE, code: "forbidden" });
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });

  it("another port on localhost (same-site is another app)", () => {
    expect(guardAssetRequest(pagePost("localhost:3000", { "sec-fetch-site": "same-site" }))?.status).toBe(403);
  });

  it("an Origin that does not match the Host", () => {
    expect(guardAssetRequest(pagePost("localhost:3000", { origin: "http://localhost:4000" }))?.status).toBe(403);
  });

  it("a request that only claims Host: localhost (no loopback stamp)", () => {
    const req = request({ host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" });
    expect(guardAssetRequest(req)?.status).toBe(403);
  });

  it("a stamp with the wrong secret", () => {
    const req = pagePost("localhost:3000", { [AGENT_LOCAL_HEADER]: "f".repeat(SECRET.length) });
    expect(guardAssetRequest(req)?.status).toBe(403);
  });

  it("a DNS-rebinding page (a non-loopback name whose Origin matches its Host)", () => {
    const req = request(
      { host: "evil.example:3000", origin: "http://evil.example:3000", "sec-fetch-site": "same-origin", ...STAMP },
      { url: "http://evil.example:3000/api/assets/bulk" },
    );
    expect(guardAssetRequest(req)?.status).toBe(403);
  });

  it("a LAN name that is only in the agent's allowlist", () => {
    process.env[AGENT_ALLOWED_HOSTS_ENV] = "studio.lan";
    const req = request(
      { host: "studio.lan:3000", origin: "http://studio.lan:3000" },
      { url: "http://studio.lan:3000/api/assets/bulk" },
    );
    expect(guardAssetRequest(req)?.status).toBe(403);
  });

  it("a stamped POST that shows no sign of coming from a page (a server-side fetch)", () => {
    const req = request({ host: "localhost:3000", ...STAMP });
    expect(guardAssetRequest(req)?.status).toBe(403);
  });

  it("with the generic message, never the agent's wording, and logs the specific reason", async () => {
    const refusals = [
      pagePost("localhost:3000", { "sec-fetch-site": "cross-site" }),
      pagePost("localhost:3000", { origin: "http://localhost:4000" }),
      request({ host: "192.168.1.20:3000", origin: "http://192.168.1.20:3000" }, { url: "http://192.168.1.20:3000/api/assets" }),
    ];
    for (const req of refusals) {
      const { error } = await body(guardAssetRequest(req));
      expect(error).toBe(LIBRARY_GUARD_MESSAGE);
      expect(error).not.toMatch(/agent/i);
    }
    expect(logger.warn).toHaveBeenCalledTimes(refusals.length);
    expect(vi.mocked(logger.warn).mock.calls[0][2]).toMatchObject({ path: "/api/assets/bulk", reason: expect.any(String) });
  });
});

describe("checkAssetRequest on a server that does not vouch (plain next dev / next start)", () => {
  it("explains how to start Node Banana instead", () => {
    delete process.env[AGENT_LOCAL_SECRET_ENV];
    expect(checkAssetRequest(pagePost())).toEqual({ ok: false, reason: LIBRARY_UNVOUCHED_MESSAGE });
  });

  it("treats a too-short secret as none", () => {
    process.env[AGENT_LOCAL_SECRET_ENV] = "short";
    expect(checkAssetRequest(pagePost("localhost:3000", { [AGENT_LOCAL_HEADER]: "short" }))).toEqual({
      ok: false,
      reason: LIBRARY_UNVOUCHED_MESSAGE,
    });
  });

  it("still serves a listed host, and gives the generic reason for its other refusals", () => {
    delete process.env[AGENT_LOCAL_SECRET_ENV];
    process.env[LIBRARY_ALLOWED_HOSTS_ENV] = "studio.lan";
    const ok = request({ host: "studio.lan:3000", origin: "http://studio.lan:3000" }, { url: "http://studio.lan:3000/api/assets" });
    expect(checkAssetRequest(ok)).toEqual({ ok: true });
    const crossSite = request(
      { host: "studio.lan:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      { url: "http://studio.lan:3000/api/assets" },
    );
    expect(checkAssetRequest(crossSite)).toEqual({ ok: false, reason: LIBRARY_GUARD_MESSAGE });
  });
});
