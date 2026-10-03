// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMFY_HEADERS } from "../settings";
import { connectionFromRequest, engineAuthHeaders, orgKeyFromRequest } from "../server/connection";

function request(baseUrl?: string, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/comfy/run", {
    headers: { ...(baseUrl ? { [COMFY_HEADERS.baseUrl]: baseUrl } : {}), ...extra },
  });
}

describe("where the server's Comfy keys may go", () => {
  beforeEach(() => {
    vi.stubEnv("COMFY_MODE", "remote");
    vi.stubEnv("COMFY_REMOTE_URL", "https://trusted.example/comfy");
    vi.stubEnv("COMFY_LOCAL_URL", "");
    vi.stubEnv("COMFY_CLOUD_URL", "");
    vi.stubEnv("COMFY_CLOUD_API_KEY", "cloud-secret");
    vi.stubEnv("COMFY_API_KEY", "engine-secret");
    vi.stubEnv("COMFY_ORG_API_KEY", "partner-secret");
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each([
    "https://attacker.example",
    "https://trusted.example/other-tenant",
    "http://trusted.example/comfy",
    "https://trusted.example:8443/comfy",
    "http://127.0.0.1:8188",
  ])("sends no environment key to a request-chosen %s", (baseUrl) => {
    const req = request(baseUrl);
    const connection = connectionFromRequest(req);
    expect(connection.baseUrl).toBe(baseUrl);
    expect(connection.apiKey).toBeNull();
    expect(engineAuthHeaders(connection)).toEqual({});
    expect(orgKeyFromRequest(req, connection)).toBeNull();
  });

  it("still serves a headless setup from the environment alone", () => {
    const req = request();
    const connection = connectionFromRequest(req);
    expect(connection.baseUrl).toBe("https://trusted.example/comfy");
    expect(connection.apiKey).toBe("engine-secret");
    expect(orgKeyFromRequest(req, connection)).toBe("partner-secret");
  });

  it("uses the environment keys when the request names the configured engine", () => {
    const req = request("https://TRUSTED.example:443/comfy/");
    const connection = connectionFromRequest(req);
    expect(connection.apiKey).toBe("engine-secret");
    expect(orgKeyFromRequest(req, connection)).toBe("partner-secret");
  });

  it("uses the keys the browser sends, for any engine", () => {
    const req = request("http://127.0.0.1:8188", {
      [COMFY_HEADERS.mode]: "local",
      [COMFY_HEADERS.apiKey]: "browser-engine-key",
      [COMFY_HEADERS.orgKey]: "browser-partner-key",
    });
    const connection = connectionFromRequest(req);
    expect(connection.mode).toBe("local");
    expect(connection.apiKey).toBe("browser-engine-key");
    expect(orgKeyFromRequest(req, connection)).toBe("browser-partner-key");
  });

  it("falls back to the browser's engine key for partner nodes on another engine", () => {
    const req = request("https://another.example", { [COMFY_HEADERS.apiKey]: "browser-key" });
    expect(orgKeyFromRequest(req, connectionFromRequest(req))).toBe("browser-key");
  });

  it("with the default cloud mode, sends the Comfy key to Comfy Cloud only", () => {
    vi.stubEnv("COMFY_MODE", undefined);
    const cloud = request("https://cloud.comfy.org");
    expect(connectionFromRequest(cloud).apiKey).toBe("engine-secret");
    const other = request("https://attacker.example");
    expect(connectionFromRequest(other).apiKey).toBeNull();
    expect(orgKeyFromRequest(other, connectionFromRequest(other))).toBeNull();
  });

  it("sends no environment key to a local engine when none is configured", () => {
    vi.stubEnv("COMFY_MODE", "local");
    const req = request("http://127.0.0.1:8188");
    const connection = connectionFromRequest(req);
    expect(connection.apiKey).toBeNull();
    expect(orgKeyFromRequest(req, connection)).toBeNull();
  });
});
