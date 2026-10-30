// Everything the user can do, as plain functions over the store.

import { getState, setState, uid, type Doc, type Mode, type PageRef, type Theme } from "./store";
import { buildPdf, formatBytes, loadSource, pageText, parseRanges, PdfOpenError, unloadSource } from "./lib/pdf";
import {
  baseName,
  joinPath,
  pickFolder,
  pickPdfs,
  pickSavePath,
  readPath,
  writePath,
  type PickedFile,
} from "./lib/platform";

// ------------------------------------------------------------------ toasts

export function toast(text: string, kind: "info" | "success" | "error" = "info") {
  const id = uid();
  setState((s) => ({ ...s, toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => dismissToast(id), kind === "error" ? 7000 : 3500);
}

export function dismissToast(id: string) {
  setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) }));
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

// ----------------------------------------------------------------- loading

/** Loads files into memory. Returns the ids of the ones that opened. */
async function addSources(files: PickedFile[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    const id = uid();
    try {
      const { sizes, version } = await loadSource(id, f.bytes);
      setState((s) => ({
        ...s,
        sources: {
          ...s.sources,
          [id]: { id, name: f.name, path: f.path, size: f.bytes.length, sizes, version },
        },
      }));
      ids.push(id);
      if (f.path) rememberRecent(f.path);
    } catch (e) {
      toast(e instanceof PdfOpenError ? `“${f.name}” ${e.message}` : `Could not open “${f.name}”.`, "error");
    }
  }
  return ids;
}

function allPages(srcId: string): PageRef[] {
  const meta = getState().sources[srcId];
  return meta.sizes.map((_, i) => ({ key: uid(), srcId, srcIndex: i, rotation: 0 }));
}

function newDoc(srcId: string): Doc {
  const meta = getState().sources[srcId];
  const pages = allPages(srcId);
  return {
    id: uid(),
    name: meta.name,
    path: meta.path,
    primarySrc: srcId,
    pages,
    past: [],
    future: [],
    dirty: false,
    current: 0,
    selection: [],
    anchor: null,
  };
}

/** Opens files as tabs (or adds them to Combine when in Combine mode). */
export async function openFiles(files: PickedFile[]) {
  if (!files.length) return;
  const st = getState();
  // Already open? Just switch to it.
  const fresh = files.filter((f) => {
    if (!f.path) return true;
    const existing = st.docs.find((d) => d.path === f.path);
    if (existing && st.mode !== "combine") {
      activate(existing.id);
      return false;
    }
    return true;
  });
  if (!fresh.length) return;
  setState((s) => ({ ...s, busy: fresh.length > 1 ? `Opening ${fresh.length} files…` : `Opening ${fresh[0].name}…` }));
  try {
    const ids = await addSources(fresh);
    if (getState().mode === "combine") {
      addToCombine(ids);
      return;
    }
    const docs = ids.map(newDoc);
    if (!docs.length) return;
    setState((s) => ({ ...s, docs: [...s.docs, ...docs], activeId: docs[docs.length - 1].id }));
  } finally {
    setState((s) => ({ ...s, busy: null }));
  }
}

