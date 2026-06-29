"use client";
import { useEffect, useRef, useState } from "react";

// Measure a chart wrapper's CSS width so the SVG can use it as its viewBox width.
// With viewBox width === rendered width the scale is ~1, so SVG text renders at its
// true pixel size (legible on a phone) and the chart's pixel height equals its
// viewBox height. Falls back to a sensible width before the first measure (SSR).
export function useChartWidth<T extends HTMLElement>(fallback = 360) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => { const cw = el.getBoundingClientRect().width; if (cw) setW(cw); };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
