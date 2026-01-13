// Re-export all types from domain files
export * from "./annotation";
export * from "./nodes";
export * from "./providers";
export * from "./models";
export * from "./workflow";

// Import types for use in this file
import type { ProviderType, LLMProvider, LLMModelType } from "./providers";
import type { AspectRatio, Resolution, ModelType } from "./models";

// Recently used models tracking
export interface RecentModel {
  provider: ProviderType;
  modelId: string;
  displayName: string;
  timestamp: number;
}

// API Request/Response types for Image Generation
export interface GenerateRequest {
  images: string[]; // Now supports multiple images
  prompt: string;
  aspectRatio?: AspectRatio;
  resolution?: Resolution; // Only for Nano Banana Pro
  model?: ModelType;
  useGoogleSearch?: boolean; // Only for Nano Banana Pro
}

export interface GenerateResponse {
  success: boolean;
  image?: string;
  video?: string;
  videoUrl?: string;  // For large videos, return URL directly
  contentType?: "image" | "video";
  error?: string;
}

// API Request/Response types for LLM Text Generation
export interface LLMGenerateRequest {
  prompt: string;
  images?: string[];
  provider: LLMProvider;
  model: LLMModelType;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMGenerateResponse {
  success: boolean;
  text?: string;
  error?: string;
}
