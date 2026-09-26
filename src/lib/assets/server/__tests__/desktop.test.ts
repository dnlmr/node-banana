// @vitest-environment node
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopServerBridge } from "../../types";
import { openFolder, revealFile, trashFile, type ExecRunner } from "../desktop";
import { tempDir } from "./helpers";

let dir: string;

beforeEach(() => {
  dir = tempDir("nb-assets-desktop-");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function recorder(behaviour: (command: string, args: string[]) => void = () => {}) {
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = [];
  const exec: ExecRunner = async (command, args, options) => {
    calls.push({ command, args, options: options as Record<string, unknown> });
    behaviour(command, args);
  };
  return { calls, exec };
}

describe("revealFile", () => {
  const file = "C:\\Users\\ada\\Pictures\\Node Banana\\Generations\\a b.png";

  it("selects the file in Explorer with one verbatim argument", async () => {
    const { calls, exec } = recorder();
    await revealFile(file, { platform: "win32", exec, bridge: null });
    expect(calls).toEqual([
      { command: "explorer.exe", args: [`/select,"${file}"`], options: { windowsVerbatimArguments: true } },
    ]);
  });

  it("ignores Explorer's non-zero exit code", async () => {
    const exec: ExecRunner = async () => {
      throw Object.assign(new Error("exit 1"), { code: 1 });
    };
    await expect(revealFile(file, { platform: "win32", exec, bridge: null })).resolves.toBeUndefined();
  });

  it("uses open -R on macOS and the folder on Linux", async () => {
    const mac = recorder();
    await revealFile("/Users/ada/x.png", { platform: "darwin", exec: mac.exec, bridge: null });
    expect(mac.calls[0]).toMatchObject({ command: "open", args: ["-R", "/Users/ada/x.png"] });
    const linux = recorder();
    await revealFile("/home/ada/x.png", { platform: "linux", exec: linux.exec, bridge: null });
    expect(linux.calls[0]).toMatchObject({ command: "xdg-open", args: ["/home/ada"] });
  });

  it("goes through the desktop bridge when there is one", async () => {
    const bridge: DesktopServerBridge = { request: vi.fn(async () => ({ ok: true as const })) };
    const { calls, exec } = recorder();
    await revealFile("/x.png", { platform: "darwin", exec, bridge });
    expect(bridge.request).toHaveBeenCalledWith("reveal", { path: "/x.png" });
    expect(calls).toEqual([]);
  });

  it("opens a folder", async () => {
    const { calls, exec } = recorder();
    await openFolder("D:\\Lib", { platform: "win32", exec, bridge: null });
    expect(calls[0]).toMatchObject({ command: "explorer.exe", args: ["D:\\Lib"] });
  });
});

describe("trashFile", () => {
  it("passes the path to PowerShell through an env var, never the command line", async () => {
    const file = path.join(dir, "x'; Remove-Item -Recurse C:\\ ; '.png");
    fs.writeFileSync(file, "x");
    const { calls, exec } = recorder(() => fs.unlinkSync(file));
    expect(await trashFile(file, { platform: "win32", exec, bridge: null })).toBe("os");
    expect(calls[0].command).toBe("powershell.exe");
    expect(calls[0].args.join(" ")).not.toContain(file);
    expect((calls[0].options.env as Record<string, string>).NB_TRASH_PATH).toBe(file);
  });

  it("passes the path to osascript as an argument when /usr/bin/trash is missing", async () => {
    const file = path.join(dir, 'quote " and \\ backslash.png');
    fs.writeFileSync(file, "x");
    const { calls, exec } = recorder((command) => {
      if (command === "/usr/bin/trash") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      fs.unlinkSync(file);
    });
    expect(await trashFile(file, { platform: "darwin", exec, bridge: null })).toBe("os");
    const osascript = calls.find((call) => call.command === "osascript")!;
    expect(osascript.args[osascript.args.length - 1]).toBe(file);
    expect(osascript.args.slice(0, -1).join(" ")).not.toContain(file);
  });

  it("uses gio on Linux", async () => {
    const file = path.join(dir, "x.png");
    fs.writeFileSync(file, "x");
    const { calls, exec } = recorder(() => fs.unlinkSync(file));
    await trashFile(file, { platform: "linux", exec, bridge: null });
    expect(calls[0]).toMatchObject({ command: "gio", args: ["trash", file] });
  });

  it("unlinks only when every trash route fails (or leaves the file behind)", async () => {
    const file = path.join(dir, "x.png");
    fs.writeFileSync(file, "x");
    const { exec } = recorder(); // "succeeds" but moves nothing
    expect(await trashFile(file, { platform: "linux", exec, bridge: null })).toBe("unlink");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("prefers the desktop bridge", async () => {
    const bridge: DesktopServerBridge = { request: vi.fn(async () => ({ ok: true as const })) };
    const { calls, exec } = recorder();
    expect(await trashFile("/x.png", { platform: "darwin", exec, bridge })).toBe("bridge");
    expect(bridge.request).toHaveBeenCalledWith("trash", { path: "/x.png" });
    expect(calls).toEqual([]);
  });
});
