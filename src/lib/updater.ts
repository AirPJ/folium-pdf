// In-app updates. Folium asks GitHub for latest.json (the newest version
// number, its notes and a download link). Downloads are signed: the updater
// refuses any file whose signature doesn't match the public key built into
// the app. Nothing about the user or their files is sent.

import { isDesktop } from "./platform";

export interface UpdateInfo {
  version: string;
  notes: string;
  date?: string;
}

/** For tests in a plain browser: window.__foliumTestUpdate simulates an update. */
interface TestHook {
  info: UpdateInfo | null;
  fail?: string;
  installed?: boolean;
}
declare global {
  interface Window {
    __foliumTestUpdate?: TestHook;
  }
}

type Pending = { downloadAndInstall: (cb: (e: DownloadEvent) => void) => Promise<void> };
type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished" };

let pending: Pending | null = null;

export async function appVersion(): Promise<string> {
  if (!isDesktop) return __APP_VERSION__;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

/** True where updates can be installed from inside the app. */
export const canUpdate = () => isDesktop || !!window.__foliumTestUpdate;

/** Returns the available update, or null if Folium is up to date. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const hook = window.__foliumTestUpdate;
  if (!isDesktop && hook) {
    await new Promise((r) => setTimeout(r, 300));
    if (hook.fail) throw new Error(hook.fail);
    pending = hook.info
      ? {
          downloadAndInstall: async (cb) => {
            cb({ event: "Started", data: { contentLength: 1000 } });
            for (let i = 0; i < 4; i++) {
              await new Promise((r) => setTimeout(r, 150));
              cb({ event: "Progress", data: { chunkLength: 250 } });
            }
            cb({ event: "Finished" });
            hook.installed = true;
          },
        }
      : null;
    return hook.info;
  }
  if (!isDesktop) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 20_000 });
  pending = update;
  if (!update) return null;
  return { version: update.version, notes: update.body ?? "", date: update.date };
}

/** Downloads and installs the update found by checkForUpdate, then restarts. */
export async function installUpdate(onProgress: (fraction: number | null) => void): Promise<void> {
  if (!pending) throw new Error("No update to install.");
  let total = 0;
  let done = 0;
  await pending.downloadAndInstall((e) => {
    if (e.event === "Started") total = e.data.contentLength ?? 0;
    else if (e.event === "Progress") {
      done += e.data.chunkLength;
      onProgress(total ? Math.min(1, done / total) : null);
    } else onProgress(1);
  });
  if (isDesktop) {
    // On Windows the installer closes and reopens Folium by itself; this is
    // for the other platforms.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  }
}
