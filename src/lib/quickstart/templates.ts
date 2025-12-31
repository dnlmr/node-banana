import { WorkflowFile } from "@/store/workflowStore";

export type ContentLevel = "empty" | "minimal" | "full";

export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  icon: string; // SVG path or emoji
  workflow: Omit<WorkflowFile, "id">;
}

// Default node dimensions for consistent layouts
const NODE_DIMENSIONS = {
  imageInput: { width: 300, height: 280 },
  annotation: { width: 300, height: 280 },
  prompt: { width: 320, height: 220 },
  nanoBanana: { width: 300, height: 300 },
  llmGenerate: { width: 320, height: 360 },
  output: { width: 320, height: 320 },
};

// Default node data factories
const createImageInputData = () => ({
  image: null,
  filename: null,
  dimensions: null,
});

const createPromptData = (prompt: string = "") => ({
  prompt,
});

const createNanoBananaData = () => ({
  inputImages: [],
  inputPrompt: null,
  outputImage: null,
  aspectRatio: "1:1" as const,
  resolution: "1K" as const,
  model: "nano-banana-pro" as const,
  useGoogleSearch: false,
  status: "idle" as const,
  error: null,
  imageHistory: [],
  selectedHistoryIndex: 0,
});

const createLLMGenerateData = () => ({
  inputPrompt: null,
  inputImages: [],
  outputText: null,
  provider: "google" as const,
  model: "gemini-3-flash-preview" as const,
  temperature: 0.7,
  maxTokens: 8192,
  status: "idle" as const,
  error: null,
});

const createAnnotationData = () => ({
  sourceImage: null,
  annotations: [],
  outputImage: null,
});

const createOutputData = () => ({
  image: null,
});

