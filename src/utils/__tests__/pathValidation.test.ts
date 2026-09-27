// @vitest-environment node
import * as path from "path";
import { describe, expect, it } from "vitest";

import { validateWorkflowPath } from "../pathValidation";

describe("validateWorkflowPath (POSIX)", () => {
  const check = (p: string) => validateWorkflowPath(p, path.posix);

  it("accepts an absolute folder and returns it unchanged", () => {
    expect(check("/Users/me/Projects/banana")).toEqual({ valid: true, resolved: "/Users/me/Projects/banana" });
  });

  it("accepts trailing and doubled separators, returning the resolved form", () => {
    expect(check("/Users/me/proj/")).toEqual({ valid: true, resolved: "/Users/me/proj" });
    expect(check("/Users//me/./proj")).toEqual({ valid: true, resolved: "/Users/me/proj" });
  });

  it("refuses relative paths", () => {
    expect(check("relative/path")).toMatchObject({ valid: false, error: "Path must be absolute" });
    expect(check("")).toMatchObject({ valid: false, error: "Path must be absolute" });
  });

  it("refuses any .. segment, even one that would resolve somewhere harmless", () => {
    expect(check("/test/../etc/passwd")).toMatchObject({ valid: false, error: "Path contains traversal sequences" });
    expect(check("/Users/me/proj/..")).toMatchObject({ valid: false, error: "Path contains traversal sequences" });
    expect(check("/Users/me/..\\other")).toMatchObject({ valid: false, error: "Path contains traversal sequences" });
  });

  it("allows names that merely contain dots", () => {
    expect(check("/Users/me/my..project")).toMatchObject({ valid: true });
    expect(check("/Users/me/.hidden")).toMatchObject({ valid: true });
  });

  it("blocks system folders and anything inside them", () => {
    expect(check("/etc")).toMatchObject({ valid: false, error: "Access to /etc is not allowed" });
    expect(check("/etc/workflows")).toMatchObject({ valid: false, error: "Access to /etc is not allowed" });
    expect(check("/System/Library")).toMatchObject({ valid: false, error: "Access to /System is not allowed" });
    expect(check("/Library/Application Support")).toMatchObject({
      valid: false,
      error: "Access to /Library is not allowed",
    });
    expect(check("/etc/")).toMatchObject({ valid: false, error: "Access to /etc is not allowed" });
  });

  it("does not block folders that only share a prefix with a system folder", () => {
    expect(check("/etcetera/proj")).toMatchObject({ valid: true });
    expect(check("/Users/me/Library/proj")).toMatchObject({ valid: true });
  });

  it("uses the platform's own path module by default", () => {
    const absolute = path.resolve("/tmp-nb-validate", "proj");
    expect(validateWorkflowPath(absolute)).toEqual({ valid: true, resolved: absolute });
  });
});

describe("validateWorkflowPath (Windows)", () => {
  const check = (p: string) => validateWorkflowPath(p, path.win32);

  it("accepts a drive path", () => {
    expect(check("C:\\Users\\me\\proj")).toEqual({ valid: true, resolved: "C:\\Users\\me\\proj" });
  });

  it("accepts mixed separators, as the client builds `${dir}/generations`", () => {
    expect(check("C:\\Users\\me\\proj/generations")).toEqual({
      valid: true,
      resolved: "C:\\Users\\me\\proj\\generations",
    });
    expect(check("C:/Users/me/proj")).toEqual({ valid: true, resolved: "C:\\Users\\me\\proj" });
    expect(check("D:\\Library\\Node Banana\\")).toEqual({ valid: true, resolved: "D:\\Library\\Node Banana" });
  });

  it("accepts UNC shares", () => {
    expect(check("\\\\server\\share\\proj")).toMatchObject({ valid: true });
  });

  it("refuses drive-relative and relative paths", () => {
    expect(check("C:proj")).toMatchObject({ valid: false, error: "Path must be absolute" });
    expect(check("proj\\sub")).toMatchObject({ valid: false, error: "Path must be absolute" });
  });

  it("refuses .. segments with either separator", () => {
    for (const p of ["C:\\Users\\me\\..\\other", "C:/Users/me/../other", "C:\\Users\\me/..\\other", "C:\\a\\.."]) {
      expect(check(p), p).toMatchObject({ valid: false, error: "Path contains traversal sequences" });
    }
  });

  it("blocks the Windows system folders, case-insensitively", () => {
    expect(check("C:\\Windows")).toMatchObject({ valid: false, error: "Access to C:\\Windows is not allowed" });
    expect(check("c:\\windows\\System32")).toMatchObject({ valid: false, error: "Access to C:\\Windows is not allowed" });
    expect(check("C:/Program Files/App")).toMatchObject({
      valid: false,
      error: "Access to C:\\Program Files is not allowed",
    });
    expect(check("C:\\PROGRAM FILES (X86)\\App")).toMatchObject({
      valid: false,
      error: "Access to C:\\Program Files (x86) is not allowed",
    });
    expect(check("C:\\ProgramData")).toMatchObject({ valid: false, error: "Access to C:\\ProgramData is not allowed" });
  });

  it("sees through the spellings Windows treats as the same folder", () => {
    expect(check("\\\\?\\C:\\Windows\\Temp")).toMatchObject({ valid: false });
    expect(check("C:\\Windows.\\Temp")).toMatchObject({ valid: false });
    expect(check("C:\\Windows \\Temp")).toMatchObject({ valid: false });
  });

  it("does not block folders that only share a prefix with a system folder", () => {
    expect(check("C:\\WindowsApps\\proj")).toMatchObject({ valid: true });
    expect(check("C:\\Users\\me\\Windows")).toMatchObject({ valid: true });
    expect(check("D:\\Windows")).toMatchObject({ valid: true });
  });

  it("does not apply the POSIX list to Windows paths", () => {
    expect(check("C:\\etc\\proj")).toMatchObject({ valid: true });
  });
});
