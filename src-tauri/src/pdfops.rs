//! PDF operations that need qpdf: passwords and lossless optimisation.
//!
//! Errors are short codes the interface translates:
//! `wrong-password`, `damaged`, `failed: <details>`.

use qpdf::{
    EncryptionParams, EncryptionParamsR6, ObjectStreamMode, PrintPermission, QPdf, QPdfError, QPdfErrorCode,
    StreamDataMode, StreamDecodeLevel,
};

fn code(e: QPdfError) -> String {
    match e.error_code() {
        QPdfErrorCode::InvalidPassword => "wrong-password".into(),
        QPdfErrorCode::DamagedPdf => "damaged".into(),
        _ => format!("failed: {e}"),
    }
}

/// True if the file uses PDF encryption (with or without an open password).
pub fn is_encrypted(data: &[u8]) -> bool {
    match QPdf::read_from_memory(data) {
        Ok(pdf) => pdf.is_encrypted(),
        // qpdf refuses to open files that need a password.
        Err(e) => e.error_code() == QPdfErrorCode::InvalidPassword,
    }
}

/// Returns an unencrypted copy. `password` may be empty for files that only
/// carry restrictions (no password to open).
pub fn unlock(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let pdf = QPdf::read_from_memory_encrypted(data, password).map_err(code)?;
    pdf.writer()
        .preserve_encryption(false)
        .object_stream_mode(ObjectStreamMode::Preserve)
        .write_to_memory()
        .map_err(code)
}

pub struct Protection {
    pub open_password: String,
    pub allow_print: bool,
    pub allow_copy: bool,
    pub allow_edit: bool,
}

/// Encrypts with AES-256. The owner password is random: restrictions can be
/// lifted only by opening the file with the open password in a tool that
/// ignores them, which is the normal behaviour for PDF permissions.
pub fn protect(data: &[u8], p: &Protection) -> Result<Vec<u8>, String> {
    let pdf = QPdf::read_from_memory(data).map_err(code)?;
    let owner = random_password();
    let params = EncryptionParamsR6 {
        user_password: p.open_password.clone(),
        owner_password: owner,
        allow_accessibility: true,
        allow_extract: p.allow_copy,
        allow_assemble: p.allow_edit,
        allow_annotate_and_form: p.allow_edit,
        allow_form_filling: true,
        allow_modify_other: p.allow_edit,
        allow_print: if p.allow_print { PrintPermission::Full } else { PrintPermission::None },
        encrypt_metadata: true,
    };
    pdf.writer()
        .encryption_params(EncryptionParams::R6(params))
        .object_stream_mode(ObjectStreamMode::Generate)
        .write_to_memory()
        .map_err(code)
}

/// Lossless size reduction: packs objects into compressed object streams,
/// recompresses uncompressed or poorly compressed streams and drops unused
/// objects. Images are handled separately (in the interface) before this.
pub fn optimize(data: &[u8]) -> Result<Vec<u8>, String> {
    let pdf = QPdf::read_from_memory(data).map_err(code)?;
    pdf.writer()
        .object_stream_mode(ObjectStreamMode::Generate)
        .stream_data_mode(StreamDataMode::Compress)
        .stream_decode_level(StreamDecodeLevel::Generalized)
        .compress_streams(true)
        .preserve_unreferenced_objects(false)
        .write_to_memory()
        .map_err(code)
}

fn random_password() -> String {
    // 32 random bytes from the OS, hex-encoded.
    let mut buf = [0u8; 32];
    if getrandom::fill(&mut buf).is_err() {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        buf[..16].copy_from_slice(&t.to_le_bytes());
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal one-page PDF.
    fn sample() -> Vec<u8> {
        let pdf = QPdf::empty();
        let page = pdf.parse_object("<< /Type /Page /MediaBox [0 0 200 200] >>").unwrap();
        pdf.add_page(&page, true).unwrap();
        pdf.writer().write_to_memory().unwrap()
    }

    fn protected(pw: &str, print: bool) -> Vec<u8> {
        protect(
            &sample(),
            &Protection { open_password: pw.into(), allow_print: print, allow_copy: false, allow_edit: false },
        )
        .unwrap()
    }

    #[test]
    fn plain_file_is_not_encrypted() {
        assert!(!is_encrypted(&sample()));
    }

    #[test]
    fn protect_then_unlock_round_trip() {
        let locked = protected("sésame 123", true);
        assert!(is_encrypted(&locked));
        assert_eq!(unlock(&locked, "nope").unwrap_err(), "wrong-password");
        let open = unlock(&locked, "sésame 123").unwrap();
        assert!(!is_encrypted(&open));
        assert_eq!(QPdf::read_from_memory(&open).unwrap().get_num_pages().unwrap(), 1);
    }

    #[test]
    fn restrictions_only_file_unlocks_without_password() {
        let locked = protected("", false);
        assert!(is_encrypted(&locked));
        let open = unlock(&locked, "").unwrap();
        assert!(!is_encrypted(&open));
    }

    #[test]
    fn optimize_keeps_pages() {
        let out = optimize(&sample()).unwrap();
        assert_eq!(QPdf::read_from_memory(&out).unwrap().get_num_pages().unwrap(), 1);
    }

    #[test]
    fn damaged_input_is_reported() {
        assert!(unlock(b"not a pdf", "").is_err());
    }
}
