# Codebase audit (September 2026) and what 2.0.0 took from it

In September an audit of `develop` at `30146c3` produced 24 commits on
`fix/codebase-high-severity-audit` (PR #159, never merged). It covered
execution and input routing; workflow persistence, tabs, the clipboard and
media ownership; the local server, its APIs and file writes; asynchronous chat
and media uploads. Only confirmed high-impact correctness and security issues
were fixed. It does not claim exhaustive coverage.

By the 2.0.0 release that branch was 460 commits behind `develop`. Each commit
was judged against `develop` as it stood (`9fb36e7`) and re-applied by hand on
`fix/security-backlog`, with a test of today's code, or recorded as already
fixed or dropped.

## What landed in 2.0.0

| Area | The failure, and the fix | Audit commit(s) |
| --- | --- | --- |
| Dependencies | `npm audit --omit=dev` reported 1 critical and 7 high. Next.js 16.3.8 (16.x below 16.3.6 carries critical RCE advisories in the image optimizer and `next/og`), sharp 0.35.5 and `npm audit fix` for the transitive ones (jws, ws, minimatch, brace-expansion, browserslist, postcss). Vitest 4.1 (dev only) clears its critical UI-server advisory. | 75bcad88 (superseded), 65d5f4b8 |
| Local server boundary | `server.js` listened on every interface, and only the agent, asset and file-path routes checked the caller. Any website could POST text/plain JSON to `/api/generate`, `/api/llm` or `/api/comfy/run` and spend the `.env` keys. Now it listens on `127.0.0.1` unless `HOST` says otherwise, refuses a non-loopback `Host` while on loopback (DNS rebinding), and refuses `/api` requests a browser marks cross-site or whose `Origin` is another host. It is done in `server.js`, not a Next proxy, because a proxy cuts request bodies off at 10 MB. | 0c75965d, 35c6b224, 3511b01e |
| Image optimizer | `/_next/image` fetched any local URL from inside the server, past the browser checks. Nothing uses `next/image`; `images.unoptimized` turns the endpoint off, for the web build and the packaged app. | fb56dd05 |
| Comfy credentials | The server sent `COMFY_API_KEY` and `COMFY_ORG_API_KEY` to whatever engine URL a request named. They now go only to the engine the environment configures. | 1de242f1 |
| Workflow file writes | A failed write truncated the previous save. `/api/workflow` now writes a temporary file and renames it over the old one. | f6802ac7 |
| Converging router inputs | Two branches fed from one router lost the second branch's data. Visited nodes are tracked per path. | 65c45df1 |
| Named prompt inputs | A connected `negative_prompt` could replace the prompt sent to the model. The `prompt` slot wins. | 12cc2936 |
| Save into another folder | Clearing file refs also revoked live video and 3D URLs the save still had to read. | ccb2c7a7 |
| Media replaced during a save | The save put its file ref on media replaced while it ran, so reopening brought the old media back. | 8531382e |
| Loads and saves across canvases | A slow load replaced whatever canvas was live when its media arrived (another tab's unsaved work), and a save that finished late wrote its refs onto a new graph. Both now check `canvasGeneration`, which a load advances when it starts. Saves queue rather than overlap. | 78e1bbc5 |
| Stopped runs | A stopped run that finished late overwrote the next run's output, marked its node failed, or unlocked the canvas mid-run. Runs now end and write only while they own the run state; a stopped run with nothing after it may still reset its node to idle. | 943755c5 |
| Run during a load | A run started on the outgoing graph while a file's media loaded survived the load. It is now aborted when the loaded graph commits. | f815f92c |
| Copied media | Closing a tab revoked object URLs a pasted copy in another tab, or the clipboard, still used. Pasting into another project kept the source folder's file refs. | 0c0a35c5 |
| Replaced video output | Stitch, trim and ease curve revoked their previous output while copies, other tabs or undo history still held it. The store now releases it only when nothing does. | bdf1978a, 58e764c0 |
| Uploads | Late file reads landed on a removed node, after a newer upload, or on another workflow's node with the same id; audio kept a stale file ref after replacement or removal. | 9b39ac36, 6a5e07c4 |

## What was dropped

| Audit commit(s) | Why |
| --- | --- |
| 25702d2d, 1e6a8e4e, ed73a315 | They scoped the legacy chat panel's callbacks to their workflow. On `develop` that panel cannot be opened (its toggle is hidden), and the agent window that replaced it already drops edits made after its canvas changed (`canvasGeneration`). `ed73a315` only served the chat panel's workflow builder. |
| 97c6b033 | The original version of this document; rewritten here. |

## Adapted, not copied

- The audit added a separate `workflowLifecycleId`. `develop` already had
  `canvasGeneration` for the agent, so the fixes use it.
- The audit refused a save that overlapped another; saves now wait their turn,
  so Cmd/Ctrl+S during an autosave is not lost.
- The audit blocked every write from a stopped run. Some executors (video
  edits, Comfy, split grid) reset their node to idle after an abort, so writes
  are blocked only once a newer run has started.
- `develop` has no separate previous-workflow snapshot, so blob ownership
  covers the nodes, other tabs, the clipboard and undo/redo.

## Checks and limits

- `npm audit --omit=dev`: no vulnerabilities. The full tree still reports high
  advisories in dev-only tooling (`http-cache-semantics` under
  electron-builder, whose "fix" would downgrade electron-builder).
- Next.js 16.3 type-checks every file `tsconfig.json` includes, so `next build`
  now uses `tsconfig.build.json`, which leaves the test files out. The
  standalone `npx tsc --noEmit -p .` count is unchanged at 209, all in test
  files.
- Exposing the server with `HOST=0.0.0.0` is still unauthenticated: use it on
  a trusted network or behind an authenticated proxy. It is not a multi-user
  deployment boundary. Behind a reverse proxy on the same machine, set `HOST`
  too, or the loopback Host check refuses the proxy's public host name.
- Download size limits and remote URL, DNS and redirect policies remain
  follow-up hardening outside the confirmed findings.
