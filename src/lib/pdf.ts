// Displaying PDFs (PDF.js) and building new ones (pdf-lib).
// Both run entirely inside the app; nothing is sent anywhere.

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, degrees, type PDFPage } from "pdf-lib";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

interface Entry {
  bytes: Uint8Array;
  view: Promise<PDFDocumentProxy>;
  edit?: Promise<PDFDocument>;
}

const registry = new Map<string, Entry>();

export class PdfOpenError extends Error {}

/** Loads a PDF for display. Returns page sizes and the PDF version. */
export async function loadSource(
  id: string,
  bytes: Uint8Array,
): Promise<{ sizes: { w: number; h: number }[]; version: string }> {
  const task = pdfjs.getDocument({
    data: bytes.slice(), // PDF.js takes ownership of the buffer it gets
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    enableXfa: false,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    if (e instanceof pdfjs.PasswordException) {
      throw new PdfOpenError("is password protected. Opening protected files is coming in a later version.");
    }
    throw new PdfOpenError("isn't a valid PDF or is damaged.");
  }
  registry.set(id, { bytes, view: Promise.resolve(doc) });
  const sizes: { w: number; h: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ w: vp.width, h: vp.height });
  }
  let version = "";
  try {
    const head = new TextDecoder().decode(bytes.subarray(0, 16));
    version = head.match(/%PDF-(\d\.\d)/)?.[1] ?? "";
  } catch {
    /* ignore */
  }
  return { sizes, version };
}

export function unloadSource(id: string) {
  const e = registry.get(id);
  if (!e) return;
  registry.delete(id);
  e.view.then((d) => d.loadingTask.destroy()).catch(() => {});
  for (const key of [...bitmapCache.keys()]) if (key.startsWith(id + "|")) bitmapCache.delete(key);
}

export function sourceBytes(id: string): Uint8Array | undefined {
  return registry.get(id)?.bytes;
}

// ---------------------------------------------------------------- rendering

const bitmapCache = new Map<string, ImageBitmap>();
const MAX_CACHE = 400;
const inflight = new Map<string, Promise<ImageBitmap>>();

// Render a few pages at a time so scrolling stays smooth.
let running = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => queue.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

/** Renders a page to a bitmap `cssWidth` pixels wide (times screen density). */
export function renderPage(
  srcId: string,
  index: number,
  rotation: number,
  cssWidth: number,
): Promise<ImageBitmap> {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  // Round widths so nearby sizes reuse the same bitmap.
  const px = Math.max(32, Math.ceil((cssWidth * dpr) / 32) * 32);
  const key = `${srcId}|${index}|${rotation}|${px}`;
  const hit = bitmapCache.get(key);
  if (hit) {
    bitmapCache.delete(key);
    bitmapCache.set(key, hit);
    return Promise.resolve(hit);
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const job = slot(async () => {
    const entry = registry.get(srcId);
    if (!entry) throw new Error("source closed");
    const doc = await entry.view;
    const page = await doc.getPage(index + 1);
    const rot = (page.rotate + rotation) % 360;
    const base = page.getViewport({ scale: 1, rotation: rot });
    const viewport = page.getViewport({ scale: px / base.width, rotation: rot });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const bmp = await createImageBitmap(canvas);
    canvas.width = canvas.height = 0;
    bitmapCache.set(key, bmp);
    while (bitmapCache.size > MAX_CACHE) {
      const oldest = bitmapCache.keys().next().value as string;
      bitmapCache.get(oldest)?.close();
      bitmapCache.delete(oldest);
    }
    return bmp;
  }).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

// ------------------------------------------------------------------- search

const textCache = new Map<string, string>();

export async function pageText(srcId: string, index: number): Promise<string> {
  const key = `${srcId}|${index}`;
  const hit = textCache.get(key);
  if (hit !== undefined) return hit;
  const entry = registry.get(srcId);
  if (!entry) return "";
  const page = await (await entry.view).getPage(index + 1);
  const content = await page.getTextContent();
  const text = content.items
    .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : ""))
    .join("")
    .replace(/\s+/g, " ")
    .toLowerCase();
  textCache.set(key, text);
  return text;
}

// ----------------------------------------------------------------- building

function editable(srcId: string): Promise<PDFDocument> {
  const entry = registry.get(srcId);
  if (!entry) return Promise.reject(new Error("A source file was closed."));
  entry.edit ??= PDFDocument.load(entry.bytes, { updateMetadata: false }).catch((e) => {
    entry.edit = undefined;
    throw e;
  });
  return entry.edit;
}

export interface BuildPage {
  srcId: string;
  srcIndex: number;
  rotation: number;
}

/** Builds a new PDF from pages of one or more loaded files. */
export async function buildPdf(pages: BuildPage[], title?: string): Promise<Uint8Array> {
  const out = await PDFDocument.create({ updateMetadata: false });

  // Copy pages source by source; a page used twice needs two copies.
  const order = new Map<string, number[][]>();
  for (const p of pages) {
    const rounds = order.get(p.srcId) ?? [];
    let placed = false;
    for (const r of rounds) {
      if (!r.includes(p.srcIndex)) {
        r.push(p.srcIndex);
        placed = true;
        break;
      }
    }
    if (!placed) rounds.push([p.srcIndex]);
    order.set(p.srcId, rounds);
  }
  const copies = new Map<string, PDFPage[]>(); // "src|index" -> queue of copies
  for (const [srcId, rounds] of order) {
    const src = await editable(srcId);
    for (const r of rounds) {
      const copied = await out.copyPages(src, r);
      r.forEach((idx, i) => {
        const k = `${srcId}|${idx}`;
        copies.set(k, [...(copies.get(k) ?? []), copied[i]]);
      });
    }
  }
  for (const p of pages) {
    const page = copies.get(`${p.srcId}|${p.srcIndex}`)!.shift()!;
    if (p.rotation) page.setRotation(degrees((page.getRotation().angle + p.rotation) % 360));
    out.addPage(page);
  }

  if (title) out.setTitle(title);
  out.setProducer("Folium PDF");
  out.setCreator("Folium PDF");
  out.setModificationDate(new Date());
  return out.save({ useObjectStreams: true });
}

// ------------------------------------------------------------------- ranges

/**
 * Parses "1-3, 7, 10-" into 0-based page indexes (in the order written).
 * Throws an Error with a readable message if the text is invalid.
 */
export function parseRanges(text: string, pageCount: number): number[][] {
  const groups: number[][] = [];
  const parts = text.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Enter pages like 1-3, 5, 8-");
  for (const part of parts) {
    const m = part.match(/^(\d*)\s*(?:-|–|to)\s*(\d*)$/i) ?? part.match(/^(\d+)$/);
    if (!m) throw new Error(`“${part}” isn't a page or range.`);
    const single = m.length === 2;
    const a = m[1] ? parseInt(m[1], 10) : 1;
    const b = single ? a : m[2] ? parseInt(m[2], 10) : pageCount;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) {
      throw new Error(`“${part}” is outside 1–${pageCount}.`);
    }
    const g: number[] = [];
    if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1);
    else for (let i = a; i >= b; i--) g.push(i - 1);
    groups.push(g);
  }
  return groups;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
