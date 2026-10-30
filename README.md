# Folium PDF

A free, ad-free PDF tool that works entirely offline. No account, no uploads, no tracking.

**Status:** test version 0.3. Windows first; macOS, Linux, iPhone and Android later. Available in English and French.

## What it does

- **Read** — continuous scrolling, zoom, search, jump to a page, bookmarks panel, light and dark themes
- **Organize** — page grid with drag-and-drop reordering, multi-select (Ctrl / Shift), rotate, delete, duplicate, undo and redo
- **Extract** — save selected pages as a new PDF
- **Split** — every N pages, or by ranges such as `1-3, 4-10, 11-`
- **Combine** — join several PDFs, choose their order, skip individual pages, add a bookmark per file
- **Compress** — three levels; shows the new size before you save
- **Passwords** — open protected PDFs, protect a copy with AES-256 and choose what readers may do (print, copy, edit); files with restrictions become editable
- **Export as images** — PNG or JPEG at 72, 150 or 300 DPI
- **Bookmarks are kept** when you save, extract, split or combine, and follow pages you move
- English and French interface
- Open several files in tabs, drop PDFs on the window, or set Folium as the app for PDFs

## Download

Installers are built automatically for every change. Go to [Releases](../../releases), open **Test build** and download the `.exe` file. Official versions will be published there too.

Once installed, Folium updates itself: it checks for a new version when it starts (you can turn this off under About and updates, the ⓘ button) and installs it with one click. The check only asks GitHub for the latest version number; updates are signed and verified before installing.

Until the installer is code-signed, Windows SmartScreen shows "Windows protected your PC". Click **More info → Run anyway**.

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Open | Ctrl O |
| Save / Save a copy | Ctrl S / Ctrl Shift S |
| Read / Organize / Combine | Ctrl 1 / Ctrl 2 / Ctrl 3 |
| Search | Ctrl F |
| Zoom | Ctrl + / Ctrl − / Ctrl 0, or Ctrl + mouse wheel |
| Select all | Ctrl A |
| Extract selection | Ctrl E |
| Duplicate selection | Ctrl D |
| Rotate right / left | R / Shift R |
| Delete pages | Del |
| Undo / Redo | Ctrl Z / Ctrl Y |
| Next / previous tab | Ctrl Tab / Ctrl Shift Tab |
| Close tab | Ctrl W |

## Known limits of 0.2

- Saving rebuilds the file page by page, so fillable form fields are not kept yet.
- Compression re-encodes photos only; it does not touch text, fonts or drawings.
- When a password-protected file is saved with "Keep the password", reader permissions are reset to "everything allowed".

## Roadmap

- **1.0** — polish from testing, code signing, public release
- **1.1** — highlight and annotate, fill in forms
- **1.2** — sign, OCR for scanned pages, images to PDF

## How it's built

| Part | Technology |
| --- | --- |
| App shell | [Tauri 2](https://tauri.app) (Rust) |
| Interface | React + TypeScript, built with Vite |
| Displaying PDFs | [PDF.js](https://mozilla.github.io/pdf.js/) |
| Editing PDFs | [pdf-lib](https://pdf-lib.js.org) |
| Passwords and optimisation | [qpdf](https://qpdf.sourceforge.io) (built in, via the `qpdf` Rust crate) |
| Drag and drop | [dnd-kit](https://dndkit.com) |

Everything runs on your computer. The native side reads and writes the files you choose and runs qpdf for passwords and optimisation.

Translations live in `src/locales/`. English text is the key; `npm run i18n:check` lists any missing translations.

## Releasing updates

Every push to `main` builds a signed installer and publishes it, with `latest.json` for the updater, as the **Test build** release. Version numbers are `MAJOR.MINOR` from `package.json` plus the build number. Signing needs two repository secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Keep a copy of the key: without it, installed copies can't receive updates.

## Building it yourself

Requirements: Node.js 22, Rust (stable) and a C++ compiler (on Windows, the Visual Studio C++ Build Tools), which builds the bundled qpdf.

```sh
npm install
npm run tauri dev      # run with live reload
npm run tauri build    # make the installer
```

`npm run dev` also runs the interface in a normal browser, which is handy for working on the design.

## Licence

Folium PDF is free software under the [GNU General Public License v3.0 or later](LICENSE). You can use, study, share and improve it; copies and modified versions must stay free under the same licence.
