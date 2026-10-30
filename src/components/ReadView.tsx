import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as A from "../actions";
import { formatBytes, t, tn } from "../i18n";
import { outlineFor, type OutlineNode } from "../lib/pdf";
import { useStore, type Doc } from "../store";
import { PageImage } from "./PageImage";
import {
  IconChevronDown,
  IconCombine,
  IconExtract,
  IconImage,
  IconLock,
  IconPlus,
  IconPrint,
  IconRotateLeft,
  IconRotateRight,
  IconSave,
  IconShrink,
  IconSplit,
  IconTrash,
} from "./Icons";

const BASE_WIDTH = 760;

/** Bookmarks of the document as it is now (after reordering and deleting). */
function useOutline(doc: Doc): OutlineNode[] {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  useEffect(() => {
    let alive = true;
    outlineFor(doc.pages, { keep: true }).then((o) => alive && setOutline(o));
    return () => {
      alive = false;
    };
  }, [doc.pages]);
  return outline;
}

function OutlineItem({ node, doc, depth }: { node: OutlineNode; doc: Doc; depth: number }) {
  const [open, setOpen] = useState(depth === 0 && node.children.length < 12);
  const active = node.page === doc.current;
  return (
    <li>
      <div className="outline-row" style={{ paddingLeft: 6 + depth * 14 }}>
        {node.children.length > 0 ? (
          <button
            className={`outline-toggle${open ? " is-open" : ""}`}
            aria-label={open ? t("Collapse") : t("Expand")}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <IconChevronDown size={13} />
          </button>
        ) : (
          <span className="outline-toggle" />
        )}
        <button
          className={`outline-link${active ? " is-active" : ""}`}
          disabled={node.page === null}
          onClick={() => node.page !== null && A.goToPage(doc.id, node.page)}
          title={node.title}
        >
          <span className="ellipsis grow">{node.title}</span>
          {node.page !== null && <span className="muted small">{node.page + 1}</span>}
        </button>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c, i) => (
            <OutlineItem key={i} node={c} doc={doc} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PageRail({ doc }: { doc: Doc }) {
  const listRef = useRef<HTMLDivElement>(null);
  const outline = useOutline(doc);
  const [tab, setTab] = useState<"pages" | "bookmarks">("pages");
  const showBookmarks = tab === "bookmarks" && outline.length > 0;
  const current = doc.pages[doc.current]?.key;
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-key="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, showBookmarks]);
  return (
    <section className={`panel rail${showBookmarks ? " wide" : ""}`} aria-label={t("Pages")}>
      {outline.length > 0 ? (
        <div className="rail-tabs" role="tablist">
          <button role="tab" aria-selected={!showBookmarks} onClick={() => setTab("pages")}>
            {t("Pages")}
          </button>
          <button role="tab" aria-selected={showBookmarks} onClick={() => setTab("bookmarks")}>
            {t("Bookmarks")}
          </button>
        </div>
      ) : (
        <div className="panel-head">
          <span className="panel-title">{t("Pages")}</span>
          <span className="muted small">{doc.pages.length}</span>
        </div>
      )}
      {showBookmarks ? (
        <ul className="outline" aria-label={t("Bookmarks")}>
          {outline.map((n, i) => (
            <OutlineItem key={i} node={n} doc={doc} depth={0} />
          ))}
        </ul>
      ) : (
        <div className="rail-list" ref={listRef}>
          {doc.pages.map((p, i) => {
            const selected = doc.selection.includes(p.key);
            const isCurrent = i === doc.current;
            return (
              <button
                key={p.key}
                data-key={p.key}
                className={`rail-item${selected ? " is-selected" : ""}${isCurrent ? " is-current" : ""}`}
                aria-label={selected ? t("Page {n}, selected", { n: i + 1 }) : t("Page {n}", { n: i + 1 })}
                aria-current={isCurrent ? "page" : undefined}
                onClick={(e) => {
                  A.selectPage(doc.id, p.key, e);
                  if (!e.ctrlKey && !e.shiftKey && !e.metaKey) A.goToPage(doc.id, i);
                }}
              >
                <span className="thumb-frame">
                  <PageImage srcId={p.srcId} index={p.srcIndex} rotation={p.rotation} width={96} margin="600px" />
                </span>
                <span className="small">{i + 1}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Viewer({ doc }: { doc: Doc }) {
  const zoom = useStore((s) => s.zoom);
  const jump = useStore((s) => s.jump);
  const scroller = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(BASE_WIDTH);

  // Fit the page to the window width when the window is narrow.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFit(Math.min(BASE_WIDTH, el.clientWidth - 64)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = Math.max(200, Math.round(fit * zoom));

  // Scroll to the current page when asked (page box, search, thumbnails).
  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>(`[data-index="${doc.current}"]`)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, doc.id]);

  // Keep the current page in sync while scrolling.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight * 0.35;
    let found = 0;
    for (const p of el.querySelectorAll<HTMLElement>("[data-index]")) {
      if (p.offsetTop <= mid) found = Number(p.dataset.index);
      else break;
    }
    if (found !== doc.current) A.setCurrent(doc.id, found);
  };

  return (
    <main
      className="panel viewer"
      ref={scroller}
      onScroll={onScroll}
      onWheel={(e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          A.setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        }
      }}
      aria-label={t("Document")}
    >
      <div className="viewer-pages">
        {doc.pages.map((p, i) => (
          <div key={p.key} data-index={i} className="viewer-page">
            <PageImage srcId={p.srcId} index={p.srcIndex} rotation={p.rotation} width={width} alt={t("Page {n}", { n: i + 1 })} />
          </div>
        ))}
      </div>
    </main>
  );
}

function ToolButton(props: {
  icon: typeof IconExtract;
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button className={`tool${props.danger ? " danger" : ""}`} onClick={props.onClick}>
      <Icon size={17} />
      <span className="grow">{props.label}</span>
      {props.shortcut && <span className="muted small">{props.shortcut}</span>}
    </button>
  );
}

function Tools({ doc }: { doc: Doc }) {
  const src = useStore((s) => s.sources[doc.primarySrc]);
  const n = doc.selection.length;
  const chip = n === 0 ? t("Page {n}", { n: doc.current + 1 }) : tn(n, "{n} page selected", "{n} pages selected");
  return (
    <aside className="panel tools" aria-label={t("Tools")}>
      <div className="tools-head">
        <span className="chip">{chip}</span>
        <button className="link-btn" onClick={() => A.openDialogFor("range", doc.id)}>
          {t("Select pages…")}
        </button>
      </div>
      <div className="tool-group">
        <span className="group-title">{t("Pages")}</span>
        <ToolButton icon={IconExtract} label={t("Extract to new file")} shortcut="Ctrl E" onClick={() => A.extract(doc.id)} />
        <ToolButton icon={IconRotateLeft} label={t("Rotate left")} shortcut={t("Shift R")} onClick={() => A.rotate(doc.id, -90)} />
        <ToolButton icon={IconRotateRight} label={t("Rotate right")} shortcut="R" onClick={() => A.rotate(doc.id, 90)} />
        <ToolButton icon={IconTrash} label={t("Delete")} shortcut={t("Del")} danger onClick={() => A.deletePages(doc.id)} />
      </div>
      <div className="sep" />
      <div className="tool-group">
        <span className="group-title">{t("Document")}</span>
        <ToolButton icon={IconCombine} label={t("Combine with other PDFs")} onClick={() => A.startCombine(doc.id)} />
        <ToolButton icon={IconPlus} label={t("Add pages from files")} onClick={() => A.insertFiles(doc.id)} />
        <ToolButton icon={IconSplit} label={t("Split into files…")} onClick={() => A.openDialogFor("split", doc.id)} />
        <ToolButton icon={IconShrink} label={t("Compress…")} onClick={() => A.openDialogFor("compress", doc.id)} />
        <ToolButton icon={IconLock} label={t("Protect with password…")} onClick={() => A.openDialogFor("protect", doc.id)} />
        <ToolButton icon={IconImage} label={t("Export as images…")} onClick={() => A.openDialogFor("export", doc.id)} />
        <ToolButton icon={IconPrint} label={t("Print…")} shortcut={t("Ctrl P")} onClick={() => A.printDoc(doc.id)} />
        <ToolButton icon={IconSave} label={t("Save a copy as…")} shortcut={t("Ctrl Shift S")} onClick={() => A.save(doc.id, true)} />
      </div>
      <div className="grow" />
      {src?.unlocked && (
        <p className="notice">
          <IconLock size={13} />
          {src.unlocked === "password"
            ? t("Opened with a password. You'll be asked whether to keep it when saving.")
            : t("Restrictions removed in Folium's copy.")}
        </p>
      )}
      <dl className="info">
        <dt>{t("Pages")}</dt>
        <dd>{doc.pages.length}</dd>
        {src && (
          <>
            <dt>{t("Size")}</dt>
            <dd>{formatBytes(src.size)}</dd>
            {src.version && (
              <>
                <dt>{t("Version")}</dt>
                <dd>PDF {src.version}</dd>
              </>
            )}
          </>
        )}
      </dl>
      <p className="offline">
        <IconLock size={12} />
        {t("Offline · files never leave this computer")}
      </p>
    </aside>
  );
}

export function ReadView({ doc }: { doc: Doc }) {
  return (
    <div className="workspace">
      <PageRail doc={doc} />
      <Viewer doc={doc} />
      <Tools doc={doc} />
    </div>
  );
}
