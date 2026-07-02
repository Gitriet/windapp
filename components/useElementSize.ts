"use client";
import { useEffect, useRef, useState } from "react";

// Like useChartWidth but measures BOTH width and height, so the desktop meteogram
// can fill the remaining viewport height and redraw on resize. Returns the true
// CSS pixel box so the SVG viewBox matches (scale ~1 → text at real px size).
export function useElementSize<T extends HTMLElement>(fw = 760, fh = 320) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: fw, h: fh });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) setSize({ w: r.width, h: r.height });
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h] as const;
}
