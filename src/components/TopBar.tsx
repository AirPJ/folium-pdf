import { useEffect, useState } from "react";
import * as A from "../actions";
import { useActiveDoc, useStore, type Mode, type Theme } from "../store";
import {
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconCombine,
  IconDoc,
  IconGrid,
  IconMinus,
  IconMonitor,
  IconMoon,
  IconPlus,
  IconRead,
  IconRedo,
  IconSearch,
  IconSun,
  IconUndo,
} from "./Icons";

function Tabs() {
  const docs = useStore((s) => s.docs);
  const activeId = useStore((s) => s.activeId);
  const mode = useStore((s) => s.mode);
  return (
    <div className="tabs" role="tablist" aria-label="Open files">
      <div className="brand">
        <IconDoc size={16} />
        <span>Folium</span>
      </div>
      {docs.map((d) => {
        const active = d.id === activeId && mode !== "combine";
        return (
          <div key={d.id} className={`tab${active ? " is-active" : ""}`} title={d.path ?? d.name}>
            <button
              role="tab"
              aria-selected={active}
              className="tab-label"
              onClick={() => A.activate(d.id)}
              onAuxClick={(e) => e.button === 1 && A.closeDoc(d.id)}
            >
              {d.dirty && <span className="dirty-dot" aria-label="Unsaved changes" />}
              {d.name}
            </button>
            <button className="tab-close" aria-label={`Close ${d.name}`} onClick={() => A.closeDoc(d.id)}>
              <IconClose size={12} />
            </button>
          </div>
        );
      })}
      <button className="tab-add" aria-label="Open a PDF (Ctrl+O)" title="Open a PDF (Ctrl+O)" onClick={A.openDialog}>
        <IconPlus size={15} />
      </button>
    </div>
  );
}

const MODES: { id: Mode; label: string; icon: typeof IconRead; key: string }[] = [
  { id: "read", label: "Read", icon: IconRead, key: "1" },
  { id: "organize", label: "Organize", icon: IconGrid, key: "2" },
  { id: "combine", label: "Combine", icon: IconCombine, key: "3" },
];

