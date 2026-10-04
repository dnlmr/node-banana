import React from "react";
import { cn } from "./cn";
import { LoaderCircle } from "lucide-react";

/** The one spinner. `size` in px. */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <LoaderCircle
      size={size}
      strokeWidth={3}
      className={cn("animate-spin", className)}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Translucent overlay with a spinner, for media that is being replaced. */
export function LoadingOverlay({ size = 24, dim = "strong" }: { size?: number; dim?: "strong" | "light" }) {
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center justify-center",
        dim === "strong" ? "bg-neutral-900/70" : "bg-neutral-900/50"
      )}
    >
      <Spinner size={size} className="text-white" />
    </div>
  );
}
