import { useEffect, useRef, useState, type ReactNode } from "react";
import * as A from "../actions";
import { parseRanges } from "../lib/pdf";
import { getState, useStore } from "../store";

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("input, button.btn-primary, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={ref}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Unsaved({ docId, resolve }: { docId: string; resolve: (v: "save" | "discard" | "cancel") => void }) {
  const name = useStore((s) => s.docs.find((d) => d.id === docId)?.name ?? "this file");
  return (
    <Modal title="Save your changes?" onClose={() => resolve("cancel")}>
      <p>“{name}” has changes that haven't been saved.</p>
      <div className="modal-buttons">
        <button className="btn" onClick={() => resolve("cancel")}>
          Cancel
        </button>
        <button className="btn" onClick={() => resolve("discard")}>
          Don't save
        </button>
        <button className="btn btn-primary" onClick={() => resolve("save")}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function Split({ docId }: { docId: string }) {
  const count = useStore((s) => s.docs.find((d) => d.id === docId)?.pages.length ?? 0);
  const [how, setHow] = useState<"every" | "ranges">("every");
  const [n, setN] = useState("1");
  const [ranges, setRanges] = useState("");
  const [error, setError] = useState<string | null>(null);

  const groups = (): number[][] => {
    if (how === "every") {
      const k = parseInt(n, 10);
      if (!k || k < 1) throw new Error("Enter a number of pages, 1 or more.");
      const g: number[][] = [];
      for (let i = 0; i < count; i += k) g.push(Array.from({ length: Math.min(k, count - i) }, (_, j) => i + j));
      return g;
    }
    return parseRanges(ranges, count);
  };

  let preview = "";
  try {
    const g = groups();
    preview = `Creates ${g.length} ${g.length === 1 ? "file" : "files"}.`;
  } catch {
    preview = "";
  }

  const go = () => {
    try {
      const g = groups();
      A.closeDialog();
      A.split(docId, g);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Split into files" onClose={A.closeDialog}>
      <div className="radio-list">
        <label className="check">
          <input type="radio" name="split" checked={how === "every"} onChange={() => setHow("every")} />
          Every
          <input
            className="input tiny"
            value={n}
            inputMode="numeric"
            aria-label="Pages per file"
            onFocus={() => setHow("every")}
            onChange={(e) => {
              setN(e.target.value);
              setError(null);
            }}
          />
          {n === "1" ? "page" : "pages"}
        </label>
        <label className="check">
          <input type="radio" name="split" checked={how === "ranges"} onChange={() => setHow("ranges")} />
          By ranges, one file each
        </label>
        <input
          className="input"
          placeholder="e.g. 1-3, 4-10, 11-"
          aria-label="Page ranges"
          value={ranges}
          onFocus={() => setHow("ranges")}
          onChange={(e) => {
            setRanges(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
      </div>
      <p className={error ? "error-text" : "muted small"}>{error ?? (preview || `This document has ${count} pages.`)}</p>
      <p className="muted small">You'll choose a folder next. Files are named “… - part 1.pdf”, “… - part 2.pdf”…</p>
      <div className="modal-buttons">
        <button className="btn" onClick={A.closeDialog}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={go}>
          Choose folder and split
        </button>
      </div>
    </Modal>
  );
}

function Range({ docId }: { docId: string }) {
  const count = useStore((s) => s.docs.find((d) => d.id === docId)?.pages.length ?? 0);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    const err = A.selectRange(docId, text);
    if (err) setError(err);
    else A.closeDialog();
  };
  return (
    <Modal title="Select pages" onClose={A.closeDialog}>
      <input
        className="input"
        placeholder={`e.g. 1-3, 7, 10-${count}`}
        aria-label="Pages to select"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <p className={error ? "error-text" : "muted small"}>
        {error ?? "Use commas between pages and a dash for ranges. “10-” means page 10 to the end."}
      </p>
      <div className="modal-buttons">
        <button
          className="btn"
          onClick={() => {
            A.selectAll(docId);
            A.closeDialog();
          }}
        >
          Select all
        </button>
        <span className="grow" />
        <button className="btn" onClick={A.closeDialog}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={go}>
          Select
        </button>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  if (dialog.type === "unsaved") return <Unsaved docId={dialog.docId} resolve={dialog.resolve} />;
  if (dialog.type === "split") return <Split docId={dialog.docId} />;
  if (dialog.type === "range") return <Range docId={dialog.docId} />;
  return null;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span>{t.text}</span>
          <button className="link-btn" onClick={() => A.dismissToast(t.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}

export function Busy() {
  const busy = useStore((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {busy}
    </div>
  );
}

/** True when a text field has focus, so single-key shortcuts don't fire. */
export function typing(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
}

export function anyDialog(): boolean {
  return getState().dialog !== null;
}
