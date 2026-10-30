import { useEffect, useRef, useState } from "react";
import { renderPage } from "../lib/pdf";
import { useStore } from "../store";

interface Props {
  srcId: string;
  index: number;
  rotation: number;
  width: number;
  className?: string;
  /** Start rendering a little before the page scrolls into view. */
  margin?: string;
  alt?: string;
}

/** Height of a page drawn `width` pixels wide, with its rotation. */
export function usePageHeight(srcId: string, index: number, rotation: number, width: number): number {
  const size = useStore((s) => s.sources[srcId]?.sizes[index]);
  if (!size) return width * 1.294;
  const sideways = rotation % 180 !== 0;
  const w = sideways ? size.h : size.w;
  const h = sideways ? size.w : size.h;
  return Math.round((width * h) / w);
}

/** A PDF page, rendered lazily when it comes into view. */
export function PageImage({ srcId, index, rotation, width, className, margin = "400px", alt }: Props) {
  const height = usePageHeight(srcId, index, rotation, width);
  const ref = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      rootMargin: margin,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    renderPage(srcId, index, rotation, width)
      .then((bmp) => {
        const c = ref.current;
        if (cancelled || !c) return;
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")?.drawImage(bmp, 0, 0);
        setReady(true);
      })
      .catch(() => {
        /* file closed while rendering */
      });
    return () => {
      cancelled = true;
    };
  }, [visible, srcId, index, rotation, width]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={alt}
      className={`page-image${ready ? " is-ready" : ""}${className ? ` ${className}` : ""}`}
      style={{ width, height }}
    />
  );
}
