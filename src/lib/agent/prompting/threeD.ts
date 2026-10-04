import type { ModalityGuide } from "./types";

export const THREE_D_GUIDE: ModalityGuide = {
  modality: "3d",
  intro:
    "A 3D model builds one object to use elsewhere, seen from every side. Describe the object itself, not a scene or a photograph of it.",
  tasks: [
    {
      id: "text-to-3d",
      label: "make an object from text",
      slots: [
        { name: "Object", required: true, hint: "what it is, its overall shape and proportions" },
        { name: "Parts", hint: "the main parts and how they join, including the back and the underside" },
        { name: "Materials and surface", hint: "polished brass, worn leather, matte plastic, hand-painted wood" },
        { name: "Colours", hint: "main and accent colours" },
        { name: "Style", hint: "realistic, stylised cartoon, low-poly, miniature figure" },
        { name: "Pose", hint: "characters: a neutral standing pose (A-pose or T-pose) unless the user wants another" },
      ],
      length: "1-3 sentences, about 25-60 words",
      example: {
        request: "a treasure chest",
        weak: "treasure chest in a cave, dramatic lighting, cinematic",
        strong:
          "A small wooden treasure chest with a domed lid, iron bands and corner brackets, and a heavy padlock on the front. Weathered oak with dark grain, rusted iron, slightly stylised proportions for a game asset.",
      },
    },
    {
      id: "image-to-3d",
      label: "turn an image into an object",
      slots: [
        { name: "Unseen sides", hint: "what the back and sides look like, if the image does not show them" },
        { name: "Materials", hint: "surface qualities the image does not make clear" },
      ],
      length: "1-2 sentences, or no prompt at all",
      rules: [
        "The image sets the shape: a prompt only adds what the image cannot show. Many image-to-3D models take no prompt; leave it empty when the model notes say so.",
      ],
      example: {
        request: "make this figurine 3D",
        weak: "a figurine, high quality, detailed",
        strong: "The back of the cloak hangs in the same deep folds as the front; the base is a plain round black plinth.",
      },
    },
  ],
  rules: [
    "One object, on its own: no ground, background, environment, lighting or camera words.",
    "Describe the object all the way round, not only from the front.",
  ],
  avoid: "Leave out scene words rather than negating them. If the model takes a negative prompt, list unwanted things there as plain nouns.",
};
