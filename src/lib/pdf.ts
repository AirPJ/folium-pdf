// Displaying PDFs (PDF.js) and building new ones (pdf-lib).
// Both run entirely inside the app; nothing is sent anywhere.

import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`;

export interface OutlineNode {
  title: string;
  /** Page index (in the source file, or in the output once mapped). */
  page: number | null;
  children: OutlineNode[];
}

interface Entry {
  bytes: Uint8Array;
  view: Promise<PDFDocumentProxy>;
  edit?: Promise<PDFDocument>;
  outline?: Promise<OutlineNode[]>;
  /** Kept in memory only, to offer re-protecting on save. */
  password?: string;
}

const registry = new Map<string, Entry>();

export class PdfOpenError extends Error {
  constructor(public kind: "password" | "invalid") {
    super(kind);
  }
}

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
    task.destroy().catch(() => {});
    if (e instanceof pdfjs.PasswordException) throw new PdfOpenError("password");
    throw new PdfOpenError("invalid");
  }
  const old = registry.get(id);
  if (old) old.view.then((d) => d.loadingTask.destroy()).catch(() => {});
  registry.set(id, { bytes, view: Promise.resolve(doc), password: old?.password });
  const sizes: { w: number; h: number }[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    sizes.push({ w: vp.width, h: vp.height });
  }
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
  const version = head.match(/%PDF-(\d\.\d)/)?.[1] ?? "";
  return { sizes, version };
}

export function rememberPassword(id: string, password: string) {
  const e = registry.get(id);
  if (e) e.password = password;
}

export function sourcePassword(id: string): string | undefined {
  return registry.get(id)?.password;
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

/** Quick check for an /Encrypt entry, before asking qpdf to be sure. */
export function mightBeEncrypted(bytes: Uint8Array): boolean {
  const needle = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  outer: for (let i = bytes.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
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

async function drawPage(
  srcId: string,
  index: number,
  rotation: number,
  scaleFor: (baseWidth: number, baseHeight: number) => number,
): Promise<HTMLCanvasElement> {
  const entry = registry.get(srcId);
  if (!entry) throw new Error("source closed");
  const doc = await entry.view;
  const page = await doc.getPage(index + 1);
  const rot = (page.rotate + rotation) % 360;
  const base = page.getViewport({ scale: 1, rotation: rot });
  const viewport = page.getViewport({ scale: scaleFor(base.width, base.height), rotation: rot });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/** Renders a page to a bitmap `cssWidth` pixels wide (times screen density). */
export function renderPage(srcId: string, index: number, rotation: number, cssWidth: number): Promise<ImageBitmap> {
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
    const canvas = await drawPage(srcId, index, rotation, (w) => px / w);
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

/** Renders a page as a PNG or JPEG file at the given resolution. */
export async function pageImageFile(
  srcId: string,
  index: number,
  rotation: number,
  dpi: number,
  format: "png" | "jpeg",
): Promise<Uint8Array> {
  const canvas = await drawPage(srcId, index, rotation, (w, h) => {
    const scale = dpi / 72;
    // Stay within what browsers can allocate for one canvas.
    return Math.min(scale, 10000 / Math.max(w, h));
  });
  const blob = await new Promise<Blob | null>((r) =>
    canvas.toBlob(r, format === "png" ? "image/png" : "image/jpeg", 0.9),
  );
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error("render failed");
  return new Uint8Array(await blob.arrayBuffer());
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

// ---------------------------------------------------------------- bookmarks

/** Reads a file's bookmarks (outline) with each entry's page index. */
export function sourceOutline(srcId: string): Promise<OutlineNode[]> {
  const entry = registry.get(srcId);
  if (!entry) return Promise.resolve([]);
  entry.outline ??= (async () => {
    const doc = await entry.view;
    const raw = await doc.getOutline();
    if (!raw) return [];
    const resolve = async (dest: unknown): Promise<number | null> => {
      try {
        const explicit = typeof dest === "string" ? await doc.getDestination(dest) : dest;
        if (!Array.isArray(explicit) || !explicit.length) return null;
        const target = explicit[0];
        if (typeof target === "number") return target;
        if (target && typeof target === "object") return await doc.getPageIndex(target);
      } catch {
        /* broken destination */
      }
      return null;
    };
    type Raw = { title: string; dest: unknown; items: Raw[] };
    const walk = async (items: Raw[]): Promise<OutlineNode[]> =>
      Promise.all(
        items.map(async (it) => ({
          title: it.title,
          page: it.dest ? await resolve(it.dest) : null,
          children: await walk(it.items ?? []),
        })),
      );
    return walk(raw as unknown as Raw[]);
  })().catch(() => []);
  return entry.outline;
}

export interface BuildPage {
  srcId: string;
  srcIndex: number;
  rotation: number;
}

/**
 * Bookmarks for a list of pages: each source's bookmarks, pointing at where
 * their pages now are. Bookmarks to removed pages are dropped (a parent is
 * kept if any of its children are). With `perFile`, each file gets a
 * top-level bookmark holding its own.
 */
export async function outlineFor(
  pages: BuildPage[],
  opts: { keep: boolean; perFile?: { srcId: string; title: string }[] },
): Promise<OutlineNode[]> {
  const first = new Map<string, number>();
  const srcOrder: string[] = [];
  pages.forEach((p, i) => {
    const k = `${p.srcId}|${p.srcIndex}`;
    if (!first.has(k)) first.set(k, i);
    if (!srcOrder.includes(p.srcId)) srcOrder.push(p.srcId);
  });
  const mapped = new Map<string, OutlineNode[]>();
  for (const srcId of srcOrder) {
    if (!opts.keep) {
      mapped.set(srcId, []);
      continue;
    }
    const map = (list: OutlineNode[]): OutlineNode[] =>
      list.flatMap((n) => {
        const children = map(n.children);
        const page = n.page === null ? undefined : first.get(`${srcId}|${n.page}`);
        if (page === undefined) return children.length ? [{ title: n.title, page: children[0].page, children }] : [];
        return [{ title: n.title, page, children }];
      });
    mapped.set(srcId, map(await sourceOutline(srcId)));
  }
  if (opts.perFile) {
    return opts.perFile
      .filter((f) => srcOrder.includes(f.srcId))
      .map((f) => ({
        title: f.title,
        page: pages.findIndex((p) => p.srcId === f.srcId),
        children: mapped.get(f.srcId) ?? [],
      }));
  }
  return srcOrder.flatMap((s) => mapped.get(s) ?? []);
}

function writeOutline(out: PDFDocument, nodes: OutlineNode[]) {
  const ctx = out.context;
  const pageRefs = out.getPages().map((p) => p.ref);
  const rootRef = ctx.nextRef();
  const build = (list: OutlineNode[], parent: PDFRef, open: boolean): { first: PDFRef; last: PDFRef; count: number } => {
    const refs = list.map(() => ctx.nextRef());
    let visible = 0;
    list.forEach((n, i) => {
      const dict = ctx.obj({
        Title: PDFHexString.fromText(n.title),
        Parent: parent,
      }) as PDFDict;
      if (n.page !== null && pageRefs[n.page]) {
        dict.set(PDFName.of("Dest"), ctx.obj([pageRefs[n.page], "XYZ", null, null, null]));
      }
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < list.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
      if (n.children.length) {
        const sub = build(n.children, refs[i], false);
        dict.set(PDFName.of("First"), sub.first);
        dict.set(PDFName.of("Last"), sub.last);
        // Negative count: the entry starts collapsed.
        dict.set(PDFName.of("Count"), PDFNumber.of(-sub.count));
      }
      ctx.assign(refs[i], dict);
      visible++;
    });
    return { first: refs[0], last: refs[refs.length - 1], count: open ? visible : list.length };
  };
  const top = build(nodes, rootRef, true);
  ctx.assign(rootRef, ctx.obj({ Type: "Outlines", First: top.first, Last: top.last, Count: top.count }));
  out.catalog.set(PDFName.of("Outlines"), rootRef);
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

export interface BuildOptions {
  title?: string;
  /** Keep the source files' bookmarks (default: true). */
  bookmarks?: boolean;
  /** Add a top-level bookmark for each file (Combine). */
  perFile?: { srcId: string; title: string }[];
}

/** Builds a new PDF from pages of one or more loaded files. */
export async function buildPdf(pages: BuildPage[], opts: BuildOptions = {}): Promise<Uint8Array> {
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

  const outline = await outlineFor(pages, { keep: opts.bookmarks !== false, perFile: opts.perFile });
  if (outline.length) {
    writeOutline(out, outline);
    out.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
  }

  // Keep the original title when the file comes from a single source.
  let title = opts.title;
  if (!title && order.size === 1) {
    try {
      title = (await editable(pages[0].srcId)).getTitle();
    } catch {
      /* ignore */
    }
  }
  if (title) out.setTitle(title);
  out.setProducer("Folium PDF");
  out.setCreator("Folium PDF");
  out.setModificationDate(new Date());
  return out.save({ useObjectStreams: true });
}

// -------------------------------------------------------------- compression

export type CompressLevel = "light" | "balanced" | "strong";

const LEVELS: Record<CompressLevel, { maxSide: number; quality: number; flate: boolean }> = {
  light: { maxSide: 3000, quality: 0.85, flate: false },
  balanced: { maxSide: 2000, quality: 0.72, flate: true },
  strong: { maxSide: 1400, quality: 0.55, flate: true },
};

function name(o: PDFObject | undefined): string | null {
  return o instanceof PDFName ? o.decodeText() : null;
}

/** Number of colour channels of an image colour space we can handle, or null. */
function channels(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | null {
  const n = name(cs);
  if (n === "DeviceGray" || n === "CalGray") return 1;
  if (n === "DeviceRGB" || n === "CalRGB") return 3;
  if (cs instanceof PDFArray && cs.size() >= 2) {
    const kind = name(cs.get(0));
    if (kind === "CalGray") return 1;
    if (kind === "CalRGB") return 3;
    if (kind === "ICCBased") {
      const profile = doc.context.lookup(cs.get(1));
      const comps = profile instanceof PDFRawStream ? profile.dict.lookup(PDFName.of("N")) : undefined;
      const k = comps instanceof PDFNumber ? comps.asNumber() : 0;
      return k === 1 ? 1 : k === 3 ? 3 : null;
    }
  }
  return null;
}

const GENERIC_FILTERS = new Set(["ASCII85Decode", "ASCIIHexDecode", "FlateDecode", "LZWDecode", "RunLengthDecode"]);

/** True if decode parameters use a PNG/TIFF predictor, which we don't undo. */
function hasPredictor(ctx: PDFDocument["context"], parms: PDFObject | undefined): boolean {
  const one = (p: PDFObject | undefined) => {
    const dict = p instanceof PDFRef ? ctx.lookup(p) : p;
    if (!(dict instanceof PDFDict)) return false;
    const pred = dict.lookup(PDFName.of("Predictor"));
    return pred instanceof PDFNumber && pred.asNumber() > 1;
  };
  if (parms instanceof PDFArray) return parms.asArray().some(one);
  return one(parms);
}

/**
 * Re-encodes large photos as smaller JPEGs. Text, vector drawings and
 * images that would not shrink are left untouched.
 */
export async function compressImages(
  bytes: Uint8Array,
  level: CompressLevel,
  onProgress?: (done: number, total: number) => void,
): Promise<{ bytes: Uint8Array; images: number }> {
  const cfg = LEVELS[level];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const N = (s: string) => PDFName.of(s);
  const images = ctx
    .enumerateIndirectObjects()
    .filter(([, o]) => o instanceof PDFRawStream && name(o.dict.lookup(N("Subtype"))) === "Image") as [
    PDFRef,
    PDFRawStream,
  ][];
  let changed = 0;
  let done = 0;
  for (const [ref, obj] of images) {
    onProgress?.(done++, images.length);
    const d = obj.dict;
    const w = (d.lookup(N("Width")) as PDFNumber | undefined)?.asNumber() ?? 0;
    const h = (d.lookup(N("Height")) as PDFNumber | undefined)?.asNumber() ?? 0;
    const bpc = (d.lookup(N("BitsPerComponent")) as PDFNumber | undefined)?.asNumber();
    if (!w || !h || bpc !== 8) continue;
    if (d.has(N("ImageMask")) || d.has(N("Decode"))) continue;
    if (d.lookup(N("Mask")) instanceof PDFArray) continue; // colour-key masks need exact colours
    const comps = channels(doc, d.lookup(N("ColorSpace")));
    if (!comps) continue;
    const f = d.lookup(N("Filter"));
    const filters = (f instanceof PDFArray ? f.asArray().map((x) => name(x)) : [name(f)]).filter(
      (x): x is string => x !== null,
    );
    // Images are often wrapped in extra encodings (ASCII85 on top of JPEG…).
    const last = filters[filters.length - 1] ?? "";
    const inner = filters.slice(0, -1);
    if (!inner.every((x) => GENERIC_FILTERS.has(x))) continue;
    if (hasPredictor(ctx, d.lookup(N("DecodeParms")))) continue;
    const decodeLayers = (fs: string[]): Uint8Array => {
      if (!fs.length) return obj.contents;
      const dict = ctx.obj({ Filter: fs }) as PDFDict;
      return decodePDFRawStream(PDFRawStream.of(dict, obj.contents)).decode();
    };

    let source: ImageBitmap | null = null;
    try {
      if (last === "DCTDecode") {
        const jpeg = decodeLayers(inner);
        source = await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
      } else if ((last === "" || GENERIC_FILTERS.has(last)) && cfg.flate && obj.contents.length > 50_000) {
        const raw = decodeLayers(filters);
        if (raw.length < w * h * comps) continue;
        const rgba = new Uint8ClampedArray(w * h * 4);
        for (let i = 0, j = 0; i < w * h; i++, j += comps) {
          rgba[i * 4] = raw[j];
          rgba[i * 4 + 1] = raw[comps === 3 ? j + 1 : j];
          rgba[i * 4 + 2] = raw[comps === 3 ? j + 2 : j];
          rgba[i * 4 + 3] = 255;
        }
        source = await createImageBitmap(new ImageData(rgba, w, h));
      }
    } catch {
      continue; // an image the browser can't decode: leave it as it is
    }
    if (!source) continue;

    const scale = Math.min(1, cfg.maxSide / Math.max(w, h));
    const nw = Math.max(1, Math.round(w * scale));
    const nh = Math.max(1, Math.round(h * scale));
    const canvas = new OffscreenCanvas(nw, nh);
    const g = canvas.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, nw, nh);
    g.drawImage(source, 0, 0, nw, nh);
    source.close();
    const jpeg = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/jpeg", quality: cfg.quality })).arrayBuffer(),
    );
    if (jpeg.length >= obj.contents.length * 0.9) continue;

    const dict = ctx.obj({
      Type: "XObject",
      Subtype: "Image",
      Width: nw,
      Height: nh,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
      Length: jpeg.length,
    }) as PDFDict;
    for (const key of ["SMask", "Mask", "Interpolate", "Intent", "OC", "Metadata"]) {
      const v = d.get(N(key));
      if (v) dict.set(N(key), v);
    }
    ctx.assign(ref, PDFRawStream.of(dict, jpeg));
    changed++;
  }
  onProgress?.(images.length, images.length);
  return { bytes: await doc.save({ useObjectStreams: true }), images: changed };
}

// ------------------------------------------------------------------- ranges

export class PageRangeError extends Error {
  constructor(
    public code: "empty" | "invalid" | "outside",
    public part = "",
  ) {
    super(code);
  }
}

/** Parses "1-3, 7, 10-" into groups of 0-based page indexes. */
export function parseRanges(text: string, pageCount: number): number[][] {
  const groups: number[][] = [];
  const parts = text.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new PageRangeError("empty");
  for (const part of parts) {
    const m = part.match(/^(\d*)\s*(?:-|–|to|à)\s*(\d*)$/i) ?? part.match(/^(\d+)$/);
    if (!m) throw new PageRangeError("invalid", part);
    const single = m.length === 2;
    const a = m[1] ? parseInt(m[1], 10) : 1;
    const b = single ? a : m[2] ? parseInt(m[2], 10) : pageCount;
    if (a < 1 || b < 1 || a > pageCount || b > pageCount) throw new PageRangeError("outside", part);
    const g: number[] = [];
    if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1);
    else for (let i = a; i >= b; i--) g.push(i - 1);
    groups.push(g);
  }
  return groups;
}
