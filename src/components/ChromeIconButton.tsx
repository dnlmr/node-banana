"use client";

import { forwardRef, type ReactNode } from "react";
import { Tooltip, type TooltipAlign, type TooltipPlacement } from "@/components/ui/Tooltip";
import { CHROME_ICON_BUTTON, CHROME_ICON_BUTTON_OPEN, CHROME_ICON_BUTTON_SIZE } from "./chromeStyles";

export type { TooltipAlign, TooltipPlacement };

export interface ChromeIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name; also the hover label. */
  label: string;
  shortcut?: string;
  /** Popover up, or a stateful toggle that is on. */
  open?: boolean;
  /** Suppress the hover label (while this button's own popover is up). */
  silent?: boolean;
  /** Where the hover label sits; "bottom" for buttons along the top edge. */
  tooltipPlacement?: TooltipPlacement;
  tooltipAlign?: TooltipAlign;
  badge?: ReactNode;
  size?: keyof typeof CHROME_ICON_BUTTON_SIZE;
  children: ReactNode;
}

/** Icon-only button on the chrome surface, with its hover label. */
export const ChromeIconButton = forwardRef<HTMLButtonElement, ChromeIconButtonProps>(function ChromeIconButton(
  { label, shortcut, open = false, silent = false, tooltipPlacement = "top", tooltipAlign = "center", badge, size = "md", className = "", children, ...rest },
  ref,
) {
  return (
    <div className="group relative flex">
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={`${CHROME_ICON_BUTTON} ${CHROME_ICON_BUTTON_SIZE[size]} ${open ? CHROME_ICON_BUTTON_OPEN : ""} ${className}`}
        {...rest}
      >
        {children}
      </button>
      {badge}
      {!silent && <Tooltip label={label} shortcut={shortcut} placement={tooltipPlacement} align={tooltipAlign} />}
    </div>
  );
});
