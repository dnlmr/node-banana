---
phase: 05-image-url-server
plan: 02
subsystem: api
tags: [replicate, fal.ai, img2img, image-url, cleanup]

# Dependency graph
requires:
  - phase: 05-01
    provides: Image store, uploadImageForUrl, shouldUseImageUrl, deleteImages utilities
  - phase: 03-02
    provides: generateWithReplicate, generateWithFal provider dispatch
provides:
  - img2img workflow support for Replicate and fal.ai
  - Automatic large image → URL conversion
  - Cleanup of temporary images after provider calls
affects: [phase-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - try/finally cleanup pattern for uploaded images

key-files:
  created: []
  modified:
    - src/app/api/generate/route.ts

key-decisions:
  - "Use 'image' param for Replicate (most common for img2img models)"
  - "Use 'image_url' param for fal.ai (consistent across models)"
  - "Small images (<256KB) pass as data URIs directly"
  - "Gemini path unchanged (handles base64 natively)"

patterns-established:
  - "Provider image upload: process → call → cleanup in finally block"

issues-created: []

# Metrics
duration: 2min
completed: 2026-01-09
---

# Phase 5 Plan 2: Provider Image Integration Summary

**img2img support for Replicate and fal.ai via automatic image URL conversion with cleanup**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-09T09:51:03Z
- **Completed:** 2026-01-09T09:53:44Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Replicate predictions receive image input via `image` parameter
- fal.ai requests receive image input via `image_url` parameter
- Large images (>256KB) automatically converted to temporary URLs
- Uploaded images cleaned up immediately after provider call completes
- Small images pass efficiently as data URIs

## Task Commits

Each task was committed atomically:

1. **Task 1: Update generateWithReplicate to pass image input** - `4477f6f` (feat)
2. **Task 2: Update generateWithFal to pass image_url parameter** - `6324af3` (feat)
3. **Task 3: Upload images to URL server with cleanup** - `2195a6e` (feat)

**Plan metadata:** (pending)

## Files Created/Modified

- `src/app/api/generate/route.ts` - Added image parameter passing and URL conversion logic

## Decisions Made

- Use `image` parameter for Replicate (most common for img2img models, future enhancement could detect from model schema)
- Use `image_url` parameter for fal.ai (consistent across all fal.ai models)
- Small images use data URIs directly for efficiency
- Gemini path unchanged (it handles base64 directly without URL conversion)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Phase 5 complete: Image URL server infrastructure fully integrated
- Ready for Phase 6: Video & Polish

---
*Phase: 05-image-url-server*
*Completed: 2026-01-09*
