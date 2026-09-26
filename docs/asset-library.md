# Asset library

Every image, video, audio clip and 3D model a workflow produces is saved to
disk as it is made, whether or not the workflow has a project folder, and
shows up in the **Assets** view. Projects still exist. An asset records the
workflow it came from, so creating a project adds that workflow's earlier
assets to it without moving any files.

## Where files go

| | macOS | Windows | Linux |
|---|---|---|---|
| Library (default) | `~/Pictures/Node Banana` | `Pictures\Node Banana`, or `%USERPROFILE%\Node Banana` when Pictures is inside OneDrive | `$(xdg-user-dir PICTURES)/Node Banana` |
| Thumbnails (rebuildable) | `~/Library/Caches/Node Banana` | `%LOCALAPPDATA%\Node Banana\Cache` | `$XDG_CACHE_HOME/node-banana` |
| Location choice | `~/.node-banana/library.json` | same | same |

The library root is resolved on the server, so the desktop app and
`npm run dev` agree. Resolution order:

1. `NODE_BANANA_ASSET_LIBRARY` (tests, scripted Electron runs).
2. The saved choice in `~/.node-banana/library.json`.
3. `NODE_BANANA_DEFAULT_LIBRARY`, which Electron main computes with the
   OneDrive rule.
4. The platform default.

The first successful use saves the default root to `library.json`. If the
default folder can't be written (for example Controlled Folder Access, or
permissions), the library falls back to `~/Node Banana` and says why. On a
hosted, read-only server the library is unavailable, and recording falls back
to the old project-only save.

```
<root>/
  Generations/YYYY-MM-DD/HHMMSS_<prompt>_<sha8>.<ext>   assets of workflows with no project
  .nodebanana/                                         hidden metadata
    library.json                                       marker
    assets/<assetId>.json                              one sidecar per asset
    runs/<runId>.json.gz                               workflow snapshots of a run
    media/<sha256>.<ext>                               snapshot inputs no asset holds (uploads)
    media/<sha256>.ref                                 checked pointer to a kept project file a snapshot uses
    posters/<sha256>.webp                              video posters made in the browser
    workflows.json                                     workflow id → name, project folder
    journal.ndjson                                     change log (other processes, tombstones)
    writers/, lock, move.json                          in-flight writes per server; a running move
```

A workflow with a project keeps writing into `<project>/generations/` under
the legacy `<prompt>_<md5>.<ext>` name, and the library indexes those files
where they are. Files are never moved by classification. The same bytes
produced twice are stored once per destination folder, and each production
still gets its own record.

## Recording

`src/lib/assets/client/recorder.ts` is the only path by which the browser
saves an asset. `initAssetLibrary()` runs once from `page.tsx`. Executors
receive `ctx.recordAsset` only while the library is available, and fall back
to `/api/save-generation` for project workflows otherwise.

- The id is minted in the browser, so it goes into the carousel entry together
  with the output. Nothing is written back to node data later.
- data: and blob: media are turned into Blobs when the call is made, and
  http(s) URLs are downloaded by the server. Uploads are two-step
  (`POST /api/assets` → ticket, then `PUT /api/assets/uploads/[id]` with the
  raw bytes), and the server streams them to disk while hashing.
- Recordings have their own queue (concurrency 2). They never count as
  `pendingMediaSaves`, so tabs stay usable. Only project-mode recordings,
  which still rename carousel ids, are tracked.
- Generated assets come from nanoBanana, generateVideo, generateAudio,
  generate3d and comfyApp (every media output). Edited assets come from
  removeBackground, imageResize, gifEncoder, videoStitch, videoTrim,
  easeCurve, videoFrameGrab, splitGrid cells, the annotation editor (Done
  with at least one shape), and canvas split-to-nodes. An edited output
  identical to the previous one is not recorded again.

## Opening the original workflow

Each run brackets its recordings (`beginRun` / `endRun`). The run's starting
graph is encoded the first time the run records an asset. The graph at the
end of the run is encoded too, unless the canvas was replaced mid-run. Media
in a snapshot becomes `{ $nbMedia: sha256 }` refs, and the browser uploads
only the bytes the server lacks.

