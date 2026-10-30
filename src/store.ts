import { useSyncExternalStore } from "react";

export type Mode = "read" | "organize" | "combine";
export type Theme = "system" | "light" | "dark";

/** A page as it appears in a document being edited. */
export interface PageRef {
  /** Unique per occurrence, stable across reorders. */
  key: string;
  srcId: string;
  /** 0-based index of the page in its source file. */
  srcIndex: number;
  /** Rotation added by the user, in degrees (0, 90, 180, 270). */
  rotation: number;
}

/** A PDF file loaded into memory. Bytes live in pdf.ts, not in state. */
export interface SourceMeta {
  id: string;
  name: string;
  path: string | null;
  size: number;
  /** Width and height of each page at scale 1, with the file's own rotation. */
  sizes: { w: number; h: number }[];
  version: string;
}

export interface Doc {
  id: string;
  name: string;
  path: string | null;
  primarySrc: string;
  pages: PageRef[];
  past: PageRef[][];
  future: PageRef[][];
  dirty: boolean;
  /** Index in `pages` of the page shown in the reader. */
  current: number;
  selection: string[];
  anchor: string | null;
}

export interface CombineItem {
  id: string;
  srcId: string;
  included: boolean;
  /** Source page indexes the user chose to leave out. */
  skipped: number[];
}

export interface Toast {
  id: string;
  text: string;
  kind: "info" | "success" | "error";
}

export type Dialog =
  | { type: "unsaved"; docId: string; resolve: (v: "save" | "discard" | "cancel") => void }
  | { type: "split"; docId: string }
  | { type: "range"; docId: string }
  | null;

export interface State {
  sources: Record<string, SourceMeta>;
  docs: Doc[];
  activeId: string | null;
  mode: Mode;
  combine: { items: CombineItem[]; outputName: string; openAfter: boolean; busy: boolean };
  zoom: number;
  thumbSize: number;
  theme: Theme;
  toasts: Toast[];
  dialog: Dialog;
  busy: string | null;
  /** Incremented to ask the reader to scroll to the current page. */
  jump: number;
  search: { query: string; hits: number[]; pos: number; running: boolean; docId: string | null };
}

function loadTheme(): Theme {
  try {
    const t = localStorage.getItem("folium.theme");
    if (t === "light" || t === "dark" || t === "system") return t;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

let state: State = {
  sources: {},
  docs: [],
  activeId: null,
  mode: "read",
  combine: { items: [], outputName: "Combined.pdf", openAfter: true, busy: false },
  zoom: 1,
  thumbSize: 150,
  theme: loadTheme(),
  toasts: [],
  dialog: null,
  busy: null,
  jump: 0,
  search: { query: "", hits: [], pos: 0, running: false, docId: null },
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(fn: (s: State) => State): void {
  state = fn(state);
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export function useActiveDoc(): Doc | null {
  return useStore((s) => s.docs.find((d) => d.id === s.activeId) ?? null);
}

export const uid = () => crypto.randomUUID();
