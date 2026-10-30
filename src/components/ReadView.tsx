import { useEffect, useLayoutEffect, useRef, useState } from "react";
import * as A from "../actions";
import { formatBytes } from "../lib/pdf";
import { useStore, type Doc } from "../store";
import { PageImage } from "./PageImage";
import {
  IconCombine,
  IconExtract,
  IconLock,
  IconPlus,
  IconRotateLeft,
  IconRotateRight,
  IconSave,
  IconSplit,
  IconTrash,
} from "./Icons";

const BASE_WIDTH = 760;

function PageRail({ doc }: { doc: Doc }) {
  const listRef = useRef<HTMLDivElement>(null);
  const current = doc.pages[doc.current]?.key;
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-key="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);
  return (
    <section className="panel rail" aria-label="Pages">
      <div className="panel-head">
        <span className="panel-title">Pages</span>
        <span className="muted small">{doc.pages.length}</span>
      </div>
      <div className="rail-list" ref={listRef}>
        {doc.pages.map((p, i) => {
          const selected = doc.selection.includes(p.key);
          const isCurrent = i === doc.current;
          return (
            <button
              key={p.key}
              data-key={p.key}
              className={`rail-item${selected ? " is-selected" : ""}${isCurrent ? " is-current" : ""}`}
              aria-label={`Page ${i + 1}${selected ? ", selected" : ""}`}
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
    const el = scroller.current?.querySelector<HTMLElement>(`[data-index="${doc.current}"]`);
    el?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, doc.id]);

  // Keep the current page in sync while scrolling.
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight * 0.35;
    const pages = el.querySelectorAll<HTMLElement>("[data-index]");
    let found = 0;
    for (const p of pages) {
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
      aria-label="Document"
    >
      <div className="viewer-pages">
        {doc.pages.map((p, i) => (
          <div key={p.key} data-index={i} className="viewer-page">
            <PageImage
              srcId={p.srcId}
              index={p.srcIndex}
              rotation={p.rotation}
              width={width}
              alt={`Page ${i + 1}`}
            />
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
  const chip = n === 0 ? `Page ${doc.current + 1}` : n === 1 ? "1 page selected" : `${n} pages selected`;
  return (
    <aside className="panel tools" aria-label="Tools">
      <div className="tools-head">
        <span className="chip">{chip}</span>
        <button className="link-btn" onClick={() => A.openDialogFor("range", doc.id)}>
          Select pages…
        </button>
      </div>
      <div className="tool-group">
        <span className="group-title">Pages</span>
        <ToolButton icon={IconExtract} label="Extract to new file" shortcut="Ctrl E" onClick={() => A.extract(doc.id)} />
        <ToolButton icon={IconRotateLeft} label="Rotate left" shortcut="Shift R" onClick={() => A.rotate(doc.id, -90)} />
        <ToolButton icon={IconRotateRight} label="Rotate right" shortcut="R" onClick={() => A.rotate(doc.id, 90)} />
        <ToolButton icon={IconTrash} label="Delete" shortcut="Del" danger onClick={() => A.deletePages(doc.id)} />
      </div>
      <div className="sep" />
      <div className="tool-group">
        <span className="group-title">Document</span>
        <ToolButton icon={IconCombine} label="Combine with other PDFs" onClick={() => A.startCombine(doc.id)} />
        <ToolButton icon={IconPlus} label="Add pages from files" onClick={() => A.insertFiles(doc.id)} />
        <ToolButton icon={IconSplit} label="Split into files…" onClick={() => A.openDialogFor("split", doc.id)} />
        <ToolButton icon={IconSave} label="Save a copy as…" shortcut="Ctrl Shift S" onClick={() => A.save(doc.id, true)} />
      </div>
      <div className="grow" />
      <dl className="info">
        <dt>Pages</dt>
        <dd>{doc.pages.length}</dd>
        {src && (
          <>
            <dt>Size</dt>
            <dd>{formatBytes(src.size)}</dd>
            {src.version && (
              <>
                <dt>Version</dt>
                <dd>PDF {src.version}</dd>
              </>
            )}
          </>
        )}
      </dl>
      <p className="offline">
        <IconLock size={12} />
        Offline · files never leave this computer
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
