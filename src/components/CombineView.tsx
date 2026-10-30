import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as A from "../actions";
import { formatBytes, t, tn } from "../i18n";
import { useStore, type CombineItem } from "../store";
import { PageImage } from "./PageImage";
import { IconClose, IconGrip, IconLock, IconUpload } from "./Icons";

function FileRow({ item, index }: { item: CombineItem; index: number }) {
  const src = useStore((s) => s.sources[item.srcId]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  if (!src) return null;
  const pages = src.sizes.length;
  return (
    <div
      ref={setNodeRef}
      className={`file-row${item.included ? " is-on" : ""}${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button {...attributes} {...listeners} className="grip" aria-label={t("Move {name}", { name: src.name })}>
        <IconGrip />
      </button>
      <span className="file-num">{index + 1}</span>
      <span className="file-thumb">
        <PageImage srcId={item.srcId} index={0} rotation={0} width={34} />
      </span>
      <span className="file-text">
        <span className="file-name" title={src.path ?? src.name}>
          {src.name}
        </span>
        <span className="muted small">
          {tn(pages, "{n} page", "{n} pages")} · {formatBytes(src.size)}
        </span>
      </span>
      <input
        type="checkbox"
        checked={item.included}
        aria-label={t("Include {name}", { name: src.name })}
        onChange={(e) => A.combineUpdate(item.id, (i) => ({ ...i, included: e.target.checked }))}
      />
      <button className="icon-btn small-btn" aria-label={t("Remove {name}", { name: src.name })} onClick={() => A.combineRemove(item.id)}>
        <IconClose size={12} />
      </button>
    </div>
  );
}

function FileList() {
  const items = useStore((s) => s.combine.items);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <section className="panel files" aria-label={t("Files")}>
      <div className="panel-head">
        <span className="panel-title">{t("Files")}</span>
        <span className="muted small">{items.length > 1 ? t("{n} · drag to reorder", { n: items.length }) : items.length}</span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => e.over && A.combineMove(String(e.active.id), String(e.over.id))}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="file-list">
            {items.map((it, i) => (
              <FileRow key={it.id} item={it} index={i} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button className="drop-zone" onClick={A.combineAddFiles}>
        <IconUpload size={22} />
        <span>
          {t("Drop PDFs here or")} <span className="link">{t("browse")}</span>
        </span>
      </button>
    </section>
  );
}

function FilePages({ item, index }: { item: CombineItem; index: number }) {
  const src = useStore((s) => s.sources[item.srcId]);
  if (!src) return null;
  const total = src.sizes.length;
  const kept = total - item.skipped.length;
  const toggle = (i: number) =>
    A.combineUpdate(item.id, (it) => ({
      ...it,
      skipped: it.skipped.includes(i) ? it.skipped.filter((x) => x !== i) : [...it.skipped, i],
    }));
  return (
    <div className="file-pages">
      <div className="file-pages-head">
        <span className="num-badge">{index + 1}</span>
        <span className="strong">{src.name}</span>
        <span className="muted small">
          {kept === total ? tn(total, "{n} page", "all {n} pages") : t("{kept} of {n} pages", { kept, n: total })}
        </span>
        <span className="grow" />
        {item.skipped.length > 0 && (
          <button className="btn btn-compact" onClick={() => A.combineUpdate(item.id, (it) => ({ ...it, skipped: [] }))}>
            {t("Include all")}
          </button>
        )}
      </div>
      <div className="mini-pages">
        {src.sizes.map((_, i) => {
          const skipped = item.skipped.includes(i);
          return (
            <button
              key={i}
              className={`mini-page${skipped ? " is-skipped" : ""}`}
              aria-pressed={!skipped}
              aria-label={
                skipped
                  ? t("Page {n}: skipped. Click to include.", { n: i + 1 })
                  : t("Page {n}: included. Click to skip.", { n: i + 1 })
              }
              onClick={() => toggle(i)}
            >
              <span className="mini-frame">
                <PageImage srcId={item.srcId} index={i} rotation={0} width={84} />
                {skipped && <span className="skip-overlay">{t("Skipped")}</span>}
              </span>
              <span className="small muted">{i + 1}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Output() {
  const c = useStore((s) => s.combine);
  const sources = useStore((s) => s.sources);
  const included = c.items.filter((i) => i.included);
  const pages = included.reduce((n, i) => n + (sources[i.srcId]?.sizes.length ?? 0) - i.skipped.length, 0);
  const files = included.filter((i) => (sources[i.srcId]?.sizes.length ?? 0) > i.skipped.length).length;
  return (
    <aside className="panel output" aria-label={t("Output")}>
      <span className="panel-title">{t("Output")}</span>
      <div className="field">
        <label htmlFor="out-name" className="muted small">
          {t("File name")}
        </label>
        <input id="out-name" className="input" value={c.outputName} onChange={(e) => A.combineSet({ outputName: e.target.value })} />
      </div>
      <div className="readout">
        <span className="readout-num">{pages}</span>
        <span className="muted small">{tn(pages, "page", "pages")} · {tn(files, "from {n} file", "from {n} files")}</span>
      </div>
      <div className="checks">
        <label className="check">
          <input type="checkbox" checked={c.keepBookmarks} onChange={(e) => A.combineSet({ keepBookmarks: e.target.checked })} />
          {t("Keep existing bookmarks")}
        </label>
        <label className="check">
          <input type="checkbox" checked={c.fileBookmarks} onChange={(e) => A.combineSet({ fileBookmarks: e.target.checked })} />
          {t("Add a bookmark for each file")}
        </label>
        <label className="check">
          <input type="checkbox" checked={c.openAfter} onChange={(e) => A.combineSet({ openAfter: e.target.checked })} />
          {t("Open the result when done")}
        </label>
      </div>
      <p className="muted small">{t("Click a page to skip it. Drag files on the left to change their order.")}</p>
      <div className="grow" />
      <button className="btn btn-primary btn-large" disabled={!pages || c.busy} onClick={A.runCombine}>
        {c.busy ? t("Combining…") : tn(pages, "Combine {n} page", "Combine {n} pages")}
      </button>
      <p className="offline center">
        <IconLock size={12} />
        {t("Processed on this computer")}
      </p>
    </aside>
  );
}

export function CombineView() {
  const items = useStore((s) => s.combine.items);
  const included = items.filter((i) => i.included);
  return (
    <div className="workspace">
      <FileList />
      <main className="panel combine-pages" aria-label={t("Pages to combine")}>
        {included.length === 0 ? (
          <div className="empty-hint">
            <IconUpload size={28} />
            <p className="strong">{t("Add the PDFs you want to combine")}</p>
            <p className="muted">{t("Drop them anywhere in this window, or use Add files.")}</p>
            <button className="btn btn-primary" onClick={A.combineAddFiles}>
              {t("Add files")}
            </button>
          </div>
        ) : (
          items.map((it, i) => (it.included ? <FilePages key={it.id} item={it} index={i} /> : null))
        )}
      </main>
      <Output />
    </div>
  );
}
