---
phase: 03-generate-node-refactor
plan: 02
subsystem: api
tags: [replicate, fal-ai, image-generation, multi-provider]

# Dependency graph
requires:
  - phase: 03-01
    provides: GenerateImageNode with provider/model selector, SelectedModel type
provides:
  - Replicate provider generate() implementation with polling
  - fal.ai provider generate() implementation
  - Multi-provider dispatch in /api/generate route
affects: [04-model-search-dialog, 05-image-url-server]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Provider dispatch pattern in API route via provider-specific helpers
    - Header-based API key passing (X-Replicate-API-Key, X-Fal-API-Key)
    - Replicate prediction polling pattern

key-files:
  created: []
  modified:
    - src/lib/providers/replicate.ts
    - src/lib/providers/fal.ts
    - src/app/api/generate/route.ts

key-decisions:
  - "Server-side provider execution (helpers in route.ts) rather than client-side"
  - "Header-based API key passing to avoid localStorage on server"
  - "fal.ai sync API (fal.run) instead of queue-based async"

patterns-established:
  - "Provider-specific helper functions: generateWithGemini(), generateWithReplicate(), generateWithFal()"
  - "Replicate polling with 1s interval until succeeded/failed"
  - "Multi-format fal.ai response handling (images array, image object, output string)"

issues-created: []

# Metrics
duration: 5 min
completed: 2026-01-09
---

# Phase 3 Plan 2: Provider-Specific Execution Summary

**Multi-provider dispatch in /api/generate with Replicate prediction polling and fal.ai sync API**

## Performance

- **Duration:** 5 min
- **Started:** 2026-01-09T07:29:01Z
- **Completed:** 2026-01-09T07:34:10Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- Replicate generate() implementation with version fetching and prediction polling
- fal.ai generate() implementation with sync fal.run API and multi-format response handling
- Generate API route now dispatches to correct provider based on selectedModel.provider
- Gemini logic extracted into generateWithGemini() helper for clarity

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement Replicate provider generate()** - `cbfdc9f` (feat)
2. **Task 2: Implement fal.ai provider generate()** - `d9c0ce7` (feat)
3. **Task 3: Update generate API route for multi-provider dispatch** - `ac11c6e` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/lib/providers/replicate.ts` - Added ReplicatePrediction interface and generate() with API polling
- `src/lib/providers/fal.ts` - Added FalGenerationResponse interface and generate() with sync API
- `src/app/api/generate/route.ts` - Added multi-provider dispatch and provider-specific helper functions

## Decisions Made

- Server-side provider execution in API route rather than client-side provider.generate() calls
- API keys passed via request headers (X-Replicate-API-Key, X-Fal-API-Key) to avoid localStorage access on server
- fal.ai uses sync fal.run API for simplicity (queue-based async not needed for image generation)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Provider generation working for Replicate and fal.ai
- Image inputs not yet passed to providers (requires Phase 5 URL server)
- Ready for 03-03-PLAN.md (backward compatibility for existing workflows)

---
*Phase: 03-generate-node-refactor*
*Completed: 2026-01-09*
