---
phase: 04-model-search-dialog
plan: 02
subsystem: ui
tags: [react, modal, search, filtering, provider-models]

# Dependency graph
requires:
  - phase: 04-01
    provides: Provider icon buttons and model search state management
  - phase: 02-03
    provides: Unified /api/models endpoint with caching
provides:
  - Model search dialog with search, provider filter, and capability filter
  - Model selection creates GenerateImage node with model pre-configured
  - External links to model pages on Replicate/fal.ai
affects: [05-image-url-server, 06-video-polish]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Client-side search filtering for Replicate (API search unreliable)
    - Model variant suffix extraction from ID for fal.ai

key-files:
  created:
    - src/components/modals/ModelSearchDialog.tsx
  modified:
    - src/components/FloatingActionBar.tsx
    - src/store/workflowStore.ts
    - src/app/api/models/route.ts

key-decisions:
  - "Client-side search filtering for Replicate (their search API is unreliable)"
  - "Show all capability badges (txt→img, img→img, txt→vid, img→vid) to differentiate models"
  - "Extract variant suffix from fal.ai model IDs for display name"
  - "External link icon opens model page on provider website"

patterns-established:
  - "Model card layout with cover image, name, ID, badges, and description"
  - "Debounced search input (300ms)"

issues-created: [UAT-001]

# Metrics
duration: 15min
completed: 2026-01-09
---

# Phase 4 Plan 2: Model Search Dialog Summary

**Searchable model browser with provider/capability filtering, model cards showing variant info, and external links to provider pages**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-01-09T09:03:00Z
- **Completed:** 2026-01-09T09:18:56Z
- **Tasks:** 2 (+ UAT refinements)
- **Files modified:** 4

## Accomplishments

- Created ModelSearchDialog component with search, provider filter, and capability filter
- Model cards show cover image, name with variant suffix, model ID, capability badges, and description
- Clicking a model creates a GenerateImage node with the selected model pre-configured
- Fixed Replicate search by using client-side filtering (their search API was unreliable)
- Added external link icons to open model pages on Replicate/fal.ai
- Widened dialog for better viewing (max-w-5xl)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ModelSearchDialog** - `651dddf` (feat)
2. **Task 2: Fix Replicate search** - `4221225` (fix)
3. **UAT: Improve model cards** - `2fc4589` (feat)
4. **UAT: Widen dialog** - `686f624` (feat)
5. **UAT: Add external links** - `59a238a` (feat)
6. **UAT: Show variant suffix** - `81b4221` (feat)
7. **UAT: Increase ID font size** - `7ace12a` (feat)

## Files Created/Modified

- `src/components/modals/ModelSearchDialog.tsx` - New modal with search, filters, model grid
- `src/components/FloatingActionBar.tsx` - Integrated ModelSearchDialog
- `src/store/workflowStore.ts` - Added initialData parameter to addNode
- `src/app/api/models/route.ts` - Client-side search filtering for Replicate

## Decisions Made

- Replicate search API unreliable, use client-side filtering on cached model list
- Show all capability badges to differentiate similar models (text-to-image vs image-to-image)
- Extract last segment of fal.ai model ID as variant suffix (e.g., "Kling 1.6 - effects")
- External link opens model page in new tab without selecting the model

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replicate search returning no results**
- **Found during:** Task 1 execution
- **Issue:** Replicate's /v1/search endpoint returned empty results
- **Fix:** Changed to always fetch from /v1/models and filter client-side
- **Files modified:** src/app/api/models/route.ts
- **Verification:** Search now works for both providers
- **Commit:** 4221225

### UAT Refinements

Based on user acceptance testing feedback:
- Improved model cards with capability badges and model ID display
- Widened dialog from max-w-2xl to max-w-5xl
- Added external links to provider model pages
- Added variant suffix to fal.ai model names
- Increased model ID font size

## Issues Encountered

- UAT-001: Provider icons should use real logos (logged for future, not blocking)

## Next Phase Readiness

- Model search dialog fully functional
- Users can browse and select models from Replicate and fal.ai
- Ready for Phase 5: Image URL Server

---
*Phase: 04-model-search-dialog*
*Completed: 2026-01-09*
