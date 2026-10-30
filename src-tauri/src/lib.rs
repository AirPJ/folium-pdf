//! Folium PDF — native side.
//!
//! The interface displays and edits PDFs itself (PDF.js and pdf-lib). This
//! layer reads and writes files, and uses qpdf for passwords and lossless
//! optimisation. Documents never leave the computer.

mod pdfops;

use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};

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

/// Reads a file and returns its raw bytes (sent to the interface as binary,
/// not JSON, so large PDFs stay fast).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

/// Writes raw bytes to the path given in the `x-path` header.
///
/// The data is first written to a temporary file next to the target and then
/// moved into place, so a crash or a full disk never leaves a half-written PDF.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let data = raw_body(&request)?;
    let path = header(&request, "x-path").ok_or("Internal error: missing file path")?;
    let target = PathBuf::from(&path);

    let mut tmp = target.clone().into_os_string();
    tmp.push(".folium-tmp");
    let tmp = PathBuf::from(tmp);

    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        e.to_string()
    })
}

/// PDF files passed on the command line, e.g. when the user double-clicks a
/// PDF or uses "Open with Folium PDF".
#[tauri::command]
fn startup_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".pdf") && Path::new(a).is_file())
        .collect()
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            startup_files,
            pdf_is_encrypted,
            pdf_unlock,
            pdf_protect,
            pdf_optimize
        ])
        .run(tauri::generate_context!())
        .expect("error while running Folium PDF");
}
