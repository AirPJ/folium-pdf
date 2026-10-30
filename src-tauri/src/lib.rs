//! Folium PDF — native side.
//!
//! The interface displays and edits PDFs itself (PDF.js and pdf-lib). This
//! layer reads and writes files, and uses qpdf for passwords and lossless
//! optimisation. Documents never leave the computer.

mod access;
mod pdfops;

use access::Access;

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(data) => Ok(data.clone()),
        _ => Err("Internal error: expected binary data".into()),
    }
}

/// Reads a URL-encoded header (headers can only carry ASCII).
fn header(request: &Request<'_>, name: &str) -> Option<String> {
    let v = request.headers().get(name)?.to_str().ok()?;
    urlencoding::decode(v).ok().map(|s| s.into_owned())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("failed: {e}"))?
}

/// Whether a PDF is encrypted (needs a password or carries restrictions).
#[tauri::command]
async fn pdf_is_encrypted(request: Request<'_>) -> Result<bool, String> {
    let data = raw_body(&request)?;
    blocking(move || Ok(pdfops::is_encrypted(&data))).await
}

/// Returns an unencrypted copy, using the password in the `x-password` header.
#[tauri::command]
async fn pdf_unlock(request: Request<'_>) -> Result<Response, String> {
    let data = raw_body(&request)?;
    let password = header(&request, "x-password").unwrap_or_default();
    blocking(move || pdfops::unlock(&data, &password)).await.map(Response::new)
}

/// Encrypts with AES-256. Options come in headers.
#[tauri::command]
async fn pdf_protect(request: Request<'_>) -> Result<Response, String> {
    let data = raw_body(&request)?;
    let p = pdfops::Protection {
        open_password: header(&request, "x-password").unwrap_or_default(),
        allow_print: header(&request, "x-allow-print").as_deref() == Some("1"),
        allow_copy: header(&request, "x-allow-copy").as_deref() == Some("1"),
        allow_edit: header(&request, "x-allow-edit").as_deref() == Some("1"),
    };
    if p.open_password.is_empty() {
        return Err("failed: empty password".into());
    }
    blocking(move || pdfops::protect(&data, &p)).await.map(Response::new)
}

/// Lossless size reduction.
#[tauri::command]
async fn pdf_optimize(request: Request<'_>) -> Result<Response, String> {
    let data = raw_body(&request)?;
    blocking(move || pdfops::optimize(&data)).await.map(Response::new)
}

/// Reads a PDF and returns its raw bytes (sent to the interface as binary,
/// not JSON, so large PDFs stay fast). See `access.rs` for what is allowed.
#[tauri::command]
fn read_file(path: String, access: State<'_, Access>) -> Result<Response, String> {
    let path = PathBuf::from(path);
    access.check_read(&path)?;
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    // The user opened it: saving it in place is allowed.
    access.grant_file(&path);
    Ok(Response::new(data))
}

