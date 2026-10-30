//! Which files the interface may read and write.
//!
//! The interface is trusted, but it displays untrusted PDFs. If a malicious
//! PDF ever managed to run script in the window, these rules limit what it
//! could do with the file commands:
//!
//! - Reading: PDF files only. Network paths (\\server\share\…) only when the
//!   user chose them in this session, so a script cannot make Windows
//!   connect to a server of its choosing.
//! - Writing: PDF, PNG or JPEG files only, and only to a file the user chose
//!   in a save dialog, a file in a folder the user chose, a file the user
//!   opened (save in place), or a file passed by the file explorer.
//!
//! So nothing can ever be written that Windows would run (.exe, .bat, .lnk…)
//! and nothing new appears in a folder the user did not pick.
//!
//! Refusals are short codes (`denied:type`, `denied:network`, `denied:place`)
//! that the interface translates.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

const READ_EXT: &[&str] = &["pdf"];
const WRITE_EXT: &[&str] = &["pdf", "png", "jpg", "jpeg"];

#[derive(Default)]
pub struct Access {
    files: Mutex<HashSet<PathBuf>>,
    folders: Mutex<HashSet<PathBuf>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn has_ext(p: &Path, list: &[&str]) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| list.iter().any(|x| x.eq_ignore_ascii_case(e)))
}

/// An absolute path with no `.`/`..` parts and no alternate data stream.
fn is_plain(p: &Path) -> bool {
    p.is_absolute()
        && !p.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir))
        && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| !n.contains(':'))
}

/// A network share or a device path (Windows only).
fn is_remote(p: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if let Some(Component::Prefix(pre)) = p.components().next() {
            return matches!(pre.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..) | Prefix::DeviceNS(..));
        }
        false
    }
    #[cfg(not(windows))]
    {
        let _ = p;
        false
    }
}

impl Access {
    /// The user chose or opened this file.
    pub fn grant_file(&self, p: &Path) {
        lock(&self.files).insert(p.to_path_buf());
    }

    /// The user chose this folder (files can be created directly inside it).
    pub fn grant_folder(&self, p: &Path) {
        lock(&self.folders).insert(p.to_path_buf());
    }

    fn granted(&self, p: &Path) -> bool {
        lock(&self.files).contains(p) || p.parent().is_some_and(|d| lock(&self.folders).contains(d))
    }

    pub fn check_read(&self, p: &Path) -> Result<(), String> {
        if !is_plain(p) || !has_ext(p, READ_EXT) {
            return Err("denied:type".into());
        }
        if is_remote(p) && !self.granted(p) {
            return Err("denied:network".into());
        }
        Ok(())
    }

    pub fn check_write(&self, p: &Path) -> Result<(), String> {
        if !is_plain(p) || !has_ext(p, WRITE_EXT) {
            return Err("denied:type".into());
        }
        if !self.granted(p) {
            return Err("denied:place".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    const ROOT: &str = "C:\\Users\\me\\Documents";
    #[cfg(not(windows))]
    const ROOT: &str = "/home/me/Documents";

    fn p(name: &str) -> PathBuf {
        Path::new(ROOT).join(name)
    }

    #[test]
    fn reads_pdfs_only() {
        let a = Access::default();
        assert!(a.check_read(&p("a.pdf")).is_ok());
        assert!(a.check_read(&p("A.PDF")).is_ok());
        assert!(a.check_read(&p("secrets.txt")).is_err());
        assert!(a.check_read(Path::new("a.pdf")).is_err(), "relative path");
        assert!(a.check_read(&Path::new(ROOT).join("..").join("x.pdf")).is_err());
    }

    #[test]
    fn writes_only_where_chosen() {
        let a = Access::default();
        assert!(a.check_write(&p("new.pdf")).is_err());
        a.grant_file(&p("chosen.pdf"));
        assert!(a.check_write(&p("chosen.pdf")).is_ok());
        assert!(a.check_write(&p("other.pdf")).is_err());

        let out = Path::new(ROOT).join("out");
        a.grant_folder(&out);
        assert!(a.check_write(&out.join("page 1.png")).is_ok());
        assert!(a.check_write(&out.join("sub").join("page.png")).is_err(), "only directly inside");
    }

    #[test]
    fn never_writes_runnable_files() {
        let a = Access::default();
        a.grant_folder(Path::new(ROOT));
        for bad in ["run.exe", "x.bat", "y.lnk", "z.pdf.exe", "noext", "a.pdf:evil"] {
            assert!(a.check_write(&p(bad)).is_err(), "{bad}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn network_paths_need_a_choice() {
        let a = Access::default();
        let share = Path::new("\\\\server\\share\\doc.pdf");
        assert!(a.check_read(share).is_err());
        a.grant_file(share);
        assert!(a.check_read(share).is_ok());
    }
}
