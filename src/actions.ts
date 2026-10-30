// Everything the user can do, as plain functions over the store.

import { formatBytes, num, t, tn } from "./i18n";
import {
  buildPdf,
  compressImages,
  loadSource,
  mightBeEncrypted,
  pageImageFile,
  pageText,
  PageRangeError,
  parseRanges,
  PdfOpenError,
  rememberPassword,
  sourcePassword,
  unloadSource,
  type CompressLevel,
} from "./lib/pdf";
import {
  baseName,
  errorText,
  isDesktop,
  joinPath,
  pdfIsEncrypted,
  pdfOptimize,
  pdfProtect,
  pdfUnlock,
  pickFolder,
  pickPdfs,
  pickSavePath,
  readPath,
  writePath,
  type PickedFile,
  type ProtectOptions,
} from "./lib/platform";
import {
  getState,
  setState,
  uid,
  type ChoiceButton,
  type CombineItem,
  type Doc,
  type Lang,
  type Mode,
  type PageRef,
  type Theme,
} from "./store";

// ------------------------------------------------------------------ toasts

export function toast(text: string, kind: "info" | "success" | "error" = "info") {
  const id = uid();
  setState((s) => ({ ...s, toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => dismissToast(id), kind === "error" ? 8000 : 4500);
}

export function dismissToast(id: string) {
  setState((s) => ({ ...s, toasts: s.toasts.filter((x) => x.id !== id) }));
}

function setBusy(text: string | null) {
  setState((s) => ({ ...s, busy: text }));
}

/** Readable message for errors coming back from qpdf. */
function pdfError(e: unknown): string {
  const msg = errorText(e);
  if (msg === "wrong-password") return t("Wrong password.");
  if (msg === "damaged") return t("The file is damaged.");
  return msg.replace(/^failed: /, "");
}

// ----------------------------------------------------------------- dialogs

export function closeDialog() {
  setState((s) => ({ ...s, dialog: null }));
}

/** Shows a question with buttons; resolves with the chosen button's value. */
export function ask(title: string, body: string, buttons: ChoiceButton[]): Promise<string> {
  return new Promise((resolve) => {
    setState((s) => ({
      ...s,
      dialog: {
        type: "choice",
        title,
        body,
        buttons,
        resolve: (v) => {
          closeDialog();
          resolve(v);
        },
      },
    }));
  });
}

/** Asks for a file's password; null if cancelled. */
function askPassword(fileName: string, error: string | null): Promise<string | null> {
  return new Promise((resolve) => {
    setState((s) => ({
      ...s,
      dialog: {
        type: "password",
        fileName,
        error,
        resolve: (v) => {
          closeDialog();
          resolve(v);
        },
      },
    }));
  });
}

export function openDialogFor(type: "split" | "range" | "compress" | "protect" | "export", docId: string) {
  if (type === "protect" && !isDesktop) {
    toast(t("Password protection works in the desktop app."), "error");
    return;
  }
  setState((s) => ({ ...s, dialog: { type, docId } }));
}

// ----------------------------------------------------------------- loading

/** Loads files into memory, asking for passwords where needed. */
async function addSources(files: PickedFile[]): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    const id = uid();
    let bytes = f.bytes;
    let unlocked: "password" | "restrictions" | undefined;
    let password: string | undefined;
    try {
      let loaded;
      try {
        loaded = await loadSource(id, bytes);
      } catch (e) {
        if (!(e instanceof PdfOpenError) || e.kind !== "password") throw e;
        if (!isDesktop) {
          toast(t("“{name}” is password protected. Open it in the desktop app.", { name: f.name }), "error");
          continue;
        }
        // Ask until the password is right or the user gives up.
        let error: string | null = null;
        for (;;) {
          const pw = await askPassword(f.name, error);
          if (pw === null) break;
          try {
            bytes = await pdfUnlock(f.bytes, pw);
            password = pw;
            break;
          } catch (err) {
            error = pdfError(err);
          }
        }
        if (password === undefined) continue;
        unlocked = "password";
        loaded = await loadSource(id, bytes);
        rememberPassword(id, password);
      }
      // Files that open without a password can still be encrypted with
      // restrictions (no printing, no editing…), which blocks editing.
      if (!unlocked && isDesktop && mightBeEncrypted(bytes) && (await pdfIsEncrypted(bytes))) {
        bytes = await pdfUnlock(bytes, "");
        loaded = await loadSource(id, bytes);
        unlocked = "restrictions";
        toast(t("“{name}” had restrictions (such as no editing). Folium works on an unrestricted copy.", { name: f.name }));
      }
      const { sizes, version } = loaded;
      setState((s) => ({
        ...s,
        sources: {
          ...s.sources,
          [id]: { id, name: f.name, path: f.path, size: f.bytes.length, sizes, version, unlocked },
        },
      }));
      ids.push(id);
      if (f.path) rememberRecent(f.path);
    } catch (e) {
      const why =
        e instanceof PdfOpenError ? t("It isn't a valid PDF or is damaged.") : pdfError(e) || t("Unknown error.");
      toast(t("Could not open “{name}”. {why}", { name: f.name, why }), "error");
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
  return {
    id: uid(),
    name: meta.name,
    path: meta.path,
    primarySrc: srcId,
    pages: allPages(srcId),
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
  setBusy(
    fresh.length > 1
      ? t("Opening {n} files…", { n: fresh.length })
      : t("Opening {name}…", { name: fresh[0].name }),
  );
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
    setBusy(null);
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

// ---------------------------------------------------------- tabs, settings

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

export function setLang(lang: Lang) {
  try {
    localStorage.setItem("folium.lang", lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  // Notifications were written in the previous language.
  setState((s) => ({ ...s, lang, toasts: [] }));
}

/** Closes a tab, asking about unsaved changes. Returns false if cancelled. */
export async function closeDoc(id: string): Promise<boolean> {
  const doc = getState().docs.find((d) => d.id === id);
  if (!doc) return true;
  if (doc.dirty) {
    setState((s) => ({ ...s, activeId: id }));
    const answer = await ask(
      t("Save your changes?"),
      t("“{name}” has changes that haven't been saved.", { name: doc.name }),
      [
        { label: t("Cancel"), value: "cancel" },
        { label: t("Don't save"), value: "discard" },
        { label: t("Save"), value: "save", primary: true },
      ],
    );
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
  const mark = (pages: PageRef[]) => pages.forEach((p) => used.add(p.srcId));
  s.docs.forEach((d) => {
    used.add(d.primarySrc);
    mark(d.pages);
    d.past.forEach(mark);
    d.future.forEach(mark);
  });
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

function findDoc(id: string): Doc | undefined {
  return getState().docs.find((x) => x.id === id);
}

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
  const d = findDoc(id);
  if (!d) return;
  const keys = new Set(targetKeys(d));
  editPages(id, (pages) =>
    pages.map((p) => (keys.has(p.key) ? { ...p, rotation: (p.rotation + by + 360) % 360 } : p)),
  );
}

export function deletePages(id: string) {
  const d = findDoc(id);
  if (!d) return;
  const keys = new Set(targetKeys(d));
  if (keys.size >= d.pages.length) {
    toast(t("A PDF needs at least one page. Close the tab instead to discard it."), "error");
    return;
  }
  editPages(id, (pages) => pages.filter((p) => !keys.has(p.key)), []);
  toast(tn(keys.size, "Page deleted. Ctrl+Z to undo.", "{n} pages deleted. Ctrl+Z to undo."));
}

export function duplicatePages(id: string) {
  const d = findDoc(id);
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
  const d = findDoc(id);
  if (!d || activeKey === overKey) return;
  const moving = new Set(d.selection.includes(activeKey) ? d.selection : [activeKey]);
  editPages(id, (pages) => {
    const from = pages.findIndex((p) => p.key === activeKey);
    const to = pages.findIndex((p) => p.key === overKey);
    const block = pages.filter((p) => moving.has(p.key));
    const rest = pages.filter((p) => !moving.has(p.key));
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
  toast(tn(ids.length, "Added 1 file at the end.", "Added {n} files at the end."), "success");
}

/** Readable message for a page range error. */
export function rangeMessage(e: unknown, pageCount: number): string {
  if (e instanceof PageRangeError) {
    if (e.code === "empty") return t("Enter pages like 1-3, 5, 8-");
    if (e.code === "invalid") return t("“{part}” isn't a page or range.", { part: e.part });
    return t("“{part}” is outside 1–{n}.", { part: e.part, n: pageCount });
  }
  return errorText(e);
}

export function selectRange(id: string, text: string): string | null {
  const d = findDoc(id);
  if (!d) return null;
  try {
    const idx = parseRanges(text, d.pages.length).flat();
    setSelection(id, [...new Set(idx)].map((i) => d.pages[i].key));
    return null;
  } catch (e) {
    return rangeMessage(e, d.pages.length);
  }
}

// ------------------------------------------------------------------ saving

export function stem(name: string) {
  return name.replace(/\.pdf$/i, "");
}

function toBuild(pages: PageRef[]) {
  return pages.map((p) => ({ srcId: p.srcId, srcIndex: p.srcIndex, rotation: p.rotation }));
}

/** Writes a doc to disk. `saveAs` always asks for a location. */
export async function save(id: string, saveAs = false): Promise<boolean> {
  const d = findDoc(id);
  if (!d) return false;
  let path = d.path;
  if (saveAs || !path) {
    path = await pickSavePath(saveAs ? t("{name} (copy).pdf", { name: stem(d.name) }) : d.name);
    if (!path) return false;
  }

  // A file that was opened with a password: keep it, or not?
  const password = sourcePassword(d.primarySrc);
  let keepPassword = false;
  if (password !== undefined) {
    const answer = await ask(
      t("Keep the password?"),
      t("“{name}” was protected with a password. Folium can save it with the same password, or without one.", {
        name: d.name,
      }),
      [
        { label: t("Cancel"), value: "cancel" },
        { label: t("Save without password"), value: "remove" },
        { label: t("Keep the password"), value: "keep", primary: true },
      ],
    );
    if (answer === "cancel") return false;
    keepPassword = answer === "keep";
  }

  setBusy(t("Saving…"));
  try {
    let bytes = await buildPdf(toBuild(d.pages));
    const plain = bytes;
    if (keepPassword && password !== undefined) {
      bytes = await pdfProtect(bytes, { password, allowPrint: true, allowCopy: true, allowEdit: true });
    }
    await writePath(path, bytes);
    // Reload from what was written, so later edits start from the saved file.
    const srcId = uid();
    const loaded = await loadSource(srcId, plain);
    if (keepPassword && password !== undefined) rememberPassword(srcId, password);
    setState((s) => ({
      ...s,
      sources: {
        ...s.sources,
        [srcId]: {
          id: srcId,
          name: baseName(path!),
          path,
          size: bytes.length,
          sizes: loaded.sizes,
          version: loaded.version,
          unlocked: keepPassword ? "password" : undefined,
        },
      },
    }));
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
      current: Math.min(doc.current, loaded.sizes.length - 1),
    }));
    collectSources();
    rememberRecent(path);
    toast(t("Saved “{name}” ({size}).", { name: baseName(path), size: formatBytes(bytes.length) }), "success");
    return true;
  } catch (e) {
    toast(t("Could not save: {why}", { why: pdfError(e) }), "error");
    return false;
  } finally {
    setBusy(null);
  }
}

/** Saves the selected pages (or the current page) as a new PDF. */
export async function extract(id: string) {
  const d = findDoc(id);
  if (!d) return;
  const keys = new Set(targetKeys(d));
  const pages = d.pages.filter((p) => keys.has(p.key));
  if (!pages.length) return;
  const label =
    pages.length === 1
      ? t("page {n}", { n: d.pages.indexOf(pages[0]) + 1 })
      : t("{n} pages", { n: pages.length });
  const path = await pickSavePath(`${stem(d.name)} - ${label}.pdf`);
  if (!path) return;
  setBusy(t("Extracting…"));
  try {
    await writePath(path, await buildPdf(toBuild(pages)));
    toast(t("Extracted {what} to “{name}”.", { what: label, name: baseName(path) }), "success");
  } catch (e) {
    toast(t("Could not extract: {why}", { why: pdfError(e) }), "error");
  } finally {
    setBusy(null);
  }
}

/** Splits a doc into several files written to a folder. */
export async function split(id: string, groups: number[][]) {
  const d = findDoc(id);
  if (!d || !groups.length) return;
  const folder = await pickFolder();
  if (folder === null) return;
  setBusy(tn(groups.length, "Splitting into {n} file…", "Splitting into {n} files…"));
  try {
    const width = String(groups.length).length;
    for (let i = 0; i < groups.length; i++) {
      const bytes = await buildPdf(toBuild(groups[i].map((idx) => d.pages[idx])));
      const name = `${stem(d.name)} - ${t("part")} ${String(i + 1).padStart(width, "0")}.pdf`;
      await writePath(joinPath(folder, name), bytes);
    }
    toast(tn(groups.length, "Created {n} file.", "Created {n} files."), "success");
  } catch (e) {
    toast(t("Could not split: {why}", { why: pdfError(e) }), "error");
  } finally {
    setBusy(null);
  }
}

// ---------------------------------------------------------- compression

export interface CompressResult {
  bytes: Uint8Array;
  before: number;
  images: number;
}

/** Builds a smaller copy of the document. Doesn't save it. */
export async function compressDoc(
  id: string,
  level: CompressLevel,
  onProgress: (text: string) => void,
): Promise<CompressResult> {
  const d = findDoc(id)!;
  const src = getState().sources[d.primarySrc];
  onProgress(t("Preparing…"));
  const built = await buildPdf(toBuild(d.pages));
  const { bytes: smaller, images } = await compressImages(built, level, (done, total) =>
    onProgress(t("Images: {done} of {total}", { done, total })),
  );
  onProgress(t("Optimizing…"));
  let bytes = await pdfOptimize(smaller);
  if (bytes.length > smaller.length) bytes = smaller;
  // Compare with the file on disk when the pages are unchanged.
  const before = !d.dirty && src ? src.size : built.length;
  return { bytes, before, images };
}

export async function saveCompressed(id: string, r: CompressResult): Promise<boolean> {
  const d = findDoc(id);
  if (!d) return false;
  const path = await pickSavePath(t("{name} (compressed).pdf", { name: stem(d.name) }));
  if (!path) return false;
  try {
    await writePath(path, r.bytes);
    toast(
      t("Saved “{name}”: {before} → {after}.", {
        name: baseName(path),
        before: formatBytes(r.before),
        after: formatBytes(r.bytes.length),
      }),
      "success",
    );
    return true;
  } catch (e) {
    toast(errorText(e), "error");
    return false;
  }
}

// ----------------------------------------------------------- protection

export async function protect(id: string, o: ProtectOptions): Promise<boolean> {
  const d = findDoc(id);
  if (!d) return false;
  const path = await pickSavePath(t("{name} (protected).pdf", { name: stem(d.name) }));
  if (!path) return false;
  setBusy(t("Protecting…"));
  try {
    const bytes = await pdfProtect(await buildPdf(toBuild(d.pages)), o);
    await writePath(path, bytes);
    toast(t("Saved “{name}” with a password.", { name: baseName(path) }), "success");
    return true;
  } catch (e) {
    toast(t("Could not protect: {why}", { why: pdfError(e) }), "error");
    return false;
  } finally {
    setBusy(null);
  }
}

// ---------------------------------------------------------- export images

export async function exportImages(
  id: string,
  which: "current" | "selected" | "all",
  format: "png" | "jpeg",
  dpi: number,
) {
  const d = findDoc(id);
  if (!d) return;
  const keys = which === "all" ? null : new Set(which === "selected" ? d.selection : targetKeys(d));
  const items = d.pages.map((p, i) => ({ p, n: i + 1 })).filter(({ p }) => !keys || keys.has(p.key));
  if (!items.length) return;
  const folder = await pickFolder();
  if (folder === null) return;
  const ext = format === "png" ? "png" : "jpg";
  const width = String(d.pages.length).length;
  try {
    for (let i = 0; i < items.length; i++) {
      setBusy(t("Exporting page {done} of {total}…", { done: i + 1, total: items.length }));
      const { p, n } = items[i];
      const bytes = await pageImageFile(p.srcId, p.srcIndex, p.rotation, dpi, format);
      const name = `${stem(d.name)} - ${t("page")} ${String(n).padStart(width, "0")}.${ext}`;
      await writePath(joinPath(folder, name), bytes, format === "png" ? "image/png" : "image/jpeg");
    }
    toast(tn(items.length, "Exported {n} image.", "Exported {n} images."), "success");
  } catch (e) {
    toast(t("Could not export: {why}", { why: errorText(e) }), "error");
  } finally {
    setBusy(null);
  }
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
        combine: { ...st.combine, outputName: t("{name} - combined.pdf", { name: stem(first.name) }) },
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

export function combineUpdate(itemId: string, fn: (i: CombineItem) => CombineItem) {
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

export function combineSet(
  patch: Partial<{ outputName: string; openAfter: boolean; keepBookmarks: boolean; fileBookmarks: boolean }>,
) {
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
    toast(t("Choose at least one page to combine."), "error");
    return;
  }
  let name = s.combine.outputName.trim() || t("Combined.pdf");
  if (!/\.pdf$/i.test(name)) name += ".pdf";
  const path = await pickSavePath(name);
  if (!path) return;
  setState((st) => ({ ...st, combine: { ...st.combine, busy: true } }));
  setBusy(tn(pages.length, "Combining {n} page…", "Combining {n} pages…"));
  try {
    const perFile = s.combine.fileBookmarks
      ? s.combine.items.filter((i) => i.included).map((i) => ({ srcId: i.srcId, title: stem(s.sources[i.srcId].name) }))
      : undefined;
    const bytes = await buildPdf(pages, { title: stem(baseName(path)), bookmarks: s.combine.keepBookmarks, perFile });
    await writePath(path, bytes);
    toast(
      tn(pages.length, "Created “{name}” with {n} page.", "Created “{name}” with {n} pages.", { name: baseName(path) }),
      "success",
    );
    if (getState().combine.openAfter) {
      const [srcId] = await addSources([{ name: baseName(path), path, bytes }]);
      if (srcId) {
        const doc = newDoc(srcId);
        setState((st) => ({ ...st, docs: [...st.docs, doc], activeId: doc.id, mode: "read" }));
      }
    }
  } catch (e) {
    toast(t("Could not combine: {why}", { why: pdfError(e) }), "error");
  } finally {
    setState((st) => ({ ...st, combine: { ...st.combine, busy: false } }));
    setBusy(null);
  }
}

// -------------------------------------------------------------------- view

export function setZoom(z: number) {
  setState((s) => ({ ...s, zoom: Math.min(4, Math.max(0.25, Math.round(z * 100) / 100)) }));
}

export function setThumbSize(n: number) {
  setState((s) => ({ ...s, thumbSize: n }));
}

/** Moves the reader to a page and scrolls it into view. */
export function goToPage(id: string, index: number) {
  const d = findDoc(id);
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
  const d = findDoc(id);
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

export { num };
