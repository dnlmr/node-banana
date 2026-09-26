// What main asks when the page blocks its own unload (will-prevent-unload).
// The page blocks both for workflow tabs with unsaved changes and for
// generations still being saved to the asset library (src/app/page.tsx), and
// main cannot tell which, so the wording names both: a user who has just saved
// must not read it as "your workflows are unsaved" and discard a generation
// that is still on its way to the library.
const UNLOAD_PROMPT = Object.freeze({
  type: 'question',
  buttons: Object.freeze(['Keep open', 'Discard and close']),
  defaultId: 0,
  cancelId: 0,
  message: 'Node Banana is still saving your work',
  detail: 'A workflow has unsaved changes, or a generation is still being saved to your library. If you close now, that work is lost.',
});

module.exports = { UNLOAD_PROMPT };