export async function openDialog() {
  try {
    await openFiles(await pickPdfs(true));
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export async function openPaths(paths: string[]) {
  const files: PickedFile[] = [];
  for (const p of paths) {
    try {
      files.push(await readPath(p));
    } catch (e) {
      toast(errorText(e), "error");
      forgetRecent(p);
    }
  }
  await openFiles(files);
}

// ------------------------------------------------------------------ recent

export interface Recent {
  path: string;
  name: string;
  at: number;
}

export function recentFiles(): Recent[] {
  try {
    return JSON.parse(localStorage.getItem("folium.recent") ?? "[]") as Recent[];
  } catch {
    return [];
  }
}

function rememberRecent(path: string) {
  const list = [{ path, name: baseName(path), at: Date.now() }, ...recentFiles().filter((r) => r.path !== path)];
  try {
    localStorage.setItem("folium.recent", JSON.stringify(list.slice(0, 12)));
  } catch {
    /* ignore */
  }
}

function forgetRecent(path: string) {
  try {
    localStorage.setItem("folium.recent", JSON.stringify(recentFiles().filter((r) => r.path !== path)));
  } catch {
    /* ignore */
  }
}

// -------------------------------------------------------------------- tabs

export function activate(id: string) {
  setState((s) => ({ ...s, activeId: id, mode: s.mode === "combine" ? "read" : s.mode }));
}

export function setMode(mode: Mode) {
  setState((s) => ({ ...s, mode }));
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem("folium.theme", theme);
  } catch {
    /* ignore */
  }
  setState((s) => ({ ...s, theme }));
}

function askUnsaved(docId: string): Promise<"save" | "discard" | "cancel"> {
  return new Promise((resolve) => {
    setState((s) => ({ ...s, activeId: docId, dialog: { type: "unsaved", docId, resolve } }));
  });
}

export function closeDialog() {
  setState((s) => ({ ...s, dialog: null }));
}

/** Closes a tab, asking about unsaved changes. Returns false if cancelled. */
export async function closeDoc(id: string): Promise<boolean> {
  const doc = getState().docs.find((d) => d.id === id);
  if (!doc) return true;
  if (doc.dirty) {
    const answer = await askUnsaved(id);
    closeDialog();
    if (answer === "cancel") return false;
    if (answer === "save" && !(await save(id))) return false;
  }
  setState((s) => {
    const idx = s.docs.findIndex((d) => d.id === id);
    const docs = s.docs.filter((d) => d.id !== id);
    const activeId = s.activeId === id ? (docs[Math.min(idx, docs.length - 1)]?.id ?? null) : s.activeId;
    return { ...s, docs, activeId };
  });
  collectSources();
  return true;
}

/** Called when the window is about to close. */
export async function confirmQuit(): Promise<boolean> {
  for (const d of getState().docs.filter((x) => x.dirty)) {
    if (!(await closeDoc(d.id))) return false;
  }
  return true;
}

/** Frees files no longer used by any tab or by Combine. */
function collectSources() {
  const s = getState();
  const used = new Set<string>();
  s.docs.forEach((d) => d.pages.forEach((p) => used.add(p.srcId)));
  s.docs.forEach((d) => d.past.forEach((h) => h.forEach((p) => used.add(p.srcId))));
  s.docs.forEach((d) => d.future.forEach((h) => h.forEach((p) => used.add(p.srcId))));
  s.combine.items.forEach((i) => used.add(i.srcId));
  const unused = Object.keys(s.sources).filter((id) => !used.has(id));
  if (!unused.length) return;
  unused.forEach(unloadSource);
  setState((st) => {
    const sources = { ...st.sources };
    unused.forEach((id) => delete sources[id]);
    return { ...st, sources };
  });
}

// ------------------------------------------------------------------- edits

function updateDoc(id: string, fn: (d: Doc) => Doc) {
  setState((s) => ({ ...s, docs: s.docs.map((d) => (d.id === id ? fn(d) : d)) }));
}

/** Applies an edit to the page list, with undo. */
export function editPages(id: string, fn: (pages: PageRef[]) => PageRef[], selection?: string[]) {
  updateDoc(id, (d) => {
    const pages = fn(d.pages);
    if (pages === d.pages) return d;
    const sel = (selection ?? d.selection).filter((k) => pages.some((p) => p.key === k));
    return {
      ...d,
      pages,
      past: [...d.past.slice(-99), d.pages],
      future: [],
      dirty: true,
      selection: sel,
      current: Math.min(d.current, Math.max(0, pages.length - 1)),
    };
  });
}

export function undo(id: string) {
  updateDoc(id, (d) => {
    if (!d.past.length) return d;
    const pages = d.past[d.past.length - 1];
    return {
      ...d,
      pages,
      past: d.past.slice(0, -1),
      future: [d.pages, ...d.future],
      dirty: true,
      selection: d.selection.filter((k) => pages.some((p) => p.key === k)),
      current: Math.min(d.current, pages.length - 1),
    };
  });
}

export function redo(id: string) {
  updateDoc(id, (d) => {
    if (!d.future.length) return d;
    const pages = d.future[0];
    return {
      ...d,
      pages,
      past: [...d.past, d.pages],
      future: d.future.slice(1),
      dirty: true,
      selection: d.selection.filter((k) => pages.some((p) => p.key === k)),
      current: Math.min(d.current, pages.length - 1),
    };
  });
}

export function setCurrent(id: string, index: number) {
  updateDoc(id, (d) => (d.current === index ? d : { ...d, current: index }));
}

/** Click, Ctrl+click and Shift+click selection. */
export function selectPage(id: string, key: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  updateDoc(id, (d) => {
    const keys = d.pages.map((p) => p.key);
    if (e.shiftKey && d.anchor && keys.includes(d.anchor)) {
      const a = keys.indexOf(d.anchor);
      const b = keys.indexOf(key);
      const range = keys.slice(Math.min(a, b), Math.max(a, b) + 1);
      const sel = e.ctrlKey || e.metaKey ? [...new Set([...d.selection, ...range])] : range;
      return { ...d, selection: sel };
    }
    if (e.ctrlKey || e.metaKey) {
      const sel = d.selection.includes(key) ? d.selection.filter((k) => k !== key) : [...d.selection, key];
      return { ...d, selection: sel, anchor: key };
    }
    return { ...d, selection: [key], anchor: key, current: keys.indexOf(key) };
  });
}

export function setSelection(id: string, keys: string[]) {
  updateDoc(id, (d) => ({ ...d, selection: keys, anchor: keys[0] ?? null }));
}

export function selectAll(id: string) {
  updateDoc(id, (d) => ({ ...d, selection: d.pages.map((p) => p.key) }));
}

/** The pages an action applies to: the selection, or the current page. */
export function targetKeys(d: Doc): string[] {
  if (d.selection.length) return d.selection;
  const p = d.pages[d.current];
  return p ? [p.key] : [];
}

export function rotate(id: string, by: 90 | -90) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d) return;
  const keys = new Set(targetKeys(d));
  editPages(id, (pages) =>
    pages.map((p) => (keys.has(p.key) ? { ...p, rotation: (p.rotation + by + 360) % 360 } : p)),
  );
}

