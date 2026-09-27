import { Dropdown } from "@/components/nodes/ui/Dropdown";
import React, { useState, useEffect, useCallback } from 'react';

import { Dialog, DialogButton, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { X } from "lucide-react";

const FONT_SIZE_STORAGE_KEY = 'prompt-editor-font-size';
const DEFAULT_FONT_SIZE = 14;
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 24;
const FONT_SIZE_OPTIONS = [10, 12, 14, 16, 18, 20, 24];

interface PromptEditorModalProps {
  isOpen: boolean;
  initialPrompt: string;
  onSubmit: (prompt: string) => void;
  onClose: () => void;
}

export const PromptEditorModal: React.FC<PromptEditorModalProps> = ({
  isOpen,
  initialPrompt,
  onSubmit,
  onClose,
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [fontSize, setFontSize] = useState(() => {
    // Load font size from localStorage on mount
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= MIN_FONT_SIZE && parsed <= MAX_FONT_SIZE) {
          return parsed;
        }
      }
    }
    return DEFAULT_FONT_SIZE;
  });

  // Update local state when initial prompt changes
  useEffect(() => {
    setPrompt(initialPrompt);
  }, [initialPrompt]);

  // Save font size to localStorage when it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, fontSize.toString());
    }
  }, [fontSize]);

  // Track unsaved changes
  const hasUnsavedChanges = prompt !== initialPrompt;

  // Handle close attempt - show confirmation if there are unsaved changes
  const handleAttemptClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowConfirmation(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, onClose]);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleAttemptClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleAttemptClose]);

  const handleSubmit = useCallback(() => {
    onSubmit(prompt);
    onClose();
  }, [prompt, onSubmit, onClose]);

  const handleFontSizeChange = useCallback((next: string) => {
    setFontSize(parseInt(next, 10));
  }, []);

  const handleDismissConfirmation = useCallback(() => {
    setShowConfirmation(false);
  }, []);

  const handleConfirmationBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only dismiss if clicking the backdrop itself, not the confirmation dialog
      if (e.target === e.currentTarget) {
        handleDismissConfirmation();
      }
    },
    [handleDismissConfirmation]
  );

  return (
    <Dialog
      open={isOpen}
      onClose={handleAttemptClose}
      closeOnEscape={false}
      size="lg"
      className="h-[85vh]"
    >
        <DialogHeader closeButton={false}>
          <DialogTitle>Edit Prompt</DialogTitle>
        </DialogHeader>

        {/* Box containing toolbar and textarea */}
        <div className="mx-5 flex-1 flex flex-col border border-chrome-border rounded-well bg-well overflow-hidden">
          {/* Toolbar - header of the box */}
          <div className="h-10 bg-canvas-bg border-b border-chrome-border flex items-center px-3 gap-3 shrink-0">
            {/* Font Size Control */}
            <Dropdown
              value={String(fontSize)}
              options={FONT_SIZE_OPTIONS.map((size) => ({ value: String(size), label: `${size}px` }))}
              onChange={handleFontSizeChange}
              size="dialog"
              aria-label="Font size"
              className="w-[88px]"
              triggerClassName="h-[26px] w-full px-2 rounded-md border border-chrome-border bg-well text-xs text-neutral-300 text-left flex items-center justify-between gap-2 outline-none focus:ring-1 focus:ring-neutral-600 cursor-pointer"
            />
          </div>

          {/* Textarea */}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what to generate..."
            className="nodrag nopan nowheel flex-1 w-full p-6 leading-relaxed text-neutral-100 bg-transparent border-0 resize-none focus:outline-none placeholder:text-neutral-500"
            style={{ fontSize: `${fontSize}px` }}
            autoFocus
          />
        </div>

        {/* Footer with buttons */}
        <DialogFooter className="mt-3">
          <DialogButton variant="ghost" onClick={handleAttemptClose}>
            Cancel
          </DialogButton>
          <DialogButton variant="primary" onClick={handleSubmit}>
            Submit
          </DialogButton>
        </DialogFooter>

        {/* Confirmation overlay */}
        {showConfirmation && (
          <div
            className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-card"
            onClick={handleConfirmationBackdropClick}
          >
            <div className="relative bg-card border border-chrome-border rounded-card p-5 mx-4 max-w-sm shadow-dialog">
              {/* Close button */}
              <button
                onClick={handleDismissConfirmation}
                className="absolute top-3 right-3 text-neutral-400 hover:text-neutral-200 transition-colors focus:outline-none"
                aria-label="Close"
              >
                <X size={20} strokeWidth={2} />
              </button>

              <p className="text-neutral-100 text-[13px] text-center mb-5">
                You have unsaved changes
              </p>
              <div className="flex justify-center gap-3">
                <DialogButton variant="danger" onClick={onClose}>
                  Discard
                </DialogButton>
                <DialogButton variant="primary" onClick={handleSubmit}>
                  Submit
                </DialogButton>
              </div>
            </div>
          </div>
        )}
    </Dialog>
  );
};
