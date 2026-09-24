import {
  AlignLeft,
  ArrowLeftRight,
  AudioLines,
  Box,
  Clapperboard,
  Columns2,
  Eraser,
  Expand,
  FileImage,
  FileText,
  Film,
  Funnel,
  GitBranch,
  Image,
  ImagePlus,
  Images,
  LayoutGrid,
  List,
  MessageSquareText,
  Pencil,
  Puzzle,
  Rotate3d,
  Scissors,
  Sparkles,
  Spline,
  SquareArrowOutUpRight,
  Video,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import type { NodeType } from "@/types";

/** One glyph per node type, so every menu that lists nodes shows the same icon for the same node. */
export const NODE_TYPE_ICONS: Record<NodeType, LucideIcon> = {
  imageInput: Image,
  audioInput: Volume2,
  videoInput: Video,
  annotation: Pencil,
  prompt: AlignLeft,
  array: List,
  promptConstructor: FileText,
  nanoBanana: Sparkles,
  generateVideo: Clapperboard,
  generateAudio: AudioLines,
  llmGenerate: MessageSquareText,
  splitGrid: LayoutGrid,
  output: SquareArrowOutUpRight,
  outputGallery: Images,
  imageCompare: Columns2,
  videoStitch: Film,
  easeCurve: Spline,
  videoTrim: Scissors,
  videoFrameGrab: ImagePlus,
  removeBackground: Eraser,
  imageResize: Expand,
  gifEncoder: FileImage,
  router: GitBranch,
  switch: ArrowLeftRight,
  conditionalSwitch: Funnel,
  generate3d: Box,
  glbViewer: Rotate3d,
  comfyApp: Puzzle,
};

interface NodeTypeIconProps {
  type: NodeType;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function NodeTypeIcon({ type, size = 16, strokeWidth = 1.5, className }: NodeTypeIconProps) {
  const Icon = NODE_TYPE_ICONS[type];
  return <Icon size={size} strokeWidth={strokeWidth} className={className} />;
}
