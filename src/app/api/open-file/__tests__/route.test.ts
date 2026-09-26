// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Use vi.hoisted so mock fns are available during vi.mock() hoisting
const { mockExecFileAsync, mockStat, mockPlatform, mockHomedir, mockGuard, mockLibraryStatus } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
  mockStat: vi.fn(),
  mockPlatform: vi.fn(),
  mockHomedir: vi.fn(),
  mockGuard: vi.fn(),
  mockLibraryStatus: vi.fn(),
}));

// The guard itself is covered by src/app/api/__tests__/fileRoutesGuard.test.ts.
vi.mock("@/lib/assets/server/guard", () => ({ guardAssetRequest: mockGuard }));
vi.mock("@/lib/assets/server", () => ({ getLibraryStatus: mockLibraryStatus }));

vi.mock(import("child_process"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFile: vi.fn(),
  };
});

vi.mock(import("util"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: () => mockExecFileAsync,
  };
});

vi.mock(import("fs/promises"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    stat: (...args: unknown[]) => mockStat(...args),
  };
});

vi.mock(import("os"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual,
      platform: () => mockPlatform(),
      homedir: () => mockHomedir(),
    },
    platform: () => mockPlatform(),
    homedir: () => mockHomedir(),
  };
});

import { POST } from "../route";

// Helper to create mock NextRequest
function createMockRequest(
  body: unknown,
  headers?: Record<string, string>
): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers({ host: "localhost:3000", ...headers }),
  } as unknown as NextRequest;
}

