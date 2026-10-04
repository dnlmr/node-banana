import * as path from "path";

/** The parts of Node's `path` module the validator uses; tests pass `path.win32` or `path.posix`. */
export type PathModule = Pick<path.PlatformPath, "isAbsolute" | "resolve" | "sep">;

/** System folders a workflow, project or library folder may never be. */
const POSIX_BLOCKED_PREFIXES = [
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/sys",
  "/proc",
  "/var/run",
  "/System",
  "/Library",
];

/** Matched case-insensitively, as Windows compares paths. */
const WINDOWS_BLOCKED_PREFIXES = [
  "C:\\Windows",
  "C:\\Program Files",
  "C:\\Program Files (x86)",
  "C:\\ProgramData",
];

/**
 * Validates a workflow directory path to prevent path traversal attacks.
 * Ensures the path is absolute, doesn't contain traversal sequences,
 * and doesn't point to dangerous system directories.
 *
 * Any `..` segment is refused outright, whichever separator it sits
 * between. Otherwise the path is judged by its `path.resolve` form, so
 * Windows paths that mix separators (`C:\proj/generations`), trailing
 * separators and doubled separators are accepted; `resolved` is that form.
 */
export function validateWorkflowPath(
  inputPath: string,
  pathModule: PathModule = path
): {
  valid: boolean;
  resolved: string;
  error?: string;
} {
  // Must be an absolute path
  if (!pathModule.isAbsolute(inputPath)) {
    return {
      valid: false,
      resolved: inputPath,
      error: "Path must be absolute",
    };
  }

  // Refuse `..` segments before resolving, which would silently apply them
  if (inputPath.split(/[\\/]/).includes("..")) {
    return {
      valid: false,
      resolved: inputPath,
      error: "Path contains traversal sequences",
    };
  }

  const resolved = pathModule.resolve(inputPath);

  // Block known dangerous system directories
  const blocked = blockedPrefix(resolved, pathModule);
  if (blocked) {
    return {
      valid: false,
      resolved,
      error: `Access to ${blocked} is not allowed`,
    };
  }

  return {
    valid: true,
    resolved,
  };
}

function blockedPrefix(resolved: string, pathModule: PathModule): string | null {
  if (pathModule.sep === "\\") {
    // `\\?\C:\Windows`, `\\.\C:\Windows` and `C:\Windows.\` name the same
    // folder: Windows drops trailing dots and spaces from each segment.
    const candidate = resolved
      .replace(/^\\\\[?.]\\/, "")
      .split("\\")
      .map((segment) => segment.replace(/[. ]+$/, ""))
      .join("\\")
      .toLowerCase();
    for (const prefix of WINDOWS_BLOCKED_PREFIXES) {
      const lower = prefix.toLowerCase();
      if (candidate === lower || candidate.startsWith(lower + "\\")) return prefix;
    }
    return null;
  }

  for (const prefix of POSIX_BLOCKED_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + "/")) return prefix;
  }
  return null;
}