export function deletePages(id: string) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d) return;
  const keys = new Set(targetKeys(d));
  if (keys.size >= d.pages.length) {
    toast("A PDF needs at least one page. Close the tab instead to discard it.", "error");
    return;
  }
  editPages(id, (pages) => pages.filter((p) => !keys.has(p.key)), []);
  toast(keys.size === 1 ? "Page deleted. Ctrl+Z to undo." : `${keys.size} pages deleted. Ctrl+Z to undo.`);
}

export function duplicatePages(id: string) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d) return;
  const keys = new Set(targetKeys(d));
  const added: string[] = [];
  editPages(id, (pages) =>
    pages.flatMap((p) => {
      if (!keys.has(p.key)) return [p];
      const copy = { ...p, key: uid() };
      added.push(copy.key);
      return [p, copy];
    }),
  );
  setSelection(id, added);
}

export function movePages(id: string, activeKey: string, overKey: string) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d || activeKey === overKey) return;
  const moving = d.selection.includes(activeKey) ? d.selection : [activeKey];
  const movingSet = new Set(moving);
  editPages(id, (pages) => {
    const from = pages.findIndex((p) => p.key === activeKey);
    const to = pages.findIndex((p) => p.key === overKey);
    const block = pages.filter((p) => movingSet.has(p.key));
    const rest = pages.filter((p) => !movingSet.has(p.key));
    let insertAt = rest.findIndex((p) => p.key === overKey);
    if (insertAt === -1) return pages;
    if (to > from) insertAt += 1;
    return [...rest.slice(0, insertAt), ...block, ...rest.slice(insertAt)];
  });
}

/** Adds pages from other PDFs at the end of the current document. */
export async function insertFiles(id: string) {
  const files = await pickPdfs(true);
  const ids = await addSources(files);
  if (!ids.length) return;
  editPages(id, (pages) => [...pages, ...ids.flatMap(allPages)]);
  toast(`Added ${ids.length === 1 ? "1 file" : `${ids.length} files`} at the end.`, "success");
}

export function selectRange(id: string, text: string): string | null {
  const d = getState().docs.find((x) => x.id === id);
  if (!d) return null;
  try {
    const idx = parseRanges(text, d.pages.length).flat();
    setSelection(id, [...new Set(idx)].map((i) => d.pages[i].key));
    return null;
  } catch (e) {
    return errorText(e);
  }
}

// ------------------------------------------------------------------ saving

function stem(name: string) {
  return name.replace(/\.pdf$/i, "");
}

function toBuild(pages: PageRef[]) {
  return pages.map((p) => ({ srcId: p.srcId, srcIndex: p.srcIndex, rotation: p.rotation }));
}

