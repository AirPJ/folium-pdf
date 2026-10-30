import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as A from "../actions";
import { formatBytes } from "../lib/pdf";
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
      <button className="grip" aria-label={`Move ${src.name}`} {...attributes} {...listeners}>
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
          {pages} {pages === 1 ? "page" : "pages"} · {formatBytes(src.size)}
        </span>
      </span>
      <input
        type="checkbox"
        checked={item.included}
        aria-label={`Include ${src.name}`}
        onChange={(e) => A.combineUpdate(item.id, (i) => ({ ...i, included: e.target.checked }))}
      />
      <button className="icon-btn small-btn" aria-label={`Remove ${src.name}`} onClick={() => A.combineRemove(item.id)}>
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
    <section className="panel files" aria-label="Files">
      <div className="panel-head">
        <span className="panel-title">Files</span>
        <span className="muted small">{items.length > 1 ? `${items.length} · drag to reorder` : items.length}</span>
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
          Drop PDFs here or <span className="link">browse</span>
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
          {kept === total ? `all ${total} pages` : `${kept} of ${total} pages`}
        </span>
        <span className="grow" />
        {item.skipped.length > 0 && (
          <button className="btn btn-compact" onClick={() => A.combineUpdate(item.id, (it) => ({ ...it, skipped: [] }))}>
            Include all
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
              aria-label={`Page ${i + 1}: ${skipped ? "skipped" : "included"}. Click to ${skipped ? "include" : "skip"}.`}
              onClick={() => toggle(i)}
            >
              <span className="mini-frame">
                <PageImage srcId={item.srcId} index={i} rotation={0} width={84} />
                {skipped && <span className="skip-overlay">Skipped</span>}
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
    <aside className="panel output" aria-label="Output">
      <span className="panel-title">Output</span>
      <div className="field">
        <label htmlFor="out-name" className="muted small">
          File name
        </label>
        <input
          id="out-name"
          className="input"
          value={c.outputName}
          onChange={(e) => A.combineSet({ outputName: e.target.value })}
        />
      </div>
      <div className="readout">
        <span className="readout-num">{pages}</span>
        <span className="muted small">
          {pages === 1 ? "page" : "pages"} from {files} {files === 1 ? "file" : "files"}
        </span>
      </div>
      <label className="check">
        <input type="checkbox" checked={c.openAfter} onChange={(e) => A.combineSet({ openAfter: e.target.checked })} />
        Open the result when done
      </label>
      <p className="muted small">Click a page to skip it. Drag files on the left to change their order.</p>
      <div className="grow" />
      <button className="btn btn-primary btn-large" disabled={!pages || c.busy} onClick={A.runCombine}>
        {c.busy ? "Combining…" : `Combine ${pages} ${pages === 1 ? "page" : "pages"}`}
      </button>
      <p className="offline center">
        <IconLock size={12} />
        Processed on this computer
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
      <main className="panel combine-pages" aria-label="Pages to combine">
        {included.length === 0 ? (
          <div className="empty-hint">
            <IconUpload size={28} />
            <p className="strong">Add the PDFs you want to combine</p>
            <p className="muted">Drop them anywhere in this window, or use Add files.</p>
            <button className="btn btn-primary" onClick={A.combineAddFiles}>
              Add files
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
