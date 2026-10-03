// @vitest-environment node
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * server.js is the custom server behind `npm run dev` and `npm start`. These
 * tests run the real file with Next stubbed out, on a real loopback socket,
 * and send it the headers a browser (or an attacker's page) would.
 */
const source = readFileSync(new URL("../../server.js", import.meta.url), "utf8");

let running: http.Server | null = null;

afterEach(async () => {
  const server = running;
  running = null;
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function start(env: Record<string, string> = {}) {
  const handle = vi.fn((_req: http.IncomingMessage, res: http.ServerResponse) => {
    res.writeHead(200).end("next");
  });
  const listen = vi.fn();
  const next = vi.fn(() => ({ prepare: () => Promise.resolve(), getRequestHandler: () => handle }));
  let ready!: () => void;
  const listening = new Promise<void>((resolve) => (ready = resolve));
  runInNewContext(source, {
    process: { env: { ...env }, argv: ["node", "server.js"] },
    URL,
    console: { log: vi.fn() },
    require: (name: string) => {
      if (name === "next") return next;
      if (name === "crypto") return crypto;
      return {
        createServer: (callback: http.RequestListener) => {
          const server = http.createServer(callback);
          running = server;
          // Record where server.js asked to listen, then listen on a free loopback port.
          const original = server.listen.bind(server);
          (server as unknown as { listen: (...args: unknown[]) => void }).listen = (...args: unknown[]) => {
            listen(...args);
            original(0, "127.0.0.1", ready);
          };
          return server;
        },
      };
    },
  });
  await listening;
  const { port } = running!.address() as AddressInfo;
  return { handle, listen, next, port };
}

function send(port: number, path: string, headers: Record<string, string>, method = "POST") {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end(method === "POST" ? '{"prompt":"x"}' : undefined);
  });
}

describe("server.js local boundary", () => {
  it("listens on loopback unless HOST says otherwise", async () => {
    const { listen, next } = await start();
    expect(listen).toHaveBeenCalledWith(3000, "127.0.0.1", expect.any(Function));
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ hostname: "127.0.0.1" }));
  });

  it("listens where HOST and PORT say", async () => {
    const { listen } = await start({ HOST: "0.0.0.0", PORT: "8000" });
    expect(listen).toHaveBeenCalledWith("8000", "0.0.0.0", expect.any(Function));
  });

  it.each(["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "app.localhost:3000"])(
    "serves its own page on %s",
    async (host) => {
      const { port, handle } = await start();
      const res = await send(port, "/", { host }, "GET");
      expect(res.status).toBe(200);
      expect(handle).toHaveBeenCalledOnce();
    },
  );

  it("refuses a DNS-rebinding host before Next sees the request", async () => {
    const { port, handle } = await start();
    const res = await send(port, "/api/generate", { host: "attacker.example:3000", origin: "http://attacker.example:3000" });
    expect(res.status).toBe(403);
    expect(handle).not.toHaveBeenCalled();
  });

  it.each(["127.0.0.1", "127.0.1.1", "localhost", "::1"])("keeps the host check when HOST is the loopback %s", async (host) => {
    const { port, handle } = await start({ HOST: host });
    expect((await send(port, "/", { host: "attacker.example:3000" }, "GET")).status).toBe(403);
    const authority = host.includes(":") ? `[${host}]:3000` : `${host}:3000`;
    expect((await send(port, "/", { host: authority }, "GET")).status).toBe(200);
    expect(handle).toHaveBeenCalledOnce();
  });

  it("answers any host once HOST opens it to the network", async () => {
    const { port, handle } = await start({ HOST: "0.0.0.0" });
    expect((await send(port, "/", { host: "banana.lan:3000" }, "GET")).status).toBe(200);
    expect(handle).toHaveBeenCalledOnce();
  });

  it("refuses a simple cross-site POST to a generation route", async () => {
    const { port, handle } = await start();
    const res = await send(port, "/api/generate", {
      host: "localhost:3000",
      origin: "https://attacker.example",
      "content-type": "text/plain",
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ success: false, error: "Cross-origin API requests are not allowed" });
    expect(handle).not.toHaveBeenCalled();
  });

  it.each(["null", "not a url", "http://localhost:4000", "http://127.0.0.1:3000"])(
    "refuses an API request from Origin %s",
    async (origin) => {
      const { port, handle } = await start();
      expect((await send(port, "/api/llm", { host: "localhost:3000", origin })).status).toBe(403);
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it.each(["cross-site", "same-site"])("refuses a %s GET to an API route", async (site) => {
    const { port, handle } = await start();
    expect((await send(port, "/api/env-status", { host: "localhost:3000", "sec-fetch-site": site }, "GET")).status).toBe(403);
    expect(handle).not.toHaveBeenCalled();
  });

  it("does not let X-Forwarded-Host excuse a foreign Origin", async () => {
    const { port } = await start();
    const res = await send(port, "/api/generate", {
      host: "localhost:3000",
      "x-forwarded-host": "attacker.example",
      origin: "http://attacker.example",
    });
    expect(res.status).toBe(403);
  });

  it("serves the app's own page, scripts and same-origin HTTPS deployments", async () => {
    const { port, handle } = await start({ HOST: "0.0.0.0" });
    expect((await send(port, "/api/generate", { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect((await send(port, "/api/generate", { host: "banana.example", origin: "https://banana.example" })).status).toBe(200);
    expect((await send(port, "/api/images/abc", { host: "localhost:3000" }, "GET")).status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(3);
  });

  it("leaves pages (not API routes) to Next whatever the referrer", async () => {
    const { port, handle } = await start();
    expect((await send(port, "/", { host: "localhost:3000", "sec-fetch-site": "cross-site" }, "GET")).status).toBe(200);
    expect(handle).toHaveBeenCalledOnce();
  });
});
