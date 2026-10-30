// Printing. Pages are rendered to images and handed to the system print
// dialog (window.print). The dialog lets the user pick the printer, the
// page range, copies and paper; each page keeps its own size and
// orientation, so mixed portrait/landscape documents print correctly.

export interface PrintPage {
  blob: Blob;
  widthPt: number;
  heightPt: number;
}

const ROOT_ID = "print-root";
let cleanup: (() => void) | null = null;

/** Removes the print pages (called after printing, or before the next print). */
export function clearPrint() {
  cleanup?.();
  cleanup = null;
}

/** Shows the system print dialog for the given pages. */
export async function printImages(pages: PrintPage[]): Promise<void> {
  clearPrint();
  const urls: string[] = [];
  const root = document.createElement("div");
  root.id = ROOT_ID;
  const style = document.createElement("style");

  // One named @page per distinct page size.
  const sizes = new Map<string, string>();
  const rules: string[] = [];
  const imgs: HTMLImageElement[] = [];
  for (const p of pages) {
    const w = Math.round(p.widthPt * 100) / 100;
    const h = Math.round(p.heightPt * 100) / 100;
    const key = `${w}x${h}`;
    let name = sizes.get(key);
    if (!name) {
      name = `folium-p${sizes.size}`;
      sizes.set(key, name);
      rules.push(
        `@page ${name} { size: ${w}pt ${h}pt; margin: 0; }`,
        // A hair smaller than the paper so rounding never adds a blank page.
        `#${ROOT_ID} .${name} { page: ${name}; width: ${w}pt; height: ${Math.max(1, h - 1)}pt; }`,
      );
    }
    const page = document.createElement("div");
    page.className = `print-page ${name}`;
    const img = document.createElement("img");
    const url = URL.createObjectURL(p.blob);
    urls.push(url);
    img.src = url;
    img.alt = "";
    page.appendChild(img);
    root.appendChild(page);
    imgs.push(img);
  }

  style.textContent = `
@media screen { #${ROOT_ID} { display: none; } }
@media print {
  html, body { height: auto !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; background: #fff !important; }
  body > *:not(#${ROOT_ID}):not(style) { display: none !important; }
  #${ROOT_ID} { display: block; }
  #${ROOT_ID} .print-page { overflow: hidden; break-after: page; break-inside: avoid; }
  #${ROOT_ID} .print-page:last-child { break-after: auto; }
  #${ROOT_ID} img { display: block; width: 100%; height: 100%; object-fit: contain; }
}
@page { margin: 0; }
${rules.join("\n")}
`;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const mine = () => {
    root.remove();
    style.remove();
    urls.forEach((u) => URL.revokeObjectURL(u));
  };
  cleanup = mine;

  // Every image must be ready before the print dialog takes its snapshot.
  await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));

  const done = () => {
    window.removeEventListener("afterprint", done);
    // Leave a moment in case the dialog still reads the images.
    setTimeout(() => {
      if (cleanup === mine) clearPrint();
    }, 1000);
  };
  window.addEventListener("afterprint", done);
  window.print();
}
