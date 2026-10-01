import type { ModalityGuide } from "./types";

export const VIDEO_GUIDE: ModalityGuide = {
  modality: "video",
  intro:
    "A video model renders one continuous shot. Describe what happens over the clip and how the camera sees it, with motion in verbs: the model fills in everything you leave static.",
  tasks: [
    {
      id: "text-to-video",
      label: "make a clip from text",
      slots: [
        { name: "Subject", required: true, hint: "who or what, with the details that identify it" },
        { name: "Action", required: true, hint: "one main action and how it moves: direction, speed, weight (\"strides slowly toward the camera\")" },
        { name: "Setting", hint: "where and when, and what moves in the background" },
        { name: "Camera", hint: "shot size and one movement: static, slow push-in, pan left, tracking shot, handheld, drone pull-back" },
        { name: "Light and look", hint: "lighting, colour, film or animation style, frame rate feel (slow motion, time-lapse)" },
        { name: "Sound", hint: "only for models that make audio (see the model notes): dialogue in quotes with who says it, ambience, effects" },
      ],
      length: "2-4 sentences, about 40-100 words",
      example: {
        request: "a surfer at sunset",
        weak: "surfer, sunset, ocean, cinematic",
        strong:
          "A surfer in a black wetsuit paddles into a glassy wave, pops up and carves a long turn, spray glowing orange behind her. Low tracking shot from the water, the camera gliding alongside at her speed. Golden-hour backlight, warm film tones, slight slow motion.",
      },
    },
    {
      id: "image-to-video",
      label: "animate an input image",
      slots: [
        { name: "Motion", required: true, hint: "what moves in the frame and how; name the subject briefly, by what it is" },
        { name: "Camera", hint: "one movement, or \"static camera\"" },
        { name: "Change over time", hint: "light shifting, weather, something entering or leaving the frame" },
        { name: "End frame", hint: "when the model takes a last frame too: how the shot gets from the first image to the last" },
      ],
      length: "1-3 sentences",
      rules: [
        "The image is the first frame: do not re-describe its contents, style or colours, which fights the input. Describe only what moves and changes.",
      ],
      example: {
        request: "animate this product shot",
        weak: "a perfume bottle on a table, luxury, cinematic, 4k",
        strong:
          "The camera slowly orbits a quarter turn around the bottle as a thin ribbon of mist drifts past it from the left. Light glints across the glass edge at the end of the move.",
      },
    },
    {
      id: "audio-to-video",
      label: "drive a clip from audio",
      slots: [
        { name: "Performer", required: true, hint: "who is speaking or singing, and how they look" },
        { name: "Performance", required: true, hint: "expression, energy, gestures that suit the audio" },
        { name: "Framing", hint: "shot size and camera (a steady medium close-up reads lips best)" },
      ],
      length: "1-3 sentences",
      rules: ["The audio sets the timing and words: do not write dialogue into the prompt."],
      example: {
        request: "a presenter reading this",
        weak: "person talking",
        strong:
          "A woman in her thirties with short grey hair delivers the lines to camera with calm confidence, small hand gestures on key words. Medium close-up, static camera, soft studio light against a plain warm-grey wall.",
      },
    },
  ],
  rules: [
    "One shot per clip: no cuts or scene changes unless the model notes say the model makes multi-shot clips.",
    "Fit the action to the length: a 5-8 second clip holds one action, not a story.",
    "One camera movement per shot; say \"static camera\" when nothing should move.",
    "Clip length, aspect ratio and resolution are node settings, not prompt words.",
  ],
  avoid:
    "Describe the motion you want rather than what to avoid. If the node has a negative prompt input (Veo's text-1, or a model's negative_prompt), list unwanted things there as plain nouns: \"text, watermark, warping, flicker\".",
};
