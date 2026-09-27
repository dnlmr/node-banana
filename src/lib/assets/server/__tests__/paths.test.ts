// @vitest-environment node
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectSynced,
  expandWindowsEnv,
  fallbackRoot,
  initLibraryLocation,
  parseRegistryDocuments,
  parseXdgDocuments,
  platformCacheDir,
  platformDefaultRoot,
  queryWindowsDocuments,
  readLibraryConfig,
  resolveLibraryLocation,
  userConfigFile,
  type PathContext,
} from "../paths";

let home: string;

function ctx(overrides: Partial<PathContext> = {}): PathContext {
  return { platform: process.platform === "win32" ? "win32" : "darwin", env: {}, homedir: home, ...overrides };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "nb-assets-home-"));
});

afterEach(() => {
  // Undo any chmod from the fallback tests before removing.
  for (const dir of [path.join(home, "Documents"), home]) {
    try {
      fs.chmodSync(dir, 0o755);
    } catch {
      // Not there.
    }
  }
  fs.rmSync(home, { recursive: true, force: true });
});

describe("resolution order", () => {
  it("uses the platform default when nothing is configured", async () => {
    const result = await resolveLibraryLocation(ctx({ platform: "darwin" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.location.source).toBe("default");
    expect(result.location.root).toBe(path.posix.join(home, "Documents", "Node Banana"));
    expect(result.location.cacheDir).toBe(path.posix.join(home, "Library", "Caches", "Node Banana"));
    expect(result.location.configFile).toBe(path.posix.join(home, ".node-banana", "library.json"));
    expect(result.location.registryFile).toBe(path.posix.join(home, ".node-banana", "projects.json"));
  });

  it("prefers library.json over the default, and the env override over both", async () => {
    const chosen = path.join(home, "Chosen");
    fs.mkdirSync(path.join(home, ".node-banana"), { recursive: true });
    fs.writeFileSync(path.join(home, ".node-banana", "library.json"), JSON.stringify({ root: chosen, setBy: "user" }));

    const fromConfig = await resolveLibraryLocation(ctx());
    expect(fromConfig.ok && fromConfig.location).toMatchObject({ root: chosen, source: "config", persisted: true });

    const override = path.join(home, "Override");
    const fromEnv = await resolveLibraryLocation(ctx({ env: { NODE_BANANA_ASSET_LIBRARY: override } }));
    expect(fromEnv.ok && fromEnv.location).toMatchObject({ root: override, source: "env" });
  });

  it("keeps config and cache under an env override, never under the home folder", async () => {
    const override = path.join(home, "Isolated");
    const result = await initLibraryLocation(ctx({ env: { NODE_BANANA_ASSET_LIBRARY: override } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.location.cacheDir).toBe(path.join(override, ".nodebanana", "cache"));
    expect(result.location.configFile).toBe(path.join(override, ".nodebanana", "config.json"));
    expect(result.location.registryFile).toBe(path.join(override, ".nodebanana", "projects.json"));
    expect(fs.existsSync(path.join(home, ".node-banana"))).toBe(false);
    expect(fs.existsSync(path.join(override, ".nodebanana"))).toBe(true);
  });

  it("refuses a relative env override", async () => {
    const result = await resolveLibraryLocation(ctx({ env: { NODE_BANANA_ASSET_LIBRARY: "relative/lib" } }));
    expect(result.ok).toBe(false);
  });

  it("honours NODE_BANANA_DEFAULT_LIBRARY from Electron main as the default", async () => {
    const provided = path.join(home, "FromElectron");
    const result = await resolveLibraryLocation(ctx({ env: { NODE_BANANA_DEFAULT_LIBRARY: provided } }));
    expect(result.ok && result.location).toMatchObject({ root: provided, source: "default" });
  });
});

describe("first init", () => {
  it("creates the default root and persists it so both builds agree", async () => {
    const c = ctx({ platform: process.platform === "win32" ? "win32" : "darwin", winDocumentsDir: path.join(home, "Documents") });
    const result = await initLibraryLocation(c);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = path.join(home, "Documents", "Node Banana");
    expect(result.location.root).toBe(expected);
    expect(fs.existsSync(path.join(expected, ".nodebanana"))).toBe(true);
    const stored = await readLibraryConfig(userConfigFile(c), c);
    expect(stored).toMatchObject({ root: expected, setBy: "default" });

    // Next time it comes from the file, still reported as the default.
    const again = await resolveLibraryLocation(c);
    expect(again.ok && again.location).toMatchObject({ root: expected, source: "default", persisted: true });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "falls back to ~/Node Banana when the default cannot be written, and remembers why",
    async () => {
      const documents = path.join(home, "Documents");
      fs.mkdirSync(documents);
      fs.chmodSync(documents, 0o500);
      const c = ctx({ platform: "darwin" });
      const result = await initLibraryLocation(c);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.location.source).toBe("fallback");
      expect(result.location.root).toBe(path.join(home, "Node Banana"));
      expect(result.location.fallbackReason).toMatch(/isn't allowed to write/);
      const stored = await readLibraryConfig(userConfigFile(c), c);
      expect(stored).toMatchObject({ root: path.join(home, "Node Banana"), setBy: "fallback" });

      const again = await resolveLibraryLocation(c);
      expect(again.ok && again.location.source).toBe("fallback");
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a user-chosen folder that cannot be written instead of falling back",
    async () => {
      const locked = path.join(home, "Locked");
      fs.mkdirSync(locked);
      fs.chmodSync(locked, 0o500);
      fs.mkdirSync(path.join(home, ".node-banana"));
      fs.writeFileSync(path.join(home, ".node-banana", "library.json"), JSON.stringify({ root: path.join(locked, "Lib"), setBy: "user" }));
      const result = await initLibraryLocation(ctx({ platform: "darwin" }));
      fs.chmodSync(locked, 0o755);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/Settings → Library/);
      expect(fs.existsSync(path.join(home, "Node Banana"))).toBe(false);
    },
  );
});

describe("Windows defaults (simulated)", () => {
  const win = (env: Record<string, string>, documents?: string | null): PathContext => ({
    platform: "win32",
    homedir: "C:\\Users\\ada",
    env: { USERPROFILE: "C:\\Users\\ada", LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local", ...env },
    winDocumentsDir: documents,
  });

  it("uses the Documents known folder", async () => {
    expect(await platformDefaultRoot(win({}, "D:\\Media\\Documents"))).toBe("D:\\Media\\Documents\\Node Banana");
  });

  it("expands %VAR% in the registry value", async () => {
    expect(await platformDefaultRoot(win({}, "%USERPROFILE%\\Documents"))).toBe("C:\\Users\\ada\\Documents\\Node Banana");
  });

  it("falls back to %USERPROFILE%\\Documents when the registry has nothing", async () => {
    expect(await platformDefaultRoot(win({}, null))).toBe("C:\\Users\\ada\\Documents\\Node Banana");
  });

  it("skips a Documents folder redirected into OneDrive", async () => {
    const env = { OneDrive: "C:\\Users\\ada\\OneDrive" };
    expect(await platformDefaultRoot(win(env, "C:\\Users\\ada\\OneDrive\\Documents"))).toBe("C:\\Users\\ada\\Node Banana");
    // Case differs from the env value: Windows paths compare case-insensitively.
    const commercial = { OneDriveCommercial: "C:\\Users\\ada\\OneDrive - Contoso" };
    expect(await platformDefaultRoot(win(commercial, "c:\\users\\ADA\\onedrive - contoso\\Documents"))).toBe(
      "C:\\Users\\ada\\Node Banana",
    );
  });

  it("keeps Documents when OneDrive is installed but Documents is not inside it", async () => {
    const env = { OneDrive: "C:\\Users\\ada\\OneDrive" };
    expect(await platformDefaultRoot(win(env, "C:\\Users\\ada\\Documents"))).toBe("C:\\Users\\ada\\Documents\\Node Banana");
  });

  it("puts the cache in LOCALAPPDATA and the fallback in the profile", () => {
    expect(platformCacheDir(win({}))).toBe("C:\\Users\\ada\\AppData\\Local\\Node Banana\\Cache");
    expect(fallbackRoot(win({}))).toBe("C:\\Users\\ada\\Node Banana");
  });

  it("reports a OneDrive root as synced", () => {
    expect(detectSynced("C:\\Users\\ada\\OneDrive\\Documents\\Node Banana", win({ OneDrive: "C:\\Users\\ada\\OneDrive" }))).toBe(
      "onedrive",
    );
    expect(detectSynced("C:\\Users\\ada\\Documents\\Node Banana", win({ OneDrive: "C:\\Users\\ada\\OneDrive" }))).toBeNull();
  });

  it("parses reg query output and expands env references", () => {
    const output = [
      "",
      "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
      "    Personal    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Documents",
      "",
    ].join("\r\n");
    const raw = parseRegistryDocuments(output);
    expect(raw).toBe("%USERPROFILE%\\OneDrive\\Documents");
    expect(expandWindowsEnv(raw!, win({}))).toBe("C:\\Users\\ada\\OneDrive\\Documents");
    expect(parseRegistryDocuments("ERROR: The system was unable to find the specified registry key")).toBeNull();
  });

  it("asks PowerShell for the Documents folder in UTF-8, and falls back to reg query", async () => {
    const calls: { command: string; args: string[] }[] = [];
    const moved = await queryWindowsDocuments(async (command, args) => {
      calls.push({ command, args });
      return "\uFEFFD:\\Médias\\Images\r\n";
    });
    expect(moved).toBe("D:\\Médias\\Images");
    expect(calls.map((call) => call.command)).toEqual(["powershell.exe"]);
    expect(calls[0].args.join(" ")).toMatch(/OutputEncoding = \[Text\.Encoding\]::UTF8/);
    expect(calls[0].args.join(" ")).toMatch(/GetFolderPath\('MyDocuments'\)/);

    const reg = "    Personal    REG_EXPAND_SZ    %USERPROFILE%\\Documents\r\n";
    const viaRegistry = await queryWindowsDocuments(async (command) => {
      if (command === "powershell.exe") throw Object.assign(new Error("spawn powershell.exe ENOENT"), { code: "ENOENT" });
      return reg;
    });
    expect(viaRegistry).toBe("%USERPROFILE%\\Documents");
  });

  it("drops a Documents path mangled in decoding rather than make it the library", async () => {
    // reg.exe writes the OEM code page: 'é' arrives as U+FFFD.
    const mangled = await queryWindowsDocuments(async (command) =>
      command === "powershell.exe" ? "" : "    Personal    REG_SZ    D:\\M\uFFFDdias\\Images\r\n",
    );
    expect(mangled).toBeNull();
    expect(await platformDefaultRoot(win({}, "D:\\M\uFFFDdias\\Images"))).toBe("C:\\Users\\ada\\Documents\\Node Banana");
  });
});

describe("other platforms", () => {
  it("reads XDG_DOCUMENTS_DIR like xdg-user-dir", () => {
    expect(parseXdgDocuments('XDG_DOCUMENTS_DIR="$HOME/Bilder"\n', "/home/ada")).toBe("/home/ada/Bilder");
    expect(parseXdgDocuments('XDG_DOCUMENTS_DIR="/data/pics"', "/home/ada")).toBe("/data/pics");
    // Pointing at $HOME disables the folder.
    expect(parseXdgDocuments('XDG_DOCUMENTS_DIR="$HOME/"', "/home/ada")).toBeNull();
  });

  it("uses the user-dirs file on Linux", async () => {
    const config = path.join(home, ".config");
    fs.mkdirSync(config);
    fs.writeFileSync(path.join(config, "user-dirs.dirs"), 'XDG_DOCUMENTS_DIR="$HOME/Fotos"\n');
    expect(await platformDefaultRoot(ctx({ platform: "linux" }))).toBe(path.posix.join(home, "Fotos", "Node Banana"));
    expect(platformCacheDir(ctx({ platform: "linux", env: { XDG_CACHE_HOME: "/var/cache/ada" } }))).toBe(
      "/var/cache/ada/node-banana",
    );
    expect(platformCacheDir(ctx({ platform: "linux" }))).toBe(path.posix.join(home, ".cache", "node-banana"));
  });

  it("flags iCloud and Dropbox folders on macOS", () => {
    const mac = ctx({ platform: "darwin", homedir: "/Users/ada" });
    expect(detectSynced("/Users/ada/Library/Mobile Documents/com~apple~CloudDocs/NB", mac)).toBe("icloud");
    expect(detectSynced("/Users/ada/Dropbox/Node Banana", mac)).toBe("dropbox");
    expect(detectSynced("/Users/ada/Library/CloudStorage/OneDrive-Personal/NB", mac)).toBe("onedrive");
    expect(detectSynced("/Users/ada/Documents/Node Banana", mac)).toBeNull();
  });
});