function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  const hasDoc = useStore((s) => s.docs.length > 0);
  return (
    <div className="segmented" role="group" aria-label="Mode">
      {MODES.map((m) => {
        const Icon = m.icon;
        const disabled = m.id !== "combine" && !hasDoc;
        return (
          <button
            key={m.id}
            aria-pressed={mode === m.id}
            disabled={disabled}
            title={`${m.label} (Ctrl+${m.key})`}
            onClick={() => (m.id === "combine" ? A.startCombine() : A.setMode(m.id))}
          >
            <Icon size={15} />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

function PageNav() {
  const doc = useActiveDoc();
  const [text, setText] = useState("");
  const current = doc ? doc.current + 1 : 0;
  useEffect(() => setText(String(current)), [current]);
  if (!doc) return null;
  return (
    <div className="toolbar-group">
      <label htmlFor="page-input" className="muted small">
        Page
      </label>
      <input
        id="page-input"
        className="input page-input"
        value={text}
        inputMode="numeric"
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const n = parseInt(text, 10);
            if (!Number.isNaN(n)) A.goToPage(doc.id, n - 1);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onBlur={() => setText(String(current))}
      />
      <span className="muted small">of {doc.pages.length}</span>
    </div>
  );
}

function Zoom() {
  const zoom = useStore((s) => s.zoom);
  return (
    <div className="toolbar-group">
      <button className="icon-btn" aria-label="Zoom out (Ctrl+-)" title="Zoom out (Ctrl+-)" onClick={() => A.setZoom(zoom - 0.1)}>
        <IconMinus size={15} />
      </button>
      <button className="btn btn-compact" title="Reset zoom (Ctrl+0)" onClick={() => A.setZoom(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn" aria-label="Zoom in (Ctrl++)" title="Zoom in (Ctrl++)" onClick={() => A.setZoom(zoom + 0.1)}>
        <IconPlus size={15} />
      </button>
    </div>
  );
}

function SearchBox() {
  const doc = useActiveDoc();
  const search = useStore((s) => s.search);
  const [q, setQ] = useState("");
  if (!doc) return null;
  const mine = search.docId === doc.id && search.query === q && q.trim() !== "";
  let status = "";
  if (mine && search.running) status = "Searching…";
  else if (mine && !search.hits.length) status = "No results";
  else if (mine) status = `${search.pos + 1} / ${search.hits.length} pages`;
  return (
    <div className="search">
      <label className="search-box">
        <IconSearch size={15} />
        <input
          id="search-input"
          placeholder="Search in document"
          aria-label="Search in document"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (mine && search.hits.length) A.searchStep(doc.id, e.shiftKey ? -1 : 1);
              else A.search(doc.id, q);
            }
            if (e.key === "Escape") {
              setQ("");
              A.clearSearch();
            }
          }}
        />
        {status && <span className="muted small nowrap">{status}</span>}
      </label>
      {mine && search.hits.length > 1 && (
        <>
          <button className="icon-btn" aria-label="Previous result" onClick={() => A.searchStep(doc.id, -1)}>
            <IconChevronUp size={15} />
          </button>
          <button className="icon-btn" aria-label="Next result" onClick={() => A.searchStep(doc.id, 1)}>
            <IconChevronDown size={15} />
          </button>
        </>
      )}
    </div>
  );
}

const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
const THEME_LABEL: Record<Theme, string> = {
  system: "Theme: follows Windows",
  light: "Theme: light",
  dark: "Theme: dark",
};

function ThemeButton() {
  const theme = useStore((s) => s.theme);
  const Icon = theme === "dark" ? IconMoon : theme === "light" ? IconSun : IconMonitor;
  return (
    <button
      className="icon-btn bordered"
      aria-label={`${THEME_LABEL[theme]}. Click to change.`}
      title={`${THEME_LABEL[theme]} — click to change`}
      onClick={() => A.setTheme(THEME_NEXT[theme])}
    >
      <Icon size={16} />
    </button>
  );
}

export function TopBar() {
  const mode = useStore((s) => s.mode);
  const doc = useActiveDoc();
  const showDoc = doc && mode !== "combine";
  return (
    <header className="topbar">
      <Tabs />
      <div className="toolbar">
        <ModeSwitch />
        {showDoc && <div className="divider" />}
        {showDoc && mode === "read" && (
          <>
            <PageNav />
            <Zoom />
            <SearchBox />
          </>
        )}
        {showDoc && mode === "organize" && <OrganizeControls />}
        {mode === "combine" && <CombineControls />}
        <div className="spacer" />
        {showDoc && (
          <div className="toolbar-group">
            <button
              className="icon-btn"
              aria-label="Undo (Ctrl+Z)"
              title="Undo (Ctrl+Z)"
              disabled={!doc.past.length}
              onClick={() => A.undo(doc.id)}
            >
              <IconUndo size={16} />
            </button>
            <button
              className="icon-btn"
              aria-label="Redo (Ctrl+Y)"
              title="Redo (Ctrl+Y)"
              disabled={!doc.future.length}
              onClick={() => A.redo(doc.id)}
            >
              <IconRedo size={16} />
            </button>
          </div>
        )}
        <ThemeButton />
        {showDoc && (
          <button
            className="btn btn-primary"
            disabled={!doc.dirty && !!doc.path}
            title="Save (Ctrl+S). Save a copy: Ctrl+Shift+S"
            onClick={() => A.save(doc.id)}
          >
            Save
          </button>
        )}
      </div>
    </header>
  );
}

function OrganizeControls() {
  const doc = useActiveDoc();
  const size = useStore((s) => s.thumbSize);
  if (!doc) return null;
  return (
    <div className="toolbar-group wrap">
      <button className="btn" onClick={() => A.insertFiles(doc.id)}>
        <IconPlus size={15} />
        Add pages from files
      </button>
      <button className="btn" onClick={() => A.openDialogFor("range", doc.id)}>
        Select pages…
      </button>
      <label className="muted small slider">
        Size
        <input
          type="range"
          min={100}
          max={280}
          step={10}
          value={size}
          aria-label="Thumbnail size"
          onChange={(e) => A.setThumbSize(Number(e.target.value))}
        />
      </label>
    </div>
  );
}

function CombineControls() {
  return (
    <div className="toolbar-group">
      <button className="btn" onClick={A.combineAddFiles}>
        <IconPlus size={15} />
        Add files
      </button>
      <button className="btn" onClick={A.combineSort}>
        Sort by name
      </button>
    </div>
  );
}
