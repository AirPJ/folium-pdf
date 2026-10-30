import { useEffect, useState } from "react";
import * as A from "./actions";
import { CombineView } from "./components/CombineView";
import { anyDialog, Busy, Dialogs, Toasts, typing } from "./components/Dialogs";
import { IconUpload } from "./components/Icons";
import { OrganizeView } from "./components/OrganizeView";
import { ReadView } from "./components/ReadView";
import { TopBar } from "./components/TopBar";
import { UpdateBanner } from "./components/Updates";
import { Welcome } from "./components/Welcome";
import { fileToPicked, isDesktop, onCloseRequested, onFileDrop, onOpenRequests, setWindowTitle } from "./lib/platform";
import { t } from "./i18n";
import { canUpdate } from "./lib/updater";
import { getState, useActiveDoc, useStore } from "./store";

function useTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      const doc = s.docs.find((d) => d.id === s.activeId);
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // Ctrl+P prints the document, never the app's own screen.
      if (ctrl && k === "p") {
        e.preventDefault();
        if (!anyDialog() && doc && s.mode !== "combine") A.printDoc(doc.id);
        return;
      }
      if (anyDialog()) return;

      if (ctrl && k === "o") return e.preventDefault(), A.openDialog();
      if (ctrl && k === "1" && doc) return e.preventDefault(), A.setMode("read");
      if (ctrl && k === "2" && doc) return e.preventDefault(), A.setMode("organize");
      if (ctrl && k === "3") return e.preventDefault(), A.startCombine();
      if (ctrl && k === "w" && doc && s.mode !== "combine") return e.preventDefault(), A.closeDoc(doc.id);
      if (ctrl && e.key === "Tab" && s.docs.length > 1) {
        e.preventDefault();
        const i = s.docs.findIndex((d) => d.id === s.activeId);
        const next = (i + (e.shiftKey ? -1 : 1) + s.docs.length) % s.docs.length;
        return A.activate(s.docs[next].id);
      }
      if (!doc || s.mode === "combine") return;

      if (ctrl && k === "s") return e.preventDefault(), A.save(doc.id, e.shiftKey);
      if (ctrl && k === "f" && s.mode === "read") {
        e.preventDefault();
        return document.getElementById("search-input")?.focus();
      }
      if (ctrl && (e.key === "+" || e.key === "=")) return e.preventDefault(), A.setZoom(s.zoom + 0.1);
      if (ctrl && e.key === "-") return e.preventDefault(), A.setZoom(s.zoom - 0.1);
      if (ctrl && e.key === "0") return e.preventDefault(), A.setZoom(1);
      if (typing()) return;
      if (ctrl && k === "z") return e.preventDefault(), e.shiftKey ? A.redo(doc.id) : A.undo(doc.id);
      if (ctrl && k === "y") return e.preventDefault(), A.redo(doc.id);
      if (ctrl && k === "a") return e.preventDefault(), A.selectAll(doc.id);
      if (ctrl && k === "e") return e.preventDefault(), A.extract(doc.id);
      if (ctrl && k === "d") return e.preventDefault(), A.duplicatePages(doc.id);
      if (ctrl) return;
      if (e.key === "Delete" || e.key === "Backspace") return e.preventDefault(), A.deletePages(doc.id);
      if (k === "r") return e.preventDefault(), A.rotate(doc.id, e.shiftKey ? -90 : 90);
      if (e.key === "Escape") return A.setSelection(doc.id, []);
      if (s.mode === "read") {
        if (e.key === "PageDown" || e.key === "ArrowRight") return e.preventDefault(), A.goToPage(doc.id, doc.current + 1);
        if (e.key === "PageUp" || e.key === "ArrowLeft") return e.preventDefault(), A.goToPage(doc.id, doc.current - 1);
        if (e.key === "Home") return e.preventDefault(), A.goToPage(doc.id, 0);
        if (e.key === "End") return e.preventDefault(), A.goToPage(doc.id, doc.pages.length - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function App() {
  useTheme();
  useShortcuts();
  const mode = useStore((s) => s.mode);
  const doc = useActiveDoc();
  const [hover, setHover] = useState(false);

  // Window title shows the file and whether it has unsaved changes.
  const title =
    mode === "combine"
      ? `${t("Combine")} — Folium PDF`
      : doc
        ? `${doc.dirty ? "• " : ""}${doc.name} — Folium PDF`
        : "Folium PDF";
  useEffect(() => {
    setWindowTitle(title);
  }, [title]);

  // Files from the file explorer: dropped on the window or passed at launch.
  useEffect(() => {
    let off = () => {};
    onFileDrop(A.openPaths, setHover).then((fn) => (off = fn));
    A.loadAppVersion();
    // Automatic update check, a few seconds after start so it never slows opening.
    const updateTimer = setTimeout(() => {
      if (getState().autoUpdate && canUpdate()) A.checkUpdates(true);
    }, 4000);
    let offOpen = () => {};
    onOpenRequests((paths) => A.openPaths(paths, { asTabs: true })).then((fn) => (offOpen = fn));
    let offClose = () => {};
    onCloseRequested(A.confirmQuit, (why) => A.toast(t("Could not close the window: {why}", { why }), "error")).then(
      (fn) => (offClose = fn),
    );
    return () => {
      clearTimeout(updateTimer);
      off();
      offOpen();
      offClose();
    };
  }, []);

  // Browser fallback for development: HTML drag and drop.
  const htmlDrop = isDesktop
    ? {}
    : {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault();
          setHover(true);
        },
        onDragLeave: () => setHover(false),
        onDrop: async (e: React.DragEvent) => {
          e.preventDefault();
          setHover(false);
          const files = Array.from(e.dataTransfer.files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
          A.openFiles(await Promise.all(files.map(fileToPicked)));
        },
      };

  let body;
  if (mode === "combine") body = <CombineView />;
  else if (!doc) body = <Welcome />;
  else if (mode === "organize") body = <OrganizeView doc={doc} />;
  else body = <ReadView doc={doc} />;

  return (
    <div className="app" {...htmlDrop}>
      <TopBar />
      <UpdateBanner />
      {body}
      {hover && (
        <div className="drop-overlay" aria-hidden="true">
          <IconUpload size={32} />
          <span>{mode === "combine" ? t("Drop to add to Combine") : t("Drop to open")}</span>
        </div>
      )}
      <Dialogs />
      <Toasts />
      <Busy />
    </div>
  );
}
