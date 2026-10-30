import { useEffect, useState } from "react";
import * as A from "../actions";
import { t } from "../i18n";
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
    <div className="tabs" role="tablist" aria-label={t("Open files")}>
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
              {d.dirty && <span className="dirty-dot" aria-label={t("Unsaved changes")} />}
              {d.name}
            </button>
            <button className="tab-close" aria-label={t("Close {name}", { name: d.name })} onClick={() => A.closeDoc(d.id)}>
              <IconClose size={12} />
            </button>
          </div>
        );
      })}
      <button className="tab-add" aria-label={t("Open a PDF (Ctrl+O)")} title={t("Open a PDF (Ctrl+O)")} onClick={A.openDialog}>
        <IconPlus size={15} />
      </button>
    </div>
  );
}

function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  const hasDoc = useStore((s) => s.docs.length > 0);
  const modes: { id: Mode; label: string; icon: typeof IconRead; key: string }[] = [
    { id: "read", label: t("Read"), icon: IconRead, key: "1" },
    { id: "organize", label: t("Organize"), icon: IconGrid, key: "2" },
    { id: "combine", label: t("Combine"), icon: IconCombine, key: "3" },
  ];
  return (
    <div className="segmented" role="group" aria-label={t("Mode")}>
      {modes.map((m) => {
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
        {t("Page")}
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
      <span className="muted small">{t("of {n}", { n: doc.pages.length })}</span>
    </div>
  );
}

function Zoom() {
  const zoom = useStore((s) => s.zoom);
  return (
    <div className="toolbar-group">
      <button className="icon-btn" aria-label={t("Zoom out (Ctrl+-)")} title={t("Zoom out (Ctrl+-)")} onClick={() => A.setZoom(zoom - 0.1)}>
        <IconMinus size={15} />
      </button>
      <button className="btn btn-compact" title={t("Reset zoom (Ctrl+0)")} onClick={() => A.setZoom(1)}>
        {t("{n}%", { n: Math.round(zoom * 100) })}
      </button>
      <button className="icon-btn" aria-label={t("Zoom in (Ctrl++)")} title={t("Zoom in (Ctrl++)")} onClick={() => A.setZoom(zoom + 0.1)}>
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
  if (mine && search.running) status = t("Searching…");
  else if (mine && !search.hits.length) status = t("No results");
  else if (mine) status = t("{pos} / {n} pages", { pos: search.pos + 1, n: search.hits.length });
  return (
    <div className="search">
      <label className="search-box">
        <IconSearch size={15} />
        <input
          id="search-input"
          placeholder={t("Search in document")}
          aria-label={t("Search in document")}
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
          <button className="icon-btn" aria-label={t("Previous result")} onClick={() => A.searchStep(doc.id, -1)}>
            <IconChevronUp size={15} />
          </button>
          <button className="icon-btn" aria-label={t("Next result")} onClick={() => A.searchStep(doc.id, 1)}>
            <IconChevronDown size={15} />
          </button>
        </>
      )}
    </div>
  );
}

const THEME_NEXT: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function ThemeButton() {
  const theme = useStore((s) => s.theme);
  const label =
    theme === "system" ? t("Theme: follows Windows") : theme === "light" ? t("Theme: light") : t("Theme: dark");
  const Icon = theme === "dark" ? IconMoon : theme === "light" ? IconSun : IconMonitor;
  return (
    <button
      className="icon-btn bordered"
      aria-label={`${label}. ${t("Click to change.")}`}
      title={`${label} — ${t("click to change")}`}
      onClick={() => A.setTheme(THEME_NEXT[theme])}
    >
      <Icon size={16} />
    </button>
  );
}

function LanguageButton() {
  const lang = useStore((s) => s.lang);
  return (
    <button
      className="btn lang-btn"
      aria-label={lang === "fr" ? "Langue : français. Switch to English." : "Language: English. Passer en français."}
      title={lang === "fr" ? "Switch to English" : "Passer en français"}
      onClick={() => A.setLang(lang === "fr" ? "en" : "fr")}
    >
      {lang === "fr" ? "FR" : "EN"}
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
              aria-label={t("Undo (Ctrl+Z)")}
              title={t("Undo (Ctrl+Z)")}
              disabled={!doc.past.length}
              onClick={() => A.undo(doc.id)}
            >
              <IconUndo size={16} />
            </button>
            <button
              className="icon-btn"
              aria-label={t("Redo (Ctrl+Y)")}
              title={t("Redo (Ctrl+Y)")}
              disabled={!doc.future.length}
              onClick={() => A.redo(doc.id)}
            >
              <IconRedo size={16} />
            </button>
          </div>
        )}
        <LanguageButton />
        <ThemeButton />
        {showDoc && (
          <button
            className="btn btn-primary"
            disabled={!doc.dirty && !!doc.path}
            title={t("Save (Ctrl+S). Save a copy: Ctrl+Shift+S")}
            onClick={() => A.save(doc.id)}
          >
            {t("Save")}
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
        {t("Add pages from files")}
      </button>
      <button className="btn" onClick={() => A.openDialogFor("range", doc.id)}>
        {t("Select pages…")}
      </button>
      <label className="muted small slider">
        {t("Size")}
        <input
          type="range"
          min={100}
          max={280}
          step={10}
          value={size}
          aria-label={t("Thumbnail size")}
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
        {t("Add files")}
      </button>
      <button className="btn" onClick={A.combineSort}>
        {t("Sort by name")}
      </button>
    </div>
  );
}
