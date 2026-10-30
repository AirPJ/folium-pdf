import { useEffect, useRef, useState, type ReactNode } from "react";
import * as A from "../actions";
import { formatBytes, num, t, tn } from "../i18n";
import { parseRanges, type CompressLevel } from "../lib/pdf";
import { getState, useStore, type Dialog } from "../store";
import { IconEye, IconEyeOff, IconLock } from "./Icons";

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>("input:not([type=radio]):not([type=checkbox]), .btn-primary");
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
        className={`modal${wide ? " wide" : ""}`}
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

function Choice({ dialog }: { dialog: Extract<Dialog, { type: "choice" }> }) {
  const cancel = dialog.buttons.find((b) => b.value === "cancel")?.value ?? dialog.buttons[0].value;
  return (
    <Modal title={dialog.title} onClose={() => dialog.resolve(cancel)}>
      <p>{dialog.body}</p>
      <div className="modal-buttons">
        {dialog.buttons.map((b) => (
          <button key={b.value} className={`btn${b.primary ? " btn-primary" : ""}`} onClick={() => dialog.resolve(b.value)}>
            {b.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function PasswordField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={props.id} className="muted small">
        {props.label}
      </label>
      <div className="password-box">
        <input
          id={props.id}
          className="input"
          type={show ? "text" : "password"}
          value={props.value}
          autoComplete={props.autoComplete ?? "off"}
          onChange={(e) => props.onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && props.onEnter?.()}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={show ? t("Hide password") : t("Show password")}
          onClick={() => setShow(!show)}
        >
          {show ? <IconEyeOff size={16} /> : <IconEye size={16} />}
        </button>
      </div>
    </div>
  );
}

function PasswordPrompt({ dialog }: { dialog: Extract<Dialog, { type: "password" }> }) {
  const [pw, setPw] = useState("");
  const submit = () => dialog.resolve(pw);
  return (
    <Modal title={t("Password required")} onClose={() => dialog.resolve(null)}>
      <p>{t("“{name}” is protected. Enter its password to open it.", { name: dialog.fileName })}</p>
      <PasswordField id="open-pw" label={t("Password")} value={pw} onChange={setPw} onEnter={submit} />
      {dialog.error && <p className="error-text">{dialog.error}</p>}
      <div className="modal-buttons">
        <button className="btn" onClick={() => dialog.resolve(null)}>
          {t("Cancel")}
        </button>
        <button className="btn btn-primary" onClick={submit}>
          {t("Open")}
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
      if (!k || k < 1) throw new Error(t("Enter a number of pages, 1 or more."));
      const g: number[][] = [];
      for (let i = 0; i < count; i += k) g.push(Array.from({ length: Math.min(k, count - i) }, (_, j) => i + j));
      return g;
    }
    return parseRanges(ranges, count);
  };

  let preview = "";
  try {
    preview = tn(groups().length, "Creates {n} file.", "Creates {n} files.");
  } catch {
    preview = "";
  }

  const go = () => {
    try {
      const g = groups();
      A.closeDialog();
      A.split(docId, g);
    } catch (e) {
      setError(A.rangeMessage(e, count));
    }
  };

  return (
    <Modal title={t("Split into files")} onClose={A.closeDialog}>
      <div className="radio-list">
        <label className="check">
          <input type="radio" name="split" checked={how === "every"} onChange={() => setHow("every")} />
          {t("Every")}
          <input
            className="input tiny"
            value={n}
            inputMode="numeric"
            aria-label={t("Pages per file")}
            onFocus={() => setHow("every")}
            onChange={(e) => {
              setN(e.target.value);
              setError(null);
            }}
          />
          {parseInt(n, 10) > 1 ? t("pages") : t("page")}
        </label>
        <label className="check">
          <input type="radio" name="split" checked={how === "ranges"} onChange={() => setHow("ranges")} />
          {t("By ranges, one file each")}
        </label>
        <input
          className="input"
          placeholder={t("e.g. 1-3, 4-10, 11-")}
          aria-label={t("Page ranges")}
          value={ranges}
          onFocus={() => setHow("ranges")}
          onChange={(e) => {
            setRanges(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && go()}
        />
      </div>
      <p className={error ? "error-text" : "muted small"}>
        {error ?? (preview || tn(count, "This document has {n} page.", "This document has {n} pages."))}
      </p>
      <p className="muted small">{t("You'll choose a folder next. Files are named “… - part 1.pdf”, “… - part 2.pdf”…")}</p>
      <div className="modal-buttons">
        <button className="btn" onClick={A.closeDialog}>
          {t("Cancel")}
        </button>
        <button className="btn btn-primary" onClick={go}>
          {t("Choose folder and split")}
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
    <Modal title={t("Select pages")} onClose={A.closeDialog}>
      <input
        className="input"
        placeholder={t("e.g. 1-3, 7, 10-{n}", { n: count })}
        aria-label={t("Pages to select")}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <p className={error ? "error-text" : "muted small"}>
        {error ?? t("Use commas between pages and a dash for ranges. “10-” means page 10 to the end.")}
      </p>
      <div className="modal-buttons">
        <button
          className="btn"
          onClick={() => {
            A.selectAll(docId);
            A.closeDialog();
          }}
        >
          {t("Select all")}
        </button>
        <span className="grow" />
        <button className="btn" onClick={A.closeDialog}>
          {t("Cancel")}
        </button>
        <button className="btn btn-primary" onClick={go}>
          {t("Select")}
        </button>
      </div>
    </Modal>
  );
}

function Compress({ docId }: { docId: string }) {
  const [level, setLevel] = useState<CompressLevel>("balanced");
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<A.CompressResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const levels: { id: CompressLevel; title: string; text: string }[] = [
    { id: "light", title: t("Light"), text: t("Best quality. Large photos are lightly recompressed.") },
    { id: "balanced", title: t("Balanced"), text: t("Good for sharing by email. Photos stay sharp on screen.") },
    { id: "strong", title: t("Strong"), text: t("Smallest file. Photos lose detail; text is not affected.") },
  ];
  const run = async () => {
    setResult(null);
    setError(null);
    try {
      setResult(await A.compressDoc(docId, level, setProgress));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };
  const saved = result ? 1 - result.bytes.length / result.before : 0;
  const worthIt = result !== null && saved > 0.02;
  return (
    <Modal title={t("Compress")} onClose={() => !progress && A.closeDialog()}>
      <div className="option-list" role="radiogroup" aria-label={t("Compression level")}>
        {levels.map((l) => (
          <label key={l.id} className={`option${level === l.id ? " is-on" : ""}`}>
            <input
              type="radio"
              name="level"
              checked={level === l.id}
              disabled={!!progress}
              onChange={() => {
                setLevel(l.id);
                setResult(null);
              }}
            />
            <span>
              <span className="strong">{l.title}</span>
              <span className="muted small block">{l.text}</span>
            </span>
          </label>
        ))}
      </div>
      {progress && (
        <p className="progress-line">
          <span className="spinner" aria-hidden="true" />
          {progress}
        </p>
      )}
      {result && (
        <div className="result-box" role="status">
          <span className="readout-num small-num">{formatBytes(result.bytes.length)}</span>
          <span className="muted small">
            {worthIt
              ? t("from {before} ({pct}% smaller)", { before: formatBytes(result.before), pct: num(saved * 100) })
              : t("This file is already compact. Compressing won't make it noticeably smaller.")}
          </span>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <p className="muted small">{t("The original file is not changed. You'll choose where to save the smaller copy.")}</p>
      <div className="modal-buttons">
        <button className="btn" disabled={!!progress} onClick={A.closeDialog}>
          {t("Cancel")}
        </button>
        {worthIt ? (
          <button
            className="btn btn-primary"
            onClick={async () => {
              if (await A.saveCompressed(docId, result!)) A.closeDialog();
            }}
          >
            {t("Save compressed copy…")}
          </button>
        ) : (
          <button className="btn btn-primary" disabled={!!progress} onClick={run}>
            {t("Compress")}
          </button>
        )}
      </div>
    </Modal>
  );
}

function Protect({ docId }: { docId: string }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [print, setPrint] = useState(true);
  const [copy, setCopy] = useState(true);
  const [edit, setEdit] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (pw.length < 4) return setError(t("Use at least 4 characters."));
    if (pw !== pw2) return setError(t("The two passwords don't match."));
    if (await A.protect(docId, { password: pw, allowPrint: print, allowCopy: copy, allowEdit: edit })) A.closeDialog();
  };
  return (
    <Modal title={t("Protect with password")} onClose={A.closeDialog}>
      <p className="muted small">
        {t("Saves a copy that asks for this password when opened. It's encrypted with AES-256.")}
      </p>
      <PasswordField id="pw1" label={t("Password")} value={pw} onChange={(v) => (setPw(v), setError(null))} autoComplete="new-password" />
      <PasswordField
        id="pw2"
        label={t("Confirm password")}
        value={pw2}
        onChange={(v) => (setPw2(v), setError(null))}
        onEnter={go}
        autoComplete="new-password"
      />
      <fieldset className="checks">
        <legend className="muted small">{t("People who open it can:")}</legend>
        <label className="check">
          <input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} />
          {t("Print")}
        </label>
        <label className="check">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          {t("Copy text and images")}
        </label>
        <label className="check">
          <input type="checkbox" checked={edit} onChange={(e) => setEdit(e.target.checked)} />
          {t("Edit, annotate and change pages")}
        </label>
      </fieldset>
      {error && <p className="error-text">{error}</p>}
      <p className="notice">
        <IconLock size={13} />
        {t("Keep the password somewhere safe: there is no way to recover it.")}
      </p>
      <div className="modal-buttons">
        <button className="btn" onClick={A.closeDialog}>
          {t("Cancel")}
        </button>
        <button className="btn btn-primary" onClick={go}>
          {t("Save protected copy…")}
        </button>
      </div>
    </Modal>
  );
}

function Export({ docId }: { docId: string }) {
  const doc = useStore((s) => s.docs.find((d) => d.id === docId));
  const [which, setWhich] = useState<"current" | "selected" | "all">(
    doc && doc.selection.length > 1 ? "selected" : "current",
  );
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [dpi, setDpi] = useState(150);
  if (!doc) return null;
  const count = which === "all" ? doc.pages.length : which === "selected" ? doc.selection.length : 1;
  return (
    <Modal title={t("Export as images")} onClose={A.closeDialog}>
      <fieldset className="checks">
        <legend className="muted small">{t("Pages")}</legend>
        <label className="check">
          <input type="radio" name="which" checked={which === "current"} onChange={() => setWhich("current")} />
          {t("Current page ({n})", { n: doc.current + 1 })}
        </label>
        <label className="check">
          <input
            type="radio"
            name="which"
            disabled={!doc.selection.length}
            checked={which === "selected"}
            onChange={() => setWhich("selected")}
          />
          {tn(doc.selection.length, "Selected page ({n})", "Selected pages ({n})")}
        </label>
        <label className="check">
          <input type="radio" name="which" checked={which === "all"} onChange={() => setWhich("all")} />
          {t("All pages ({n})", { n: doc.pages.length })}
        </label>
      </fieldset>
      <div className="two-cols">
        <div className="field">
          <label htmlFor="fmt" className="muted small">
            {t("Format")}
          </label>
          <select id="fmt" className="input" value={format} onChange={(e) => setFormat(e.target.value as "png" | "jpeg")}>
            <option value="png">{t("PNG (sharp, larger)")}</option>
            <option value="jpeg">{t("JPEG (photos, smaller)")}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="dpi" className="muted small">
            {t("Resolution")}
          </label>
          <select id="dpi" className="input" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
            <option value={72}>{t("72 DPI (screen)")}</option>
            <option value={150}>{t("150 DPI (standard)")}</option>
            <option value={300}>{t("300 DPI (print)")}</option>
          </select>
        </div>
      </div>
      <p className="muted small">{t("You'll choose a folder next.")}</p>
      <div className="modal-buttons">
        <button className="btn" onClick={A.closeDialog}>
          {t("Cancel")}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            A.closeDialog();
            A.exportImages(docId, which, format, dpi);
          }}
        >
          {tn(count, "Export {n} image…", "Export {n} images…")}
        </button>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case "choice":
      return <Choice dialog={dialog} />;
    case "password":
      return <PasswordPrompt dialog={dialog} />;
    case "split":
      return <Split docId={dialog.docId} />;
    case "range":
      return <Range docId={dialog.docId} />;
    case "compress":
      return <Compress docId={dialog.docId} />;
    case "protect":
      return <Protect docId={dialog.docId} />;
    case "export":
      return <Export docId={dialog.docId} />;
  }
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.kind}`}>
          <span>{x.text}</span>
          <button className="link-btn" onClick={() => A.dismissToast(x.id)}>
            {t("Dismiss")}
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
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
}

export function anyDialog(): boolean {
  return getState().dialog !== null;
}
