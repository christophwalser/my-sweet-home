// Printing through the WebView: the pages of export_document (SVG, sizes in mm) are
// placed in a hidden frame with matching @page sizes and printed with the system
// print dialog (preview, printer choice, "Microsoft Print to PDF").

export interface PrintPages {
  /** SVG documents, one per page */
  pages: string[];
  /** Orientation of each page */
  landscape: boolean[];
  /** Paper width and height in mm (portrait) */
  paper_mm: [number, number];
}

export async function printPages({ pages, landscape, paper_mm }: PrintPages): Promise<void> {
  const [w, h] = paper_mm;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const urls = pages.map((svg) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })));
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) throw new Error("printing is not available");
    doc.open();
    doc.write(`<!doctype html><html><head><title>Print</title><style>
      @page portrait { size: ${w}mm ${h}mm; margin: 0; }
      @page landscape { size: ${h}mm ${w}mm; margin: 0; }
      html, body { margin: 0; padding: 0; }
      .page { overflow: hidden; break-after: page; }
      .page:last-child { break-after: auto; }
      .portrait { page: portrait; width: ${w}mm; height: ${h}mm; }
      .landscape { page: landscape; width: ${h}mm; height: ${w}mm; }
      img { display: block; width: 100%; height: 100%; }
    </style></head><body></body></html>`);
    doc.close();
    const loads = urls.map((url, i) => {
      const page = doc.createElement("div");
      page.className = `page ${landscape[i] ? "landscape" : "portrait"}`;
      const img = doc.createElement("img");
      page.appendChild(img);
      doc.body.appendChild(page);
      return new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`page ${i + 1} could not be rendered`));
        img.src = url;
      });
    });
    await Promise.all(loads);
    // print() returns when the dialog is closed
    win.focus();
    win.print();
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
    frame.remove();
  }
}
