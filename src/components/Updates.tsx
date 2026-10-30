import * as A from "../actions";
import { lang, num, t } from "../i18n";
import { canUpdate } from "../lib/updater";
import { useStore } from "../store";
import { IconClose, IconDoc, IconUpload } from "./Icons";

/** Banner under the toolbar when a new version is available or installing. */
export function UpdateBanner() {
  const u = useStore((s) => s.update);
  const busy = u.status === "downloading" || u.status === "installing";
  if (!(u.status === "available" && !u.dismissed) && !busy) return null;
  const pct = typeof u.progress === "number" ? num(u.progress * 100) : null;
  return (
    <div className="update-banner" role="status">
      <IconUpload size={16} />
      {busy ? (
        <span className="grow">
          {u.status === "installing"
            ? t("Installing Folium {v}. Folium will restart…", { v: u.version ?? "" })
            : pct !== null
              ? t("Downloading Folium {v}… {pct}%", { v: u.version ?? "", pct })
              : t("Downloading Folium {v}…", { v: u.version ?? "" })}
        </span>
      ) : (
        <>
          <span className="grow">
            <span className="strong">{t("Folium {v} is available.", { v: u.version ?? "" })}</span>{" "}
            <button className="link-btn" onClick={A.openAbout}>
              {t("What's new")}
            </button>
          </span>
          <button className="btn btn-primary btn-compact" onClick={A.installUpdate}>
            {t("Install and restart")}
          </button>
          <button className="icon-btn" aria-label={t("Later")} title={t("Later")} onClick={A.dismissUpdate}>
            <IconClose size={14} />
          </button>
        </>
      )}
      {busy && pct !== null && (
        <span className="update-progress" aria-hidden="true">
          <span style={{ width: `${pct === null ? 0 : Math.round(u.progress! * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

function checkedText(at?: number): string {
  if (!at) return "";
  const time = new Date(at).toLocaleTimeString(lang() === "fr" ? "fr-FR" : "en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return t("Last checked at {time}.", { time });
}

/** "About and updates" window. */
export function AboutDialogBody() {
  const version = useStore((s) => s.appVersion);
  const u = useStore((s) => s.update);
  const auto = useStore((s) => s.autoUpdate);
  const updatable = canUpdate();

  let status: React.ReactNode = null;
  if (u.status === "checking") status = <span className="muted">{t("Checking for updates…")}</span>;
  else if (u.status === "none") status = <span>{t("Folium is up to date.")} <span className="muted">{checkedText(u.checkedAt)}</span></span>;
  else if (u.status === "error")
    status = (
      <span className="error-text">
        {t("Couldn't check for updates. Are you connected to the internet?")}
        {u.error ? <span className="muted small block">{u.error}</span> : null}
      </span>
    );
  else if (u.status === "available")
    status = <span className="strong">{t("Folium {v} is available.", { v: u.version ?? "" })}</span>;

  return (
    <>
      <div className="about-head">
        <span className="about-icon">
          <IconDoc size={26} />
        </span>
        <span>
          <span className="strong block about-name">Folium PDF</span>
          <span className="muted small">{version ? t("Version {v}", { v: version }) : ""}</span>
        </span>
      </div>
      <p className="muted small">{t("Free, ad-free and open source (GPL-3.0). Your files never leave this computer.")}</p>

      <div className="sep" />

      {updatable ? (
        <>
          <div className="update-status">{status}</div>
          {u.status === "available" && u.notes && (
            <div className="release-notes">
              <span className="muted small block">{t("What's new")}</span>
              <p>{u.notes}</p>
            </div>
          )}
          <label className="check">
            <input type="checkbox" checked={auto} onChange={(e) => A.setAutoUpdate(e.target.checked)} />
            {t("Check for updates when Folium starts")}
          </label>
          <p className="muted small">
            {t("Checking only asks GitHub for the latest version number. No files or personal data are sent. Updates are signed and verified before installing.")}
          </p>
        </>
      ) : (
        <p className="muted small">{t("Updates are available in the desktop app.")}</p>
      )}

      <div className="modal-buttons">
        <button className="btn" onClick={A.closeDialog}>
          {t("Close")}
        </button>
        {updatable &&
          (u.status === "available" ? (
            <button className="btn btn-primary" onClick={A.installUpdate}>
              {t("Install and restart")}
            </button>
          ) : (
            <button className="btn btn-primary" disabled={u.status === "checking"} onClick={() => A.checkUpdates(false)}>
              {t("Check for updates")}
            </button>
          ))}
      </div>
    </>
  );
}
