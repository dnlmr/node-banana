import type { ModalityGuide } from "./types";

export const IMAGE_GUIDE: ModalityGuide = {
  modality: "image",
  intro:
    "An image model draws one picture from a description. Write it as plain sentences, the most important thing first, with details a camera or a painter could act on.",
  tasks: [
    {
      id: "generate",
      label: "make an image from text",
      slots: [
        { name: "Subject", required: true, hint: "who or what, with the details that make it this one (age, build, clothing, material, breed, colour)" },
        { name: "Action or pose", hint: "what the subject is doing, or how it is placed" },
        { name: "Setting", hint: "where, and when (place, era, season, time of day)" },
        { name: "Composition", hint: "shot size, angle and framing: close-up, wide shot, low angle, centred, rule of thirds, lens (35mm, macro)" },
        { name: "Lighting", hint: "source, quality and direction: soft window light, hard noon sun, neon rim light, golden hour" },
        { name: "Style or medium", hint: "photo, film stock, watercolour, 3D render, flat vector, an art movement" },
        { name: "Mood and palette", hint: "the feeling and the main colours" },
      ],
      length: "1-3 sentences, about 30-80 words",
      example: {
        request: "a cat in a café",
        weak: "cat in a cafe, cute, high quality, 8k",
        strong:
          "A ginger tabby curled up on a worn velvet armchair by the window of a small Parisian café, morning light falling across the marble tables behind it. Close-up at eye level, shallow depth of field, shot on 35mm film in soft, warm tones.",
      },
    },
    {
      id: "edit",
      label: "change one input image",
      slots: [
        { name: "Change", required: true, hint: "what to change, described as the result you want (\"make the jacket deep red leather\")" },
        { name: "Keep", required: true, hint: "what must stay as it is: the person's face and identity, pose, background, framing, lighting" },
        { name: "Blend", hint: "how the change should sit in the image: matching light, shadows, perspective" },
      ],
      length: "1-2 sentences",
      rules: [
        "Refer to things by what they are in the image (\"the woman on the left\", \"the mug\"), not by position numbers you cannot see.",
        "Ask for one or two changes per edit; chain several edit nodes for more.",
        "Do not re-describe the whole image: only the change and what to keep.",
      ],
      example: {
        request: "make it night",
        weak: "night time",
        strong:
          "Turn the scene into a clear night: dark blue sky with a few stars, warm light glowing from the café windows, wet pavement reflecting it. Keep the building, the people and the camera angle exactly as they are.",
      },
    },
    {
      id: "compose",
      label: "combine several reference images",
      slots: [
        { name: "Role of each image", required: true, hint: "what to take from each, named by its content (\"the jacket from the product shot\", \"the woman from the portrait\")" },
        { name: "Scene", required: true, hint: "the picture they make together: setting, pose, composition" },
        { name: "Consistency", hint: "what must match its reference exactly (face, logo, product shape) and how light and scale should unify" },
      ],
      length: "2-3 sentences",
      example: {
        request: "put her in the jacket",
        weak: "woman wearing the jacket",
        strong:
          "Dress the woman from the portrait in the quilted green jacket from the product photo, zipped halfway. Keep her face, hair and expression unchanged and the jacket's stitching and logo exact; place her on a misty forest trail in soft overcast light.",
      },
    },
  ],
  rules: [
    "Name concrete, visible things. Skip filler such as \"stunning, masterpiece, 8k, best quality\" unless the model notes ask for tag-style prompts.",
    "Text in the image: put the exact words in quotes and say where they go and how they look (\"the sign reads 'OPEN' in hand-painted white letters\").",
    "Say counts and positions outright (\"two cups, left of the laptop\").",
    "One picture per prompt: no lists of alternatives, panels or sequences unless the user asked for a grid or a sheet.",
    "Aspect ratio and resolution are node settings, not prompt words.",
  ],
  avoid:
    "Describe what should be there instead of what should not (\"an empty beach\", not \"no people\"). If the model takes a negative prompt (see the model notes), list unwanted things there as plain nouns: \"blur, text, watermark, extra fingers\".",
};
