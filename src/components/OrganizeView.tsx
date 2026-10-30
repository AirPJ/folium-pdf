import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState } from "react";
import * as A from "../actions";
import { t, tn } from "../i18n";
import { useStore, type Doc, type PageRef } from "../store";
import { PageImage } from "./PageImage";
import {
  IconCheck,
  IconClose,
  IconDuplicate,
  IconExtract,
  IconRotateLeft,
  IconRotateRight,
  IconTrash,
} from "./Icons";

function Tile({ doc, page, index, width }: { doc: Doc; page: PageRef; index: number; width: number }) {
  const selected = doc.selection.includes(page.key);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.key });
  return (
    <div
      ref={setNodeRef}
      className={`tile${selected ? " is-selected" : ""}${isDragging ? " is-dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, width: width + 16 }}
    >
      <button
        {...attributes}
        {...listeners}
        className="tile-hit"
        aria-label={`${selected ? t("Page {n}, selected", { n: index + 1 }) : t("Page {n}", { n: index + 1 })}. ${t("Drag to move, double-click to read.")}`}
        aria-pressed={selected}
        onClick={(e) => {
          e.stopPropagation();
          A.selectPage(doc.id, page.key, e);
        }}
        onDoubleClick={() => {
          A.goToPage(doc.id, index);
          A.setMode("read");
        }}
      >
        <span className="tile-frame">
          <PageImage srcId={page.srcId} index={page.srcIndex} rotation={page.rotation} width={width} />
          {selected && (
            <span className="tile-check">
              <IconCheck size={13} strokeWidth={3} />
            </span>
          )}
          {page.rotation !== 0 && (
            <span className="tile-badge">
              <IconRotateRight size={11} strokeWidth={2.4} />
              {page.rotation}°
            </span>
          )}
        </span>
        <span className="tile-num">{index + 1}</span>
      </button>
    </div>
  );
}

function ActionBar({ doc }: { doc: Doc }) {
  const n = doc.selection.length;
  if (!n) return null;
  return (
    <div className="action-bar" role="toolbar" aria-label={t("Selected pages")} onClick={(e) => e.stopPropagation()}>
      <span className="action-count">{tn(n, "{n} page", "{n} pages")}</span>
      <div className="vsep" />
      <button onClick={() => A.extract(doc.id)}>
        <IconExtract size={16} />
        {t("Extract")}<kbd>Ctrl E</kbd>
      </button>
      <button onClick={() => A.duplicatePages(doc.id)}>
        <IconDuplicate size={16} />
        {t("Duplicate")}<kbd>Ctrl D</kbd>
      </button>
      <button onClick={() => A.rotate(doc.id, -90)} aria-label={t("Rotate left (Shift+R)")} title={t("Rotate left (Shift+R)")}>
        <IconRotateLeft size={16} />
      </button>
      <button onClick={() => A.rotate(doc.id, 90)} aria-label={t("Rotate right (R)")} title={t("Rotate right (R)")}>
        <IconRotateRight size={16} />
      </button>
      <button className="danger" onClick={() => A.deletePages(doc.id)}>
        <IconTrash size={16} />
        {t("Delete")}<kbd>{t("Del")}</kbd>
      </button>
      <div className="vsep" />
      <button aria-label={t("Clear selection (Esc)")} title={t("Clear selection (Esc)")} onClick={() => A.setSelection(doc.id, [])}>
        <IconClose size={14} />
      </button>
    </div>
  );
}

export function OrganizeView({ doc }: { doc: Doc }) {
  const width = useStore((s) => s.thumbSize);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onStart = (e: DragStartEvent) => setDragging(String(e.active.id));
  const onEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (e.over) A.movePages(doc.id, String(e.active.id), String(e.over.id));
  };

  const dragPage = dragging ? doc.pages.find((p) => p.key === dragging) : null;
  const dragCount = dragging && doc.selection.includes(dragging) ? doc.selection.length : 1;

  return (
    <div className="workspace">
      <main className="panel organizer" aria-label={t("Pages")}>
        <div className="organizer-scroll" onClick={() => A.setSelection(doc.id, [])}>
        <p className="hint muted small">
          {t("Click to select · Ctrl or Shift for several · drag to reorder · double-click to read")}
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
          <SortableContext items={doc.pages.map((p) => p.key)} strategy={rectSortingStrategy}>
            <div className="tile-grid">
              {doc.pages.map((p, i) => (
                <Tile key={p.key} doc={doc} page={p} index={i} width={width} />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {dragPage && (
              <div className="drag-ghost">
                <PageImage srcId={dragPage.srcId} index={dragPage.srcIndex} rotation={dragPage.rotation} width={width} />
                {dragCount > 1 && <span className="drag-count">{dragCount}</span>}
              </div>
            )}
          </DragOverlay>
        </DndContext>
        </div>
        <ActionBar doc={doc} />
      </main>
    </div>
  );
}
