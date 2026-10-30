import { useState } from "react";
import * as A from "../actions";
import { lang, t } from "../i18n";
import { isDesktop } from "../lib/platform";
import { IconCombine, IconDoc, IconLock, IconUpload } from "./Icons";

function when(at: number): string {
  const d = new Date(at);
  const locale = lang() === "fr" ? "fr-FR" : "en-GB";
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days === 0) return t("Today {time}", { time: d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) });
  if (days === 1) return t("Yesterday");
  return d.toLocaleDateString(locale);
}

export function Welcome() {
  const [recent] = useState(A.recentFiles);
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <h1>{t("Open a PDF to get started")}</h1>
        <p className="muted">{t("Read, organize and combine PDFs. Everything stays on this computer.")}</p>
        <div className="welcome-actions">
          <button className="big-action" onClick={A.openDialog}>
            <span className="big-icon">
              <IconDoc size={22} />
            </span>
            <span className="strong">{t("Open PDF")}</span>
            <span className="muted small">Ctrl+O</span>
          </button>
          <button className="big-action" onClick={() => A.startCombine()}>
            <span className="big-icon">
              <IconCombine size={22} />
            </span>
            <span className="strong">{t("Combine files")}</span>
            <span className="muted small">{t("Join several PDFs into one")}</span>
          </button>
        </div>
        <button className="drop-zone wide" onClick={A.openDialog}>
          <IconUpload size={22} />
          <span>{isDesktop ? t("Or drop PDF files anywhere in this window") : t("Or choose PDF files")}</span>
        </button>
        {recent.length > 0 && (
          <section className="recent" aria-label={t("Recent files")}>
            <h2>{t("Recent")}</h2>
            <ul>
              {recent.slice(0, 8).map((r) => (
                <li key={r.path}>
                  <button className="recent-item" title={r.path} onClick={() => A.openPaths([r.path])}>
                    <IconDoc size={16} />
                    <span className="grow ellipsis">{r.name}</span>
                    <span className="muted small nowrap">{when(r.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="offline center">
          <IconLock size={12} />
          {t("No account, no uploads, no ads")}
        </p>
      </div>
    </div>
  );
}
