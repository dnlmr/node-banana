"use client";

import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

/** Used until the scroller has been measured (and in layout-less test DOMs). */
const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 720;

export interface VirtualWindow {
  /** Inner width of the scroller. */
  width: number;
  /** Visible height of the scroller. */
  height: number;
  scrollTop: number;
}

/**
 * The scroller's size and scroll position, for virtualising the grid: size
 * from a ResizeObserver, scroll once per frame at most. `initialScrollTop`
 * puts the scroller back where it was before the first paint.
 */
export function useVirtualWindow(ref: RefObject<HTMLElement | null>, initialScrollTop = 0): VirtualWindow {
  const [size, setSize] = useState({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT });
  const [scrollTop, setScrollTop] = useState(initialScrollTop);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (initialScrollTop) el.scrollTop = initialScrollTop;
    const measure = () =>
      setSize((current) => {
        const width = el.clientWidth || current.width;
        const height = el.clientHeight || current.height;
        return width === current.width && height === current.height ? current : { width, height };
      });
    measure();
    setScrollTop(el.scrollTop);
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // The initial position applies once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);

  return { width: size.width, height: size.height, scrollTop };
}

/** The user asked for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
