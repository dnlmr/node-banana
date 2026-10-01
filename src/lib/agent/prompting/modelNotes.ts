/**
 * What a model's own listing says about prompting it: read from its schema
 * (parameters and inputs) and its provider description, never guessed from
 * its name. A negative-prompt field, an end-frame input or a lyrics input
 * change how the prompt should be written.
 */

import type { ProviderModel } from "@/lib/providers/types";
import type { ModelSchemaLike } from "../graph/models";

const DESCRIPTION_MAX = 240;

type Field = { name: string; description?: string; type?: string };

function fields(schema: ModelSchemaLike | undefined): Field[] {
  if (!schema) return [];
  return [...schema.parameters, ...schema.inputs];
}

function find(list: Field[], pattern: RegExp): Field | undefined {
  return list.find((field) => pattern.test(field.name));
}

/** The provider's own text, flattened and cut: data for the agent, not instructions. */
function cleanDescription(text: string | null | undefined): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > DESCRIPTION_MAX ? `${flat.slice(0, DESCRIPTION_MAX - 1)}…` : flat;
}

/** Notes for prompting this model, one fact per line. Empty when the listing says nothing useful. */
export function modelPromptNotes(model: Pick<ProviderModel, "id" | "name" | "provider" | "description">, schema: ModelSchemaLike | undefined): string[] {
  const notes: string[] = [];
  const all = fields(schema);
  const inputs = schema?.inputs ?? [];

  const negative = find(all, /negative/i);
  if (negative) notes.push(`Takes a negative prompt (${negative.name}): list unwanted things there as plain nouns, and keep "no …" out of the main prompt.`);

  const endFrame = inputs.find((input) => input.type === "image" && /tail|end|last/i.test(input.name));
  if (endFrame) notes.push(`Takes an end frame (${endFrame.name}): when it is connected, describe how the shot moves from the first image to the last.`);

  const images = inputs.filter((input) => input.type === "image" && input !== endFrame);
  if (images.some((input) => input.isArray) || images.length > 1) {
    notes.push("Takes several reference images: say what to take from each, naming it by its content.");
  }

  const lyrics = find(all, /lyric/i);
  if (lyrics) notes.push(`Lyrics go in ${lyrics.name}, not in the prompt; the prompt describes the music.`);

  const audioSwitch = find(schema?.parameters ?? [], /^(generate_audio|with_audio|enable_audio|audio)$/i);
  if (audioSwitch) notes.push(`Can make sound with the video (${audioSwitch.name}): when it is on, add dialogue in quotes, ambience and effects.`);

  const voice = find(schema?.parameters ?? [], /voice|speaker/i);
  if (voice) notes.push(`The voice is chosen in ${voice.name} (modelParameters), not in the prompt.`);

  const delivery = find(all, /^(style|instructions?|emotion)$/i);
  if (delivery) notes.push(`Delivery notes (tone, pace, emotion) go in ${delivery.name}, not in the script.`);

  const duration = find(schema?.parameters ?? [], /duration|seconds|length/i);
  if (duration) notes.push(`Length is set by ${duration.name} (modelParameters): fit the action or piece to it.`);

  if (schema && !inputs.some((input) => input.type === "text")) {
    notes.push("Takes no prompt: leave the text input unconnected.");
  }

  const prompt = inputs.find((input) => input.type === "text" && /prompt|text/i.test(input.name));
  if (prompt?.description && /\d/.test(prompt.description)) {
    notes.push(`Its prompt input says: ${JSON.stringify(cleanDescription(prompt.description))}`);
  }

  if (model.provider === "gemini" && /^nano-banana/.test(model.id)) {
    notes.push("Gemini image models read full descriptive sentences, and take edits phrased as plain instructions (\"change the jacket to red, keep everything else\").");
  }

  const description = cleanDescription(model.description);
  if (description) notes.push(`The provider describes it as: ${JSON.stringify(description)}`);
  return notes;
}

/** Which audio task a model does, from its name, description and fields; undefined when it does not say. */
export function audioTaskOf(model: Pick<ProviderModel, "id" | "name" | "description"> | undefined, schema: ModelSchemaLike | undefined): string | undefined {
  const text = `${model?.id ?? ""} ${model?.name ?? ""} ${model?.description ?? ""} ${fields(schema).map((f) => f.name).join(" ")}`.toLowerCase();
  if (/\b(tts|text[- ]to[- ]speech|speech|voice|speaker)\b/.test(text)) return "speech";
  if (/\b(music|song|lyric|melody|instrumental)/.test(text)) return "music";
  if (/\b(sfx|sound[- ]effects?|foley)\b/.test(text)) return "sound-effect";
  return undefined;
}