"Open workflow" hydrates the snapshot and puts the asset back into the node
that made it. The copy opens as a new, unsaved tab named
`<name> (27 Sep 14:32)`, with a fresh id and no folder, so it can never
overwrite a project. For a project's asset, "Open project" opens the project
itself, and "Open as it was when made" opens the snapshot.

## Deleting

**Trash** is the in-app bin: restorable, and emptied after 30 days.

**Delete permanently** only applies to items in the Trash, and to records
whose file is already gone ("Remove from library"). The server refuses it for
anything else. It removes the record. What happens to the file depends on
where it is:

- A library file goes to the OS Trash (Recycle Bin), unless another record or
  a stored snapshot still uses the bytes. Snapshot-referenced bytes move to
  `.nodebanana/media` instead.
- Files inside project folders stay unless you opt in, because the project's
  workflow file points at them. A snapshot that still uses one keeps a checked
  `.ref` pointer to it, not a copy.

A run's snapshot is deleted with its last asset, so emptying the Trash frees
the space. If some asset record can't be read at that moment (a cloud
placeholder, a locked file), the delete keeps the files and notes them in
`.nodebanana/pending-release/`, and the next delete or clean-up releases them
once every record reads again. The 30-day auto-empty uses the OS Trash too. The one exception is
web mode on older macOS, where only the Finder route exists and would prompt
for permission; there it deletes the files outright.

## Moving the library

Settings → Library → Change… offers two choices:

- **Move my library there.** This is a background job. It copies
  `Generations/` and `.nodebanana/`, verifies each file's size and hash,
  switches the root, then deletes only the copied files from the old folder.
  Projects stay where they are. Writes pause while the move runs, in this
  server and in any other one using the same library.
- **Use that folder.** This switches to the new folder; the old library stays
  on disk.

A move that stops part-way is detected at the next start and its partial copy
undone.

## Access

`/api/assets/*` and the older routes that take a file path answer only Node
Banana's own page on this computer. That is the same loopback stamp as the
agent routes, so run the app with `npm run dev` / `npm start` / Electron.
`NB_LIBRARY_ALLOWED_HOSTS` opts other hosts in, for example a LAN address.

## Key files

| Purpose | Location |
|---|---|
| Contracts (records, queries, snapshots, routes) | `src/lib/assets/types.ts`, `src/lib/assets/query.ts` |
| Server facade the routes call | `src/lib/assets/server/index.ts` |
| Index, journal, queries, deletes | `src/lib/assets/server/library.ts`, `search.ts` |
| Upload/URL ingest, dedupe, downloads (SSRF-guarded) | `src/lib/assets/server/ingest.ts`, `download.ts` |
| Location resolution, platform defaults | `src/lib/assets/server/paths.ts` |
| Thumbnails (sharp), jobs (move, import, cleanup, export) | `src/lib/assets/server/thumbs.ts`, `jobs.ts` |
| Reveal / OS Trash (Electron bridge or OS tools) | `src/lib/assets/server/desktop.ts`, `electron/lib/bridge.cjs` |
| Request guard | `src/lib/assets/server/guard.ts` |
| Routes | `src/app/api/assets/**` |
| Recorder, snapshots, open workflow | `src/lib/assets/client/` |
| Store integration | `src/store/execution/assetRecording.ts`, `workflowStore.ts` (`_currentRun`, `ensureWorkflowId`, `recordUiAsset`) |
| Assets view | `src/store/assetStore.ts`, `src/components/assets/` |
| Settings → Library | `src/components/settings/LibrarySettingsTab.tsx` |

## Tests

- Server: `npx vitest run src/lib/assets/server`. These are node tests on
  real temp directories, pinned with `NODE_BANANA_ASSET_LIBRARY` or an
  injected path context.
- Routes: `npx vitest run src/app/api/assets`.
- Client, store and UI: `npx vitest run src/lib/assets/client src/store src/components/assets`.
- Electron bridge and default location: `npm run electron:test`. Scripted
  Electron runs (`NODE_BANANA_ELECTRON_USER_DATA`) keep the library inside
  the temp profile.
