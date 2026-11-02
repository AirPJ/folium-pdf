import { useEffect, useRef, useState } from "react";
import { buildTextLayer, cleanCopiedText } from "../lib/pdf";

interface Props {
  srcId: string;
  index: number;
  rotation: number;
  width: number;
}

type Built = Awaited<ReturnType<typeof buildTextLayer>>;

/** All text layers on screen, so a selection can be tidied up when it ends. */
const layers = new Set<HTMLDivElement>();

function resetLayer(div: HTMLDivElement) {
  div.classList.remove("selecting");
  const end = div.querySelector<HTMLElement>(":scope > .endOfContent");
  if (end) div.append(end);
}

let listening = false;
function listenOnce() {
  if (listening) return;
  listening = true;
  const resetAll = () => layers.forEach(resetLayer);
  document.addEventListener("pointerup", resetAll);
  window.addEventListener("blur", resetAll);
  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    for (const div of layers) {
      let active = false;
      if (sel) for (let i = 0; i < sel.rangeCount && !active; i++) active = sel.getRangeAt(i).intersectsNode(div);
      if (active) div.classList.add("selecting");
      else resetLayer(div);
    }
  });
}

/** True when the user has selected some page text (so page shortcuts like Delete stay out of the way). */
export function pageTextSelected(): boolean {
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return false;
  const node = sel.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  return !!el?.isConnected && !!el.closest(".textLayer");
}

/** Selects all the text of the page whose text the user is working in. Returns false if none. */
export function selectAllPageText(): boolean {
  const sel = document.getSelection();
  const node = sel?.anchorNode;
  const el = node instanceof Element ? node : node?.parentElement;
  const layer = el?.isConnected ? el.closest(".textLayer") : null;
  if (!sel || !layer) return false;
  const range = document.createRange();
  range.selectNodeContents(layer);
  const end = layer.querySelector(":scope > .endOfContent");
  if (end) range.setEndBefore(end);
  sel.removeAllRanges();
  sel.addRange(range);
  return true;
}

/**
 * The page's text, invisible but selectable, laid exactly over the rendered page
 * so it can be selected with the mouse and copied (Ctrl+C or right-click → Copy).
 * Built when the page comes near the screen, dropped again when it is far away.
 */
export function PageText({ srcId, index, rotation, width }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const built = useRef<Built>(null);
  const [near, setNear] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), {
      rootMargin: "1200px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Build (or drop) the text when the page comes near (or leaves), or the page changes.
  useEffect(() => {
    const el = ref.current;
    if (!el || !near) return;
    let cancelled = false;
    layers.add(el);
    listenOnce();
    buildTextLayer(srcId, index, rotation, widthRef.current, el)
      .then((b) => {
        if (cancelled) b?.cancel();
        else {
          built.current = b;
          b?.resize(widthRef.current); // the zoom may have changed while building
        }
      })
      .catch(() => {
        /* cancelled, or the file was closed */
      });
    return () => {
      cancelled = true;
      built.current?.cancel();
      built.current = null;
      layers.delete(el);
      el.replaceChildren();
      el.classList.remove("selecting");
    };
  }, [near, srcId, index, rotation]);

  // Follow the zoom without rebuilding.
  useEffect(() => {
    built.current?.resize(width);
  }, [width]);

  return (
    <div
      ref={ref}
      className="textLayer"
      onMouseDown={() => ref.current?.classList.add("selecting")}
      onCopy={(e) => {
        const text = document.getSelection()?.toString() ?? "";
        if (!text) return;
        e.preventDefault();
        e.clipboardData.setData("text/plain", cleanCopiedText(text));
      }}
    />
  );
}