describe("/api/open-file route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform.mockReturnValue("darwin");
    mockHomedir.mockReturnValue("/Users/testuser");
    mockLibraryStatus.mockResolvedValue({ available: true, root: "/Users/testuser/Pictures/Node Banana" });
  });

  describe("request guard", () => {
    it("returns the guard's refusal before reading the body or the disk", async () => {
      const refusal = new Response(JSON.stringify({ error: "refused", code: "forbidden" }), { status: 403 });
      mockGuard.mockReturnValueOnce(refusal);
      const request = createMockRequest({ filePath: "/Users/testuser/file.glb" });

      const response = await POST(request);

      expect(response).toBe(refusal);
      expect(request.json).not.toHaveBeenCalled();
      expect(mockStat).not.toHaveBeenCalled();
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it("goes on when the guard lets the request through", async () => {
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest({ filePath: "/Users/testuser/file.glb" });
      const response = await POST(request);

      expect(mockGuard).toHaveBeenCalledWith(request);
      expect(response.status).toBe(200);
      expect((await response.json()).success).toBe(true);
    });
  });

  describe("input validation", () => {
    it("should return 400 for missing filePath", async () => {
      const request = createMockRequest({});

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("File path is required");
    });

    it("should return 400 for empty filePath", async () => {
      const request = createMockRequest({ filePath: "" });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("File path is required");
    });

    it("should return 400 for non-string filePath", async () => {
      const request = createMockRequest({ filePath: 12345 });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("File path is required");
    });
  });

  describe("path restriction", () => {
    it("should return 403 for path outside home directory", async () => {
      const request = createMockRequest({ filePath: "/etc/passwd" });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Path is outside allowed directory");
    });

    const EXTERNAL_LIBRARY = "/Volumes/External/Node Banana";
    const revealOk = () => {
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
    };
    const reveal = async (body: Record<string, unknown>) => {
      const response = await POST(createMockRequest(body));
      return { status: response.status, data: await response.json() };
    };

    it("reveals a file in the asset library when the library lives outside home", async () => {
      revealOk();
      mockLibraryStatus.mockResolvedValue({ available: true, root: EXTERNAL_LIBRARY });
      const filePath = `${EXTERNAL_LIBRARY}/Generations/2026-09-27/101500_cube_deadbeef.glb`;

      const { status, data } = await reveal({ filePath });

      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith("open", ["-R", filePath]);
    });

    it("reveals a file in an unavailable library whose folder is still known", async () => {
      revealOk();
      mockLibraryStatus.mockResolvedValue({ available: false, reason: "Read-only", root: EXTERNAL_LIBRARY });

      const { status } = await reveal({ filePath: `${EXTERNAL_LIBRARY}/Generations/model.glb` });

      expect(status).toBe(200);
    });

    it("reveals a file inside the project folder the page names", async () => {
      revealOk();
      const filePath = "/Volumes/Work/Cubes/generations/model.glb";

      const { status } = await reveal({ filePath, projectPath: "/Volumes/Work/Cubes" });

      expect(status).toBe(200);
      expect(mockExecFileAsync).toHaveBeenCalledWith("open", ["-R", filePath]);
    });

    it("does not ask the library about a file under home", async () => {
      revealOk();

      expect((await reveal({ filePath: "/Users/testuser/generations/model.glb" })).status).toBe(200);
      expect(mockLibraryStatus).not.toHaveBeenCalled();
    });

    it.each([
      ["a sibling folder that only shares the library's prefix", `${EXTERNAL_LIBRARY} 2/model.glb`, {}],
      ["a path that climbs out of the library", `${EXTERNAL_LIBRARY}/Generations/../../secret.glb`, {}],
      ["a path that climbs out of the project", "/Volumes/Work/Cubes/../Other/model.glb", { projectPath: "/Volumes/Work/Cubes" }],
      ["a file outside a named project", "/Volumes/Work/Other/model.glb", { projectPath: "/Volumes/Work/Cubes" }],
      ["a project folder that is a filesystem root", "/etc/passwd", { projectPath: "/" }],
      ["a relative project folder", "/etc/passwd", { projectPath: "etc" }],
      ["a project folder that is not a string", "/etc/passwd", { projectPath: ["/etc"] }],
    ])("refuses %s", async (_label, filePath, extra) => {
      revealOk();
      mockLibraryStatus.mockResolvedValue({ available: true, root: EXTERNAL_LIBRARY });

      const { status, data } = await reveal({ filePath, ...extra });

      expect(status).toBe(403);
      expect(data.error).toBe("Path is outside allowed directory");
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it("refuses a path outside home when the library cannot say where it is", async () => {
      revealOk();
      mockLibraryStatus.mockRejectedValue(new Error("boom"));

      expect((await reveal({ filePath: `${EXTERNAL_LIBRARY}/model.glb` })).status).toBe(403);
    });

    it.runIf(process.platform === "darwin" || process.platform === "win32")(
      "compares folders case-insensitively where the filesystem does",
      async () => {
        revealOk();
        mockLibraryStatus.mockResolvedValue({ available: true, root: EXTERNAL_LIBRARY });

        expect((await reveal({ filePath: "/volumes/external/node banana/Generations/model.glb" })).status).toBe(200);
      },
    );
  });

  describe("file validation", () => {
    it("should return 400 when path is a directory", async () => {
      mockStat.mockResolvedValue({ isFile: () => false });

      const request = createMockRequest({
        filePath: "/Users/testuser/generations",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Path is not a file");
    });

    it("should return 400 when file does not exist", async () => {
      mockStat.mockRejectedValue(new Error("ENOENT"));

      const request = createMockRequest({
        filePath: "/Users/testuser/nonexistent.glb",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("File does not exist");
    });
  });

  describe("platform commands", () => {
    it("should call 'open -R' on macOS", async () => {
      mockPlatform.mockReturnValue("darwin");
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest({
        filePath: "/Users/testuser/generations/model.glb",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith("open", [
        "-R",
        "/Users/testuser/generations/model.glb",
      ]);
    });

    it("should call 'xdg-open' with parent directory on Linux", async () => {
      mockPlatform.mockReturnValue("linux");
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const request = createMockRequest({
        filePath: "/Users/testuser/generations/model.glb",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockExecFileAsync).toHaveBeenCalledWith("xdg-open", [
        "/Users/testuser/generations",
      ]);
    });

    it("should return 500 when command execution fails", async () => {
      mockStat.mockResolvedValue({ isFile: () => true });
      mockExecFileAsync.mockRejectedValue(new Error("Command not found"));

      const request = createMockRequest({
        filePath: "/Users/testuser/generations/model.glb",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to open file location");
    });
  });
});