/** Writes a doc to disk. `saveAs` always asks for a location. */
export async function save(id: string, saveAs = false): Promise<boolean> {
  const d = getState().docs.find((x) => x.id === id);
  if (!d) return false;
  let path = d.path;
  if (saveAs || !path) {
    path = await pickSavePath(saveAs ? `${stem(d.name)} (edited).pdf` : d.name);
    if (!path) return false;
  }
  setState((s) => ({ ...s, busy: "Saving…" }));
  try {
    const bytes = await buildPdf(toBuild(d.pages));
    await writePath(path, bytes);
    // Reload from what was written, so later edits start from the saved file.
    const [srcId] = await addSources([{ name: baseName(path), path, bytes }]);
    if (srcId) {
      updateDoc(id, (doc) => ({
        ...doc,
        name: baseName(path!),
        path,
        primarySrc: srcId,
        pages: allPages(srcId),
        past: [],
        future: [],
        dirty: false,
        selection: [],
        current: Math.min(doc.current, getState().sources[srcId].sizes.length - 1),
      }));
      collectSources();
    }
    toast(`Saved “${baseName(path)}” (${formatBytes(bytes.length)}).`, "success");
    return true;
  } catch (e) {
    toast(`Could not save: ${errorText(e)}`, "error");
    return false;
  } finally {
    setState((s) => ({ ...s, busy: null }));
  }
}

/** Saves the selected pages (or the current page) as a new PDF. */
export async function extract(id: string) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d) return;
  const keys = new Set(targetKeys(d));
  const pages = d.pages.filter((p) => keys.has(p.key));
  if (!pages.length) return;
  const label = pages.length === 1 ? `page ${d.pages.indexOf(pages[0]) + 1}` : `${pages.length} pages`;
  const path = await pickSavePath(`${stem(d.name)} - ${label}.pdf`);
  if (!path) return;
  setState((s) => ({ ...s, busy: "Extracting…" }));
  try {
    const bytes = await buildPdf(toBuild(pages));
    await writePath(path, bytes);
    toast(`Extracted ${label} to “${baseName(path)}”.`, "success");
  } catch (e) {
    toast(`Could not extract: ${errorText(e)}`, "error");
  } finally {
    setState((s) => ({ ...s, busy: null }));
  }
}

/** Splits a doc into several files written to a folder. */
export async function split(id: string, groups: number[][]) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d || !groups.length) return;
  const folder = await pickFolder();
  if (folder === null) return;
  setState((s) => ({ ...s, busy: `Splitting into ${groups.length} files…` }));
  try {
    const width = String(groups.length).length;
    for (let i = 0; i < groups.length; i++) {
      const bytes = await buildPdf(toBuild(groups[i].map((idx) => d.pages[idx])));
      const name = `${stem(d.name)} - part ${String(i + 1).padStart(width, "0")}.pdf`;
      await writePath(joinPath(folder, name), bytes);
    }
    toast(`Created ${groups.length} files.`, "success");
  } catch (e) {
    toast(`Could not split: ${errorText(e)}`, "error");
  } finally {
    setState((s) => ({ ...s, busy: null }));
  }
}

export function openDialogFor(type: "split" | "range", docId: string) {
  setState((s) => ({ ...s, dialog: { type, docId } }));
}

// ----------------------------------------------------------------- combine

export function addToCombine(srcIds: string[]) {
  setState((s) => ({
    ...s,
    mode: "combine",
    combine: {
      ...s.combine,
      items: [...s.combine.items, ...srcIds.map((srcId) => ({ id: uid(), srcId, included: true, skipped: [] }))],
    },
  }));
}

/** Enters Combine with the open tabs' files (or the given doc first). */
export function startCombine(fromDocId?: string) {
  const s = getState();
  if (!s.combine.items.length) {
    const docs = fromDocId ? s.docs.filter((d) => d.id === fromDocId) : s.docs;
    const srcIds = [...new Set(docs.map((d) => d.primarySrc))];
    if (srcIds.length) {
      const first = s.sources[srcIds[0]];
      setState((st) => ({
        ...st,
        combine: { ...st.combine, outputName: `${stem(first.name)} - combined.pdf` },
      }));
    }
    addToCombine(srcIds);
  }
  setMode("combine");
}

export async function combineAddFiles() {
  const files = await pickPdfs(true);
  const ids = await addSources(files);
  addToCombine(ids);
}

export function combineRemove(itemId: string) {
  setState((s) => ({
    ...s,
    combine: { ...s.combine, items: s.combine.items.filter((i) => i.id !== itemId) },
  }));
  collectSources();
}

export function combineUpdate(itemId: string, fn: (i: import("./store").CombineItem) => import("./store").CombineItem) {
  setState((s) => ({
    ...s,
    combine: { ...s.combine, items: s.combine.items.map((i) => (i.id === itemId ? fn(i) : i)) },
  }));
}

