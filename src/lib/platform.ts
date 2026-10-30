// Everything that touches the operating system goes through this file.
// Inside the desktop app it uses Tauri; in a plain browser (used during
// development) it falls back to file inputs and downloads.

import { invoke } from "@tauri-apps/api/core";
import { t } from "../i18n";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface PickedFile {
  name: string;
  path: string | null;
  bytes: Uint8Array;
}

const pdfFilter = () => [{ name: t("PDF documents"), extensions: ["pdf"] }];

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Error text from Rust or the browser, as a string. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

export async function readPath(path: string): Promise<PickedFile> {
  try {
    const buf = await invoke<ArrayBuffer>("read_file", { path });
    return { name: baseName(path), path, bytes: new Uint8Array(buf) };
  } catch (e) {
    throw new Error(t("Could not open “{name}”: {detail}", { name: baseName(path), detail: errorText(e) }));
  }
}

/** Asks for one or more PDFs and reads them. */
export async function pickPdfs(multiple = true): Promise<PickedFile[]> {
  if (isDesktop) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ multiple, filters: pdfFilter() });
    if (!res) return [];
    const paths = Array.isArray(res) ? res : [res];
    return Promise.all(paths.map(readPath));
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.multiple = multiple;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      resolve(await Promise.all(files.map(fileToPicked)));
    };
    input.click();
  });
}

export async function fileToPicked(f: File): Promise<PickedFile> {
  return { name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) };
}

/** Asks where to save. Returns null if cancelled. In the browser, returns the name. */
export async function pickSavePath(defaultName: string): Promise<string | null> {
  if (isDesktop) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    return save({ defaultPath: defaultName, filters: pdfFilter() });
  }
  return defaultName;
}

export async function pickFolder(): Promise<string | null> {
  if (isDesktop) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const res = await open({ directory: true, multiple: false });
    return typeof res === "string" ? res : null;
  }
  return "";
}

export function joinPath(folder: string, name: string): string {
  if (!folder) return name;
  const sep = folder.includes("\\") ? "\\" : "/";
  return folder.endsWith(sep) ? folder + name : folder + sep + name;
}

/** Writes bytes to a path (desktop) or downloads them (browser). */
export async function writePath(path: string, bytes: Uint8Array, mime = "application/pdf"): Promise<void> {
  if (isDesktop) {
    try {
      await invoke("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
    } catch (e) {
      throw new Error(
        t("Could not save “{name}”. Is it open in another program? ({detail})", {
          name: baseName(path),
          detail: errorText(e),
        }),
      );
    }
    return;
  }
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = baseName(path);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function startupFiles(): Promise<string[]> {
  if (!isDesktop) return [];
  try {
    return await invoke<string[]>("startup_files");
  } catch {
    return [];
  }
}

// ------------------------------------------------------------- qpdf (Rust)

/** True if the file is encrypted. Always false in the browser build. */
export async function pdfIsEncrypted(bytes: Uint8Array): Promise<boolean> {
  if (!isDesktop) return false;
  return invoke<boolean>("pdf_is_encrypted", bytes);
}

/** Returns an unencrypted copy. Rejects with "wrong-password" if needed. */
export async function pdfUnlock(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("pdf_unlock", bytes, {
    headers: { "x-password": encodeURIComponent(password) },
  });
  return new Uint8Array(buf);
}

export interface ProtectOptions {
  password: string;
  allowPrint: boolean;
  allowCopy: boolean;
  allowEdit: boolean;
}

export async function pdfProtect(bytes: Uint8Array, o: ProtectOptions): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("pdf_protect", bytes, {
    headers: {
      "x-password": encodeURIComponent(o.password),
      "x-allow-print": o.allowPrint ? "1" : "0",
      "x-allow-copy": o.allowCopy ? "1" : "0",
      "x-allow-edit": o.allowEdit ? "1" : "0",
    },
  });
  return new Uint8Array(buf);
}

/** Lossless optimisation. In the browser build, returns the input unchanged. */
export async function pdfOptimize(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isDesktop) return bytes;
  return new Uint8Array(await invoke<ArrayBuffer>("pdf_optimize", bytes));
}

// ----------------------------------------------------------------- window

/** Calls `onDrop` with PDF paths dropped onto the window from the file explorer. */
export async function onFileDrop(
  onDrop: (paths: string[]) => void,
  onHover: (hovering: boolean) => void,
): Promise<() => void> {
  if (!isDesktop) return () => {};
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  return getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === "enter" || p.type === "over") onHover(true);
    else if (p.type === "leave") onHover(false);
    else if (p.type === "drop") {
      onHover(false);
      const pdfs = p.paths.filter((x) => x.toLowerCase().endsWith(".pdf"));
      if (pdfs.length) onDrop(pdfs);
    }
  });
}

export async function setWindowTitle(title: string): Promise<void> {
  if (isDesktop) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  } else {
    document.title = title;
  }
}

/** Lets the app intercept closing the window (to ask about unsaved changes). */
export async function onCloseRequested(handler: () => Promise<boolean>): Promise<() => void> {
  if (!isDesktop) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  return win.onCloseRequested(async (event) => {
    event.preventDefault();
    if (await handler()) await win.destroy();
  });
}
