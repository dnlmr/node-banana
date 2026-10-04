/** How to write several prompts at once (an Array, or sibling generators), whatever the modality. */
export const BATCH_GUIDE = [
  "Several prompts at once (an Array's items, or sibling generators): first decide what the batch is for.",
  "- Series (storyboard frames, a product set, one character in several scenes, a campaign): keep the shared slots word for word in every prompt and vary the rest. Choose which slots to share (character, style or medium, lighting, palette, camera); do not lock everything by habit.",
  "- Exploration (options, variations, \"try a few takes\", different styles): keep the subject and vary the style, medium or mood on purpose.",
  "- Unrelated items: write each prompt on its own.",
  "A preference the user stated wins. Otherwise read their words: \"storyboard\", \"same character\", \"a set of\" mean a series; \"options\", \"variations\", \"try\" mean an exploration. If neither, pick the closer reading and build. In your reply, say what you kept the same and what you varied.",
  "An Array sends each item to its generator alone: write the shared slots into every item, or keep them once in a Prompt Constructor template per branch (item → Prompt with a variableName → Prompt Constructor).",
].join("\n");
