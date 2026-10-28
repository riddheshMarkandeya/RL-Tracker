// An element's content width, kept current as it resizes; 0 before the first measure, when callers
// draw nothing rather than a chart at the wrong size.
import { useLayoutEffect, useRef, useState } from "react";

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Floored, so the drawing never comes out a fraction wider than its box.
    const fit = () => { setWidth(Math.floor(el.getBoundingClientRect().width)); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);
  return { ref, width };
}
