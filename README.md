# Folium PDF

A free, ad-free PDF tool that works entirely offline. No account, no uploads, no tracking.

**Status:** early test version (0.1). Windows first; macOS, Linux, iPhone and Android later.

## What it does

- **Read** — continuous scrolling, zoom, search, jump to a page, light and dark themes
- **Organize** — page grid with drag-and-drop reordering, multi-select (Ctrl / Shift), rotate, delete, duplicate, undo and redo
- **Extract** — save selected pages as a new PDF
- **Split** — every N pages, or by ranges such as `1-3, 4-10, 11-`
- **Combine** — join several PDFs, choose their order, skip individual pages
- Open several files in tabs, drop PDFs on the window, or set Folium as the app for PDFs

## Download

Installers are built automatically for every change. Open the [Actions tab](../../actions), pick the latest successful **Build** run and download **Folium-PDF-Windows**. Official releases will appear under [Releases](../../releases).

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

## Known limits of 0.1

- Password-protected PDFs can't be opened yet.
- Saving rebuilds the file page by page, so bookmarks (the outline) and fillable form fields are not kept yet.
- English only for now; French is planned.

## Roadmap

- **1.0** — compress, password protect and unlock, export pages as images, keep bookmarks
- **1.1** — highlight and annotate, fill in forms
- **1.2** — sign, OCR for scanned pages, images to PDF

## How it's built

| Part | Technology |
| --- | --- |
| App shell | [Tauri 2](https://tauri.app) (Rust) |
| Interface | React + TypeScript, built with Vite |
| Displaying PDFs | [PDF.js](https://mozilla.github.io/pdf.js/) |
| Editing PDFs | [pdf-lib](https://pdf-lib.js.org) |
| Drag and drop | [dnd-kit](https://dndkit.com) |

Everything runs on your computer. The native side only reads and writes the files you choose.

## Building it yourself

Requirements: Node.js 22, Rust (stable) and, on Windows, the Visual Studio C++ Build Tools.

```sh
npm install
npm run tauri dev      # run with live reload
npm run tauri build    # make the installer
```

`npm run dev` also runs the interface in a normal browser, which is handy for working on the design.

## Licence

Folium PDF is free software under the [GNU General Public License v3.0 or later](LICENSE). You can use, study, share and improve it; copies and modified versions must stay free under the same licence.