/// Writes raw bytes to the path given in the `x-path` header.
///
/// The data is first written to a temporary file next to the target and then
/// moved into place, so a crash or a full disk never leaves a half-written PDF.
#[tauri::command]
fn write_file(request: Request<'_>, access: State<'_, Access>) -> Result<(), String> {
    let data = raw_body(&request)?;
    let path = header(&request, "x-path").ok_or("Internal error: missing file path")?;
    let target = PathBuf::from(&path);
    access.check_write(&target)?;

    let mut tmp = target.clone().into_os_string();
    tmp.push(".folium-tmp");
    let tmp = PathBuf::from(tmp);

    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

// ---------------------------------------------------------------- dialogs
//
// File dialogs run here rather than in the interface, so the native side
// knows which files and folders the user actually chose.

async fn off_main<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

/// Asks for one or more PDFs to open. `filter` is the translated file-type label.
#[tauri::command]
async fn dialog_open(
    window: WebviewWindow,
    access: State<'_, Access>,
    filter: String,
    multiple: bool,
) -> Result<Vec<String>, String> {
    let w = window.clone();
    let picked = off_main(move || {
        let d = w.dialog().file().set_parent(&w).add_filter(filter, &["pdf"]);
        if multiple {
            d.blocking_pick_files().unwrap_or_default()
        } else {
            d.blocking_pick_file().into_iter().collect()
        }
    })
    .await?;
    let paths: Vec<PathBuf> = picked.into_iter().filter_map(|f| f.into_path().ok()).collect();
    for p in &paths {
        access.grant_file(p);
    }
    Ok(paths.iter().map(|p| p.to_string_lossy().into_owned()).collect())
}

/// Asks where to save a PDF. Returns None if cancelled.
#[tauri::command]
async fn dialog_save(
    window: WebviewWindow,
    access: State<'_, Access>,
    filter: String,
    default_name: String,
) -> Result<Option<String>, String> {
    let w = window.clone();
    let picked = off_main(move || {
        w.dialog()
            .file()
            .set_parent(&w)
            .add_filter(filter, &["pdf"])
            .set_file_name(default_name)
            .blocking_save_file()
    })
    .await?;
    let Some(mut path) = picked.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) {
        let mut s = path.into_os_string();
        s.push(".pdf");
        path = PathBuf::from(s);
    }
    access.grant_file(&path);
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Asks for a folder to save several files into. Returns None if cancelled.
#[tauri::command]
async fn dialog_folder(window: WebviewWindow, access: State<'_, Access>) -> Result<Option<String>, String> {
    let w = window.clone();
    let picked = off_main(move || w.dialog().file().set_parent(&w).blocking_pick_folder()).await?;
    let Some(path) = picked.and_then(|f| f.into_path().ok()) else {
        return Ok(None);
    };
    access.grant_folder(&path);
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// PDF files waiting to be opened: those passed at launch, then those sent
/// by later launches (double-click in the file explorer while Folium is
/// already running). The interface takes them with `take_open_requests`.
#[derive(Default)]
struct OpenQueue(Mutex<Vec<String>>);

/// Keeps the arguments that are existing PDF files. Relative paths are
/// resolved against `cwd` (the folder the launching process was started in).
fn pdf_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .filter(|a| a.to_lowercase().ends_with(".pdf"))
        .map(|a| {
            let p = PathBuf::from(&a);
            if p.is_absolute() { p } else { cwd.join(p) }
        })
        .filter(|p| p.is_file())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Returns (and forgets) the files waiting to be opened.
#[tauri::command]
fn take_open_requests(queue: tauri::State<'_, OpenQueue>) -> Vec<String> {
    std::mem::take(&mut *queue.0.lock().unwrap_or_else(|e| e.into_inner()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let at_launch = pdf_args(std::env::args().skip(1), &cwd);

    let builder = tauri::Builder::default();

    // One window for the whole app: opening a PDF while Folium is running
    // sends it to the running window (new tab) instead of starting a second
    // copy. Registered first, as the plugin requires.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        let files = pdf_args(argv.into_iter().skip(1), Path::new(&cwd));
        if !files.is_empty() {
            let access = app.state::<Access>();
            for f in &files {
                access.grant_file(Path::new(f));
            }
            let queue = app.state::<OpenQueue>();
            queue.0.lock().unwrap_or_else(|e| e.into_inner()).extend(files);
            let _ = app.emit("open-requests", ());
        }
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }));

    let access = Access::default();
    for f in &at_launch {
        access.grant_file(Path::new(f));
    }

    builder
        .manage(access)
        .manage(OpenQueue(Mutex::new(at_launch)))
        // Files dropped on the window from the file explorer.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let access = window.state::<Access>();
                for p in paths {
                    access.grant_file(p);
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Updates: signed builds published on GitHub (see tauri.conf.json).
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            take_open_requests,
            dialog_open,
            dialog_save,
            dialog_folder,
            pdf_is_encrypted,
            pdf_unlock,
            pdf_protect,
            pdf_optimize
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folium PDF");
}