export function combineMove(fromId: string, toId: string) {
  setState((s) => {
    const items = [...s.combine.items];
    const from = items.findIndex((i) => i.id === fromId);
    const to = items.findIndex((i) => i.id === toId);
    if (from < 0 || to < 0) return s;
    const [it] = items.splice(from, 1);
    items.splice(to, 0, it);
    return { ...s, combine: { ...s.combine, items } };
  });
}

export function combineSort() {
  setState((s) => {
    const items = [...s.combine.items].sort((a, b) =>
      s.sources[a.srcId].name.localeCompare(s.sources[b.srcId].name, undefined, { numeric: true }),
    );
    return { ...s, combine: { ...s.combine, items } };
  });
}

export function combineSet(patch: Partial<{ outputName: string; openAfter: boolean }>) {
  setState((s) => ({ ...s, combine: { ...s.combine, ...patch } }));
}

export function combinePages() {
  const s = getState();
  return s.combine.items
    .filter((i) => i.included)
    .flatMap((i) =>
      s.sources[i.srcId].sizes
        .map((_, idx) => idx)
        .filter((idx) => !i.skipped.includes(idx))
        .map((idx) => ({ srcId: i.srcId, srcIndex: idx, rotation: 0 })),
    );
}

export async function runCombine() {
  const s = getState();
  const pages = combinePages();
  if (!pages.length) {
    toast("Choose at least one page to combine.", "error");
    return;
  }
  let name = s.combine.outputName.trim() || "Combined.pdf";
  if (!/\.pdf$/i.test(name)) name += ".pdf";
  const path = await pickSavePath(name);
  if (!path) return;
  setState((st) => ({ ...st, combine: { ...st.combine, busy: true }, busy: `Combining ${pages.length} pages…` }));
  try {
    const bytes = await buildPdf(pages, stem(baseName(path)));
    await writePath(path, bytes);
    toast(`Created “${baseName(path)}” with ${pages.length} pages.`, "success");
    if (getState().combine.openAfter) {
      const [srcId] = await addSources([{ name: baseName(path), path, bytes }]);
      if (srcId) {
        const doc = newDoc(srcId);
        setState((st) => ({ ...st, docs: [...st.docs, doc], activeId: doc.id, mode: "read" }));
      }
    }
  } catch (e) {
    toast(`Could not combine: ${errorText(e)}`, "error");
  } finally {
    setState((st) => ({ ...st, combine: { ...st.combine, busy: false }, busy: null }));
  }
}

// -------------------------------------------------------------------- view

/** Moves the reader to a page and scrolls it into view. */
export function goToPage(id: string, index: number) {
  const d = getState().docs.find((x) => x.id === id);
  if (!d) return;
  const i = Math.max(0, Math.min(d.pages.length - 1, index));
  setState((s) => ({
    ...s,
    jump: s.jump + 1,
    docs: s.docs.map((x) => (x.id === id ? { ...x, current: i } : x)),
  }));
}

let searchRun = 0;

export async function search(id: string, query: string) {
  const q = query.trim().toLowerCase();
  const run = ++searchRun;
  if (!q) {
    setState((s) => ({ ...s, search: { query, hits: [], pos: 0, running: false, docId: id } }));
    return;
  }
  setState((s) => ({ ...s, search: { query, hits: [], pos: 0, running: true, docId: id } }));
  const d = getState().docs.find((x) => x.id === id);
  if (!d) return;
  const hits: number[] = [];
  for (let i = 0; i < d.pages.length; i++) {
    const p = d.pages[i];
    if ((await pageText(p.srcId, p.srcIndex)).includes(q)) hits.push(i);
    if (run !== searchRun) return;
  }
  const start = hits.findIndex((h) => h >= d.current);
  const pos = start === -1 ? 0 : start;
  setState((s) => ({ ...s, search: { query, hits, pos, running: false, docId: id } }));
  if (hits.length) goToPage(id, hits[pos]);
}

export function searchStep(id: string, dir: 1 | -1) {
  const { hits, pos } = getState().search;
  if (!hits.length) return;
  const next = (pos + dir + hits.length) % hits.length;
  setState((s) => ({ ...s, search: { ...s.search, pos: next } }));
  goToPage(id, hits[next]);
}

export function clearSearch() {
  searchRun++;
  setState((s) => ({ ...s, search: { query: "", hits: [], pos: 0, running: false, docId: null } }));
}

export function setZoom(z: number) {
  setState((s) => ({ ...s, zoom: Math.min(4, Math.max(0.25, Math.round(z * 100) / 100)) }));
}

export function setThumbSize(n: number) {
  setState((s) => ({ ...s, thumbSize: n }));
}
