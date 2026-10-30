//! Folium PDF — native side.
//!
//! The interface does all PDF work itself (PDF.js to display, pdf-lib to edit).
//! This layer only reads and writes files on disk, so documents never leave
//! the computer.

use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};

/// Reads a file and returns its raw bytes (sent to the interface as binary,
/// not JSON, so large PDFs stay fast).
#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("Could not open “{}”: {e}", display_name(&path)))
}

/// Writes raw bytes to the path given in the `x-path` header.
///
/// The data is first written to a temporary file next to the target and then
/// moved into place, so a crash or a full disk never leaves a half-written PDF.
#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("Internal error: expected binary data".into());
    };
    let encoded = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("Internal error: missing file path")?;
    let path = urlencoding::decode(encoded)
        .map_err(|_| "Internal error: invalid file path")?
        .into_owned();
    let target = PathBuf::from(&path);

    let mut tmp = target.clone().into_os_string();
    tmp.push(".folium-tmp");
    let tmp = PathBuf::from(tmp);

    std::fs::write(&tmp, data)
        .map_err(|e| format!("Could not save “{}”: {e}", display_name(&path)))?;
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!(
            "Could not save “{}”. Is it open in another program? ({e})",
            display_name(&path)
        )
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

fn display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_file, write_file, startup_files])
        .run(tauri::generate_context!())
        .expect("error while running Folium PDF");
}
