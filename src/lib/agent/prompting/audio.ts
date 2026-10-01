import type { ModalityGuide } from "./types";

export const AUDIO_GUIDE: ModalityGuide = {
  modality: "audio",
  intro:
    "Audio models do one of three jobs, and each reads its prompt differently: speech reads a script, music and sound-effect models read a description. Check which one the model does.",
  tasks: [
    {
      id: "speech",
      label: "speak a script (text to speech)",
      slots: [
        { name: "Script", required: true, hint: "the exact words, written as they are spoken: numbers, dates and abbreviations spelled out (\"twenty twenty-six\", \"doctor\")" },
        { name: "Delivery", hint: "tone, pace and emotion, only where the model takes them (a style or instructions parameter, or inline tags the model notes describe)" },
      ],
      length: "the script itself; split anything over a few paragraphs across nodes",
      rules: [
        "Keep the user's script word for word when they gave one.",
        "Punctuation shapes the reading: commas and full stops for pauses, an ellipsis for a hesitation, a question mark for rising tone.",
        "The voice is a node setting (modelParameters), not prompt text.",
      ],
      example: {
        request: "a friendly welcome for our app",
        weak: "Welcome to our app, it's great, enjoy!",
        strong: "Hi, and welcome to Node Banana. Let's build your first workflow together. It only takes a minute.",
      },
    },
    {
      id: "music",
      label: "make music",
      slots: [
        { name: "Genre and era", required: true, hint: "\"nineties trip-hop\", \"baroque string quartet\"" },
        { name: "Mood", hint: "the feeling, and what it is for (ad bed, game menu, trailer build)" },
        { name: "Tempo and key", hint: "BPM, and key or mode if it matters" },
        { name: "Instruments and production", hint: "lead and rhythm instruments, sound of the mix (lo-fi, punchy, roomy)" },
        { name: "Structure", hint: "sections and length: intro, verse, build, drop, outro" },
        { name: "Vocals", hint: "none, or voice type and style; lyrics go in the model's lyrics input when it has one" },
      ],
      length: "1-3 sentences, or a short comma list if the model notes ask for tags",
      example: {
        request: "background music for a cooking video",
        weak: "happy music",
        strong:
          "Upbeat acoustic folk-pop at 110 BPM for a cooking video: plucked ukulele and nylon guitar, light hand claps and a warm upright bass, bright and unhurried. No vocals; a short intro, a looping middle section and a clean ending.",
      },
    },
    {
      id: "sound-effect",
      label: "make a sound effect",
      slots: [
        { name: "Source", required: true, hint: "what makes the sound, with its material and size (\"a heavy oak door\")" },
        { name: "Event", required: true, hint: "what happens: creaks open slowly, slams, rattles twice" },
        { name: "Space", hint: "where it is heard: small tiled bathroom, open field, distant, close-miked" },
        { name: "Texture and length", hint: "sharp or soft, dry or echoing, and roughly how long" },
      ],
      length: "1 sentence",
      rules: ["One sound event per prompt; layer separate effects with separate nodes."],
      example: {
        request: "door sound",
        weak: "door",
        strong: "A heavy oak door creaks open slowly in a stone hallway, a long low groan with a soft echo, about three seconds.",
      },
    },
  ],
  rules: ["Settings such as voice, duration and format are node settings (modelParameters), not prompt words."],
  avoid:
    "Say what should be heard rather than what should not. If the model takes a negative prompt, list unwanted sounds there as plain nouns: \"vocals, distortion, crowd noise\".",
};
