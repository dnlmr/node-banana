import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import path from "path";
import os from "os";
import { getLibraryStatus } from "@/lib/assets/server";
import { isInsideRoot } from "@/lib/assets/server/fsutil";
import { guardAssetRequest } from "@/lib/assets/server/guard";

const execFileAsync = promisify(execFile);

/** A project folder the page named: absolute, and not a filesystem root (which would allow everything). */
function projectRoot(value: unknown): string | null {
    if (typeof value !== "string" || !value || value.includes("\0") || !path.isAbsolute(value)) return null;
    const resolved = path.resolve(value);
    return resolved === path.parse(resolved).root ? null : resolved;
}

/** Where the asset library lives now, or null when it cannot say. */
async function libraryRoot(): Promise<string | null> {
    try {
        return (await getLibraryStatus()).root ?? null;
    } catch {
        return null;
    }
}

/**
 * Whether a file may be revealed: it must sit strictly inside the home
 * folder, the project folder the page names, or the asset library. The
 * library can be moved or switched to any folder (another drive, say), and
 * a redirected Pictures folder can put even the default outside home, so it
 * is asked for last, only when the cheaper checks fail. Folders compare
 * case-insensitively where the filesystem does (macOS, Windows).
 */
async function isAllowedPath(target: string, projectPath: unknown): Promise<boolean> {
    const inside = (root: string | null) => root !== null && isInsideRoot(root, target);
    return inside(os.homedir()) || inside(projectRoot(projectPath)) || inside(await libraryRoot());
}

/**
 * POST { filePath, projectPath? }: show a file in Finder / Explorer (Linux
 * opens its folder). `projectPath` is the open workflow's project folder,
 * for files saved there.
 */
export async function POST(req: NextRequest) {
    // Only Node Banana's own page on this computer (see guard.ts). A Host or
    // X-Forwarded-For header alone proves nothing: the client writes both.
    const refused = guardAssetRequest(req);
    if (refused) return refused;

    try {
        const body = await req.json();
        const { filePath: inputPath, projectPath } = body;

        if (!inputPath || typeof inputPath !== "string") {
            return NextResponse.json(
                { success: false, error: "File path is required" },
                { status: 400 }
            );
        }

        // Normalize and resolve the path to prevent traversal attacks
        const normalizedPath = path.resolve(inputPath);

        if (!(await isAllowedPath(normalizedPath, projectPath))) {
            return NextResponse.json(
                { success: false, error: "Path is outside allowed directory" },
                { status: 403 }
            );
        }

        // Validate that the path exists and is a file
        try {
            const stats = await stat(normalizedPath);
            if (!stats.isFile()) {
                return NextResponse.json(
                    { success: false, error: "Path is not a file" },
                    { status: 400 }
                );
            }
        } catch {
            return NextResponse.json(
                { success: false, error: "File does not exist" },
                { status: 400 }
            );
        }

        const platform = os.platform();
        let command = "";
        let args: string[] = [];

        switch (platform) {
            case "darwin":
                command = "open";
                args = ["-R", normalizedPath];
                break;
            case "win32":
                command = "explorer";
                args = [`/select,"${normalizedPath}"`];
                break;
            case "linux":
                // Linux has no universal "reveal in folder" — open parent directory
                command = "xdg-open";
                args = [path.dirname(normalizedPath)];
                break;
            default:
                command = "xdg-open";
                args = [path.dirname(normalizedPath)];
        }

        try {
            await execFileAsync(command, args);
        } catch (err: unknown) {
            // Windows explorer returns non-zero exit code even on success
            if (platform === "win32" && err && typeof err === "object" && "code" in err) {
                // Explorer launched successfully despite non-zero exit
            } else {
                throw err;
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Failed to reveal file:", error);
        return NextResponse.json(
            { success: false, error: "Failed to open file location" },
            { status: 500 }
        );
    }
}