// Preset templates
export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: "simple-edit",
    name: "Simple Edit",
    description: "Basic image editing: input → generate → output",
    icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
    workflow: {
      version: 1,
      name: "Simple Edit",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 150 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 480 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 250 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 240 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1-image-image",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1-text-text",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1-image-image",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "llm-chain",
    name: "LLM Chain",
    description: "Expand a prompt with LLM, then generate",
    icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
    workflow: {
      version: 1,
      name: "LLM Chain",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 100 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 430 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "llmGenerate-1",
          type: "llmGenerate",
          position: { x: 450, y: 300 },
          data: createLLMGenerateData(),
          style: NODE_DIMENSIONS.llmGenerate,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 850, y: 200 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 1250, y: 190 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-prompt-1-llmGenerate-1-text-text",
          source: "prompt-1",
          sourceHandle: "text",
          target: "llmGenerate-1",
          targetHandle: "text",
        },
        {
          id: "edge-imageInput-1-nanoBanana-1-image-image",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-llmGenerate-1-nanoBanana-1-text-text",
          source: "llmGenerate-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1-image-image",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "contact-sheet",
    name: "Contact Sheet",
    description: "Multiple reference images for generation",
    icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z",
    workflow: {
      version: 1,
      name: "Contact Sheet",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 380 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-3",
          type: "imageInput",
          position: { x: 50, y: 710 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 450, y: 600 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 250 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 240 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1-image-image",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1-image-image",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-3-nanoBanana-1-image-image",
          source: "imageInput-3",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1-text-text",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1-image-image",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "annotate-generate",
    name: "Annotate & Generate",
    description: "Draw annotations on image, then generate",
    icon: "M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z",
    workflow: {
      version: 1,
      name: "Annotate & Generate",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 150 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "annotation-1",
          type: "annotation",
          position: { x: 450, y: 150 },
          data: createAnnotationData(),
          style: NODE_DIMENSIONS.annotation,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 450, y: 480 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 850, y: 250 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 1250, y: 240 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-annotation-1-image-image",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "annotation-1",
          targetHandle: "image",
        },
        {
          id: "edge-annotation-1-nanoBanana-1-image-image",
          source: "annotation-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1-text-text",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1-image-image",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "prompt-expansion",
    name: "Prompt Expansion",
    description: "Use LLM to expand a brief prompt",
    icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
    workflow: {
      version: 1,
      name: "Prompt Expansion",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 450, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 150 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "llmGenerate-1",
          type: "llmGenerate",
          position: { x: 50, y: 420 },
          data: createLLMGenerateData(),
          style: NODE_DIMENSIONS.llmGenerate,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 380 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 370 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-prompt-1-llmGenerate-1-text-text",
          source: "prompt-1",
          sourceHandle: "text",
          target: "llmGenerate-1",
          targetHandle: "text",
        },
        {
          id: "edge-imageInput-1-nanoBanana-1-image-image",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-llmGenerate-1-nanoBanana-1-text-text",
          source: "llmGenerate-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1-image-image",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
  {
    id: "style-transfer",
    name: "Style Transfer",
    description: "Apply style from reference to content image",
    icon: "M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01",
    workflow: {
      version: 1,
      name: "Style Transfer",
      edgeStyle: "curved",
      nodes: [
        {
          id: "imageInput-1",
          type: "imageInput",
          position: { x: 50, y: 50 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "imageInput-2",
          type: "imageInput",
          position: { x: 50, y: 380 },
          data: createImageInputData(),
          style: NODE_DIMENSIONS.imageInput,
        },
        {
          id: "prompt-1",
          type: "prompt",
          position: { x: 50, y: 710 },
          data: createPromptData(""),
          style: NODE_DIMENSIONS.prompt,
        },
        {
          id: "nanoBanana-1",
          type: "nanoBanana",
          position: { x: 450, y: 280 },
          data: createNanoBananaData(),
          style: NODE_DIMENSIONS.nanoBanana,
        },
        {
          id: "output-1",
          type: "output",
          position: { x: 850, y: 270 },
          data: createOutputData(),
          style: NODE_DIMENSIONS.output,
        },
      ],
      edges: [
        {
          id: "edge-imageInput-1-nanoBanana-1-image-image",
          source: "imageInput-1",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-imageInput-2-nanoBanana-1-image-image",
          source: "imageInput-2",
          sourceHandle: "image",
          target: "nanoBanana-1",
          targetHandle: "image",
        },
        {
          id: "edge-prompt-1-nanoBanana-1-text-text",
          source: "prompt-1",
          sourceHandle: "text",
          target: "nanoBanana-1",
          targetHandle: "text",
        },
        {
          id: "edge-nanoBanana-1-output-1-image-image",
          source: "nanoBanana-1",
          sourceHandle: "image",
          target: "output-1",
          targetHandle: "image",
        },
      ],
    },
  },
];

// Content level prompt examples
const CONTENT_EXAMPLES: Record<string, Record<ContentLevel, string>> = {
  "simple-edit": {
    empty: "",
    minimal: "Describe your edit here...",
    full: "Transform this image into a professional studio photograph with soft lighting, clean background, and enhanced details. Maintain the subject's natural appearance while improving overall image quality.",
  },
  "llm-chain": {
    empty: "",
    minimal: "Enter a brief concept for the LLM to expand...",
    full: "Take the following concept and expand it into a detailed, vivid image generation prompt with specific visual details, lighting, composition, and artistic style.",
  },
  "contact-sheet": {
    empty: "",
    minimal: "Describe how to combine these images...",
    full: "Using these reference images as style and subject guides, generate a new image that combines their best elements. Match the lighting and color palette of the first image, the composition style of the second, and incorporate elements from the third.",
  },
  "annotate-generate": {
    empty: "",
    minimal: "Describe what to generate in the annotated areas...",
    full: "Replace the areas marked with red rectangles with natural-looking content that seamlessly blends with the surrounding image. Maintain consistent lighting, perspective, and style.",
  },
  "prompt-expansion": {
    empty: "",
    minimal: "Enter a brief prompt to expand...",
    full: "You are a creative prompt engineer. Take the user's brief concept and expand it into a detailed, professional image generation prompt. Include specific details about: composition, lighting, colors, textures, mood, and artistic style. Output only the expanded prompt.",
  },
  "style-transfer": {
    empty: "",
    minimal: "Describe how to apply the style...",
    full: "Apply the artistic style, color palette, and visual aesthetic from the first reference image to the content of the second image. Preserve the subject matter and composition of the content image while transforming its visual style to match the reference.",
  },
};

/**
 * Get a preset template with content adjusted for the specified level
 */
export function getPresetTemplate(
  templateId: string,
  contentLevel: ContentLevel
): WorkflowFile {
  const template = PRESET_TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const promptContent = CONTENT_EXAMPLES[templateId]?.[contentLevel] || "";

  // Clone the workflow
  const workflow: WorkflowFile = {
    ...template.workflow,
    id: `wf_${Date.now()}_${templateId}`,
    nodes: template.workflow.nodes.map((node) => {
      if (node.type === "prompt") {
        return {
          ...node,
          data: {
            ...node.data,
            prompt: promptContent,
          },
        };
      }
      return { ...node };
    }),
    edges: template.workflow.edges.map((edge) => ({ ...edge })),
  };

  return workflow;
}

/**
 * Get all preset templates for display
 */
export function getAllPresets(): Pick<PresetTemplate, "id" | "name" | "description" | "icon">[] {
  return PRESET_TEMPLATES.map(({ id, name, description, icon }) => ({
    id,
    name,
    description,
    icon,
  }));
}
