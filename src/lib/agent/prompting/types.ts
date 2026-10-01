/**
 * The shape every prompting guide shares, so get_prompt_guide renders them
 * alike and tests can check each one the same way.
 */

export type PromptModality = "image" | "video" | "audio" | "3d" | "text";

/** One part of a good prompt, in the order a prompt should give them. */
export interface PromptSlot {
  name: string;
  required?: boolean;
  hint: string;
}

export interface PromptExample {
  request: string;
  weak: string;
  strong: string;
}

/** One kind of job a node does (from text, edit an image, music…), with its own slots. */
export interface PromptTask {
  id: string;
  /** Short, for the list of other tasks: "edit an image". */
  label: string;
  slots: PromptSlot[];
  /** A target, e.g. "1-3 sentences, about 30-80 words". */
  length: string;
  /** Rules for this task only; the guide's own rules apply too. */
  rules?: string[];
  example: PromptExample;
}

export interface ModalityGuide {
  modality: PromptModality;
  /** One or two sentences on how models of this kind read a prompt. */
  intro: string;
  /** The first task is the default. */
  tasks: PromptTask[];
  /** Rules for every task of this modality. */
  rules: string[];
  /** How to say what to leave out. */
  avoid: string;
}
