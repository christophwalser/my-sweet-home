// Wizard for the background image of a level: choose an image or a page of a PDF, place the
// scale marker on two points of known distance and type it, then click the point that becomes
// the plan origin. The image is zoomed with the mouse wheel and moved by dragging; a
// magnifier helps to place the marker ends precisely.

import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { type BackgroundImage, backgroundScale, type Pt } from "../model";
import { useStore } from "../store";

type Step = "image" | "scale" | "origin";

/** Rendered or loaded image the wizard works on. */
type Source = {
  img: HTMLImageElement;
  /** Base64 of the image file (only for a new import) */
  base64: string | null;
  name: string;
};

type Pdf = {
  doc: import("pdfjs-dist").PDFDocumentProxy;
  name: string;
  pages: number;
};

/** Longest side of a rendered PDF page in pixels, and the highest resolution. */
const PDF_MAX_SIDE = 4000;
const PDF_MAX_DPI = 300;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("the image cannot be read"));
    img.src = url;
  });
}

async function openPdf(bytes: Uint8Array): Promise<Pdf["doc"]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs.getDocument({ data: bytes }).promise;
}

/** Renders a PDF page to a PNG (base64) at up to 300 dpi and 4000 px. */
async function renderPdfPage(
  doc: Pdf["doc"],
  page: number,
): Promise<{ url: string; base64: string }> {
  const p = await doc.getPage(page);
  const base = p.getViewport({ scale: 1 });
  const scale = Math.min(PDF_MAX_SIDE / Math.max(base.width, base.height), PDF_MAX_DPI / 72);
  const viewport = p.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2D canvas");
  // White paper behind transparent PDF content
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await p.render({ canvasContext: ctx, canvas, viewport }).promise;
  const url = canvas.toDataURL("image/png");
  return { url, base64: url.split(",")[1] ?? "" };
}

// ---------------------------------------------------------------- image stage

/** Zoom and position of the image; `img` is the image they belong to. */
type View = { scale: number; x: number; y: number; img: HTMLImageElement | null };

const HANDLE_PX = 7;
const LOUPE_PX = 150;
const LOUPE_ZOOM = 4;
const MARKER = "#ff7a00";

/**
 * Zoomable image with the scale marker (step "scale") or the origin cross (step "origin").
 * Coordinates of marker and origin are image pixels.
 */
function ImageStage({
  img,
  view,
  mode,
  marker,
  origin,
  onMarker,
  onOrigin,
}: {
  img: HTMLImageElement;
  /** Zoom and position, kept by the wizard so the next step shows the same spot */
  view: React.MutableRefObject<View>;
  mode: "scale" | "origin";
  marker: [Pt, Pt];
  origin: Pt;
  onMarker: (m: [Pt, Pt]) => void;
  onOrigin: (p: Pt) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<
    | { kind: "pan"; last: [number, number] }
    | { kind: "end"; index: 0 | 1 }
    /** The whole marker, grabbed at `start` (image pixels) */
    | { kind: "line"; start: Pt; from: [Pt, Pt] }
    | { kind: "origin" }
    | null
  >(null);
  /** Image point under the magnifier while an end or the origin is dragged */
  const loupe = useRef<Pt | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `view` is a ref read at draw time
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = devicePixelRatio;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const v = view.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#3a3d42";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = v.scale < 2;
    ctx.setTransform(v.scale, 0, 0, v.scale, v.x, v.y);
    ctx.drawImage(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const toScreen = (p: Pt): Pt => [p[0] * v.scale + v.x, p[1] * v.scale + v.y];

    const drawMarker = (alpha: number) => {
      const [a, b] = marker.map(toScreen);
      ctx.globalAlpha = alpha;
      ctx.lineCap = "round";
      for (const [color, width] of [
        ["#ffffff", 5],
        [MARKER, 2.5],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width * dpr;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
      }
      if (mode === "scale") {
        for (const p of [a, b]) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], HANDLE_PX * dpr, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fill();
          ctx.strokeStyle = MARKER;
          ctx.lineWidth = 2 * dpr;
          ctx.stroke();
          // Exact point: a small cross in the handle
          ctx.beginPath();
          ctx.moveTo(p[0] - 4 * dpr, p[1]);
          ctx.lineTo(p[0] + 4 * dpr, p[1]);
          ctx.moveTo(p[0], p[1] - 4 * dpr);
          ctx.lineTo(p[0], p[1] + 4 * dpr);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    drawMarker(mode === "scale" ? 1 : 0.4);
    if (mode === "origin") {
      const o = toScreen(origin);
      const r = 14 * dpr;
      for (const [color, width] of [
        ["#ffffff", 4],
        ["#2f6fde", 2],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width * dpr;
        ctx.beginPath();
        ctx.moveTo(o[0] - r * 1.8, o[1]);
        ctx.lineTo(o[0] + r * 1.8, o[1]);
        ctx.moveTo(o[0], o[1] - r * 1.8);
        ctx.lineTo(o[0], o[1] + r * 1.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(o[0], o[1], r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = `${12 * dpr}px sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 3 * dpr;
      ctx.strokeText("0, 0", o[0] + r + 4 * dpr, o[1] - r);
      ctx.fillText("0, 0", o[0] + r + 4 * dpr, o[1] - r);
    }

    // Magnifier in the top-left corner while dragging
    const lp = loupe.current;
    if (lp) {
      const size = LOUPE_PX * dpr;
      const m = 8 * dpr;
      const z = v.scale * LOUPE_ZOOM;
      ctx.save();
      ctx.beginPath();
      ctx.rect(m, m, size, size);
      ctx.clip();
      ctx.fillStyle = "#3a3d42";
      ctx.fillRect(m, m, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.setTransform(z, 0, 0, z, m + size / 2 - lp[0] * z, m + size / 2 - lp[1] * z);
      ctx.drawImage(img, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = mode === "scale" ? MARKER : "#2f6fde";
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.moveTo(m + size / 2, m);
      ctx.lineTo(m + size / 2, m + size);
      ctx.moveTo(m, m + size / 2);
      ctx.lineTo(m + size, m + size / 2);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 * dpr;
      ctx.strokeRect(m, m, size, size);
    }
  }, [img, mode, marker, origin]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = devicePixelRatio;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight) * 0.95;
    view.current = {
      scale,
      x: (w - img.naturalWidth * scale) / 2,
      y: (h - img.naturalHeight * scale) / 2,
      img,
    };
    draw();
  }, [img, draw, view]);

  // Fit a new image; another step with the same image keeps zoom and position
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit only for a new image
  useEffect(() => {
    if (view.current.img !== img) fit();
    else draw();
  }, [img]);
  useEffect(() => draw(), [draw]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  const toImage = (e: { clientX: number; clientY: number }): Pt => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const v = view.current;
    const dpr = devicePixelRatio;
    return [
      ((e.clientX - (rect?.left ?? 0)) * dpr - v.x) / v.scale,
      ((e.clientY - (rect?.top ?? 0)) * dpr - v.y) / v.scale,
    ];
  };
  const clamp = (p: Pt): Pt => [
    Math.min(Math.max(p[0], 0), img.naturalWidth),
    Math.min(Math.max(p[1], 0), img.naturalHeight),
  ];

  /** What the pointer is over in the scale step: an end of the marker, the marker, or nothing. */
  const markerPart = (p: Pt): 0 | 1 | "line" | null => {
    const tol = ((HANDLE_PX + 4) * devicePixelRatio) / view.current.scale;
    const index = marker.findIndex((m) => Math.hypot(m[0] - p[0], m[1] - p[1]) <= tol);
    if (index === 0 || index === 1) return index;
    const [a, b] = marker;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t =
      len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    const d = Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    return d <= tol ? "line" : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toImage(e);
    if (e.button === 0 && mode === "scale") {
      const part = markerPart(p);
      if (part === 0 || part === 1) {
        drag.current = { kind: "end", index: part };
        loupe.current = marker[part];
        draw();
        return;
      }
      if (part === "line") {
        drag.current = { kind: "line", start: p, from: marker };
        return;
      }
    }
    if (e.button === 0 && mode === "origin") {
      drag.current = { kind: "origin" };
      const q = clamp(p);
      loupe.current = q;
      onOrigin(q);
      return;
    }
    drag.current = { kind: "pan", last: [e.clientX, e.clientY] };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      // Cursor shows what a drag would do
      const canvas = canvasRef.current;
      if (canvas && mode === "scale") {
        const part = markerPart(toImage(e));
        canvas.style.cursor = part === "line" ? "move" : part !== null ? "crosshair" : "";
      }
      return;
    }
    if (d.kind === "pan") {
      const dpr = devicePixelRatio;
      view.current.x += (e.clientX - d.last[0]) * dpr;
      view.current.y += (e.clientY - d.last[1]) * dpr;
      d.last = [e.clientX, e.clientY];
      draw();
      return;
    }
    if (d.kind === "line") {
      // Move both ends; the marker stays on the image
      const p = toImage(e);
      const [a, b] = d.from;
      let dx = p[0] - d.start[0];
      let dy = p[1] - d.start[1];
      dx = Math.min(Math.max(dx, -Math.min(a[0], b[0])), img.naturalWidth - Math.max(a[0], b[0]));
      dy = Math.min(Math.max(dy, -Math.min(a[1], b[1])), img.naturalHeight - Math.max(a[1], b[1]));
      onMarker([
        [a[0] + dx, a[1] + dy],
        [b[0] + dx, b[1] + dy],
      ]);
      return;
    }
    let p = clamp(toImage(e));
    if (d.kind === "end") {
      const other = marker[1 - d.index];
      // Shift: horizontal or vertical marker
      if (e.shiftKey) {
        p =
          Math.abs(p[0] - other[0]) >= Math.abs(p[1] - other[1])
            ? [p[0], other[1]]
            : [other[0], p[1]];
      }
      const next: [Pt, Pt] = d.index === 0 ? [p, other] : [other, p];
      loupe.current = p;
      onMarker(next);
    } else {
      loupe.current = p;
      onOrigin(p);
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    loupe.current = null;
    draw();
  };

  const onWheel = (e: React.WheelEvent) => {
    const v = view.current;
    const dpr = devicePixelRatio;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.min(Math.max(v.scale * factor, 0.02), 40);
    const mx = e.nativeEvent.offsetX * dpr;
    const my = e.nativeEvent.offsetY * dpr;
    view.current = {
      scale,
      x: mx - ((mx - v.x) * scale) / v.scale,
      y: my - ((my - v.y) * scale) / v.scale,
      img: v.img,
    };
    draw();
  };

  return (
    <div className="bg-stage">
      <canvas
        ref={canvasRef}
        className={mode === "origin" ? "bg-stage-origin" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={fit}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

// ---------------------------------------------------------------- wizard

export default function BackgroundImageWizard({
  levelId,
  title,
  existing,
  onClose,
}: {
  /** Level of the image; null for the home without levels */
  levelId: string | null;
  /** Name shown in the title (level name or "Home") */
  title: string;
  /** Current background image and its URL, to modify scale and origin */
  existing: { bg: BackgroundImage; url: string } | null;
  onClose: () => void;
}) {
  const run = useStore((s) => s.run);
  const requestFit = useStore((s) => s.requestFit);
  const [step, setStep] = useState<Step>(existing ? "scale" : "image");
  const [source, setSource] = useState<Source | null>(null);
  const [pdf, setPdf] = useState<Pdf | null>(null);
  const [page, setPage] = useState(1);
  const [marker, setMarker] = useState<[Pt, Pt]>([
    [0, 0],
    [100, 0],
  ]);
  const [length, setLength] = useState("");
  const [origin, setOrigin] = useState<Pt>([0, 0]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const view = useRef<View>({ scale: 1, x: 0, y: 0, img: null });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Modify: start from the current image, marker and origin
  useEffect(() => {
    if (!existing) return;
    const { bg, url } = existing;
    void loadImage(url).then(
      (img) => {
        setSource({ img, base64: null, name: bg.image });
        setMarker([
          [bg.scale_distance_x_start, bg.scale_distance_y_start],
          [bg.scale_distance_x_end, bg.scale_distance_y_end],
        ]);
        setLength(String(Math.round(bg.scale_distance * 100) / 100));
        const s = backgroundScale(bg);
        setOrigin([(bg.x_origin ?? 0) / s, (bg.y_origin ?? 0) / s]);
      },
      (e) => setError(String(e)),
    );
  }, [existing]);

  /** A new image: default marker across the middle third, origin at the top-left corner. */
  const applyImage = (img: HTMLImageElement, base64: string, name: string) => {
    setSource({ img, base64, name });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setMarker([
      [Math.round(w / 3), Math.round(h / 2)],
      [Math.round((2 * w) / 3), Math.round(h / 2)],
    ]);
    setOrigin([0, 0]);
    setLength("");
  };

  const chooseFile = async () => {
    const path = await open({
      multiple: false,
      filters: [
        { name: "Images and PDF", extensions: ["png", "jpg", "jpeg", "bmp", "gif", "pdf"] },
      ],
    });
    if (typeof path !== "string") return;
    setError(null);
    const name = path.split(/[\\/]/).pop() ?? path;
    try {
      setBusy("Reading the file…");
      const bytes = await api.readFile(path);
      if (/\.pdf$/i.test(path)) {
        const doc = await openPdf(bytes);
        setPdf({ doc, name, pages: doc.numPages });
        setPage(1);
        await showPdfPage(doc, 1, name);
      } else {
        setPdf(null);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
        const img = await loadImage(url);
        applyImage(img, toBase64(bytes), name);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const showPdfPage = async (doc: Pdf["doc"], n: number, name: string) => {
    setBusy(`Rendering page ${n}…`);
    try {
      const { url, base64 } = await renderPdfPage(doc, n);
      const img = await loadImage(url);
      applyImage(img, base64, `${name}, page ${n}`);
    } finally {
      setBusy(null);
    }
  };

  const markerPx = Math.hypot(marker[1][0] - marker[0][0], marker[1][1] - marker[0][1]);
  const lengthCm = Number.parseFloat(length.replace(",", "."));
  const lengthOk = Number.isFinite(lengthCm) && lengthCm > 0 && markerPx >= 1;
  const cmPerPx = lengthOk ? lengthCm / markerPx : null;

  const finish = async () => {
    if (!source || !cmPerPx) return;
    setBusy("Saving…");
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const params = {
      ...(levelId ? { level: levelId } : {}),
      scale_distance: r2(lengthCm),
      x_start: r2(marker[0][0]),
      y_start: r2(marker[0][1]),
      x_end: r2(marker[1][0]),
      y_end: r2(marker[1][1]),
      x_origin: r2(origin[0] * cmPerPx),
      y_origin: r2(origin[1] * cmPerPx),
    };
    const result = source.base64
      ? await run("background_image_set", { ...params, image_base64: source.base64 })
      : await run("background_image_update", params);
    setBusy(null);
    if (result !== undefined) {
      requestFit();
      onClose();
    }
  };

  const steps: { id: Step; label: string }[] = [
    ...(existing ? [] : [{ id: "image" as Step, label: "Image" }]),
    { id: "scale", label: "Scale" },
    { id: "origin", label: "Origin" },
  ];
  const index = steps.findIndex((s) => s.id === step);
  const canNext = step === "image" ? !!source && !busy : step === "scale" ? lengthOk : true;

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog bg-wizard"
        role="dialog"
        aria-modal="true"
        aria-label="Background image"
      >
        <header className="dialog-header">
          <h2>Background image · {title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" disabled={!!busy}>
            {"✕"}
          </button>
        </header>
        <ol className="bg-steps">
          {steps.map((s, i) => (
            <li key={s.id} className={i === index ? "active" : i < index ? "done" : ""}>
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>

        {step === "image" && (
          <div className="bg-step-body">
            <p className="muted small">
              Choose a floor plan as image (PNG, JPEG, BMP, GIF) or a PDF, for example a scan or a
              plan from the architect. Walls, rooms and furniture are drawn on top of it.
            </p>
            <div className="bg-row">
              <button type="button" onClick={() => void chooseFile()} disabled={!!busy}>
                {source ? "Choose another file…" : "Choose file…"}
              </button>
              {pdf && (
                <label className="bg-inline">
                  Page
                  <select
                    value={page}
                    disabled={!!busy}
                    onChange={(e) => {
                      const n = Number(e.currentTarget.value);
                      setPage(n);
                      void showPdfPage(pdf.doc, n, pdf.name).catch((err) => setError(String(err)));
                    }}
                  >
                    {Array.from({ length: pdf.pages }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} of {pdf.pages}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {source && (
                <span className="muted small">
                  {source.name} · {source.img.naturalWidth} × {source.img.naturalHeight} px
                </span>
              )}
            </div>
            {source && (
              <div className="bg-preview">
                <img src={source.img.src} alt="Chosen background" />
              </div>
            )}
          </div>
        )}

        {step === "scale" && source && (
          <div className="bg-step-body">
            <p className="muted small">
              Drag the ends of the orange marker onto two points whose distance you know, e.g. the
              ends of a dimension line, and type that distance. Drag the marker itself to move it as
              a whole. Zoom with the mouse wheel, move the image by dragging, double-click to fit.
              Shift keeps the marker horizontal or vertical.
            </p>
            <ImageStage
              img={source.img}
              view={view}
              mode="scale"
              marker={marker}
              origin={origin}
              onMarker={setMarker}
              onOrigin={setOrigin}
            />
            <div className="bg-row">
              <label className="bg-inline">
                Length of the marker
                <input
                  type="text"
                  inputMode="decimal"
                  value={length}
                  placeholder="e.g. 873"
                  onChange={(e) => setLength(e.currentTarget.value)}
                />
                cm
              </label>
              <span className="muted small">
                Marker: {Math.round(markerPx * 10) / 10} px
                {cmPerPx ? ` · ${Math.round(cmPerPx * 1000) / 1000} cm per pixel` : ""}
                {cmPerPx
                  ? ` · image ${Math.round((source.img.naturalWidth * cmPerPx) / 10) / 10} × ${
                      Math.round((source.img.naturalHeight * cmPerPx) / 10) / 10
                    } m`
                  : ""}
              </span>
            </div>
          </div>
        )}

        {step === "origin" && source && (
          <div className="bg-step-body">
            <p className="muted small">
              Click the point of the image that becomes the origin of the plan (0, 0), e.g. an outer
              corner of the building. Drag to adjust; the magnifier shows the exact spot.
            </p>
            <ImageStage
              img={source.img}
              view={view}
              mode="origin"
              marker={marker}
              origin={origin}
              onMarker={setMarker}
              onOrigin={setOrigin}
            />
            {cmPerPx && (
              <div className="bg-row">
                <label className="bg-inline">
                  X
                  <input
                    type="number"
                    step={1}
                    value={Math.round(origin[0] * cmPerPx * 10) / 10}
                    onChange={(e) =>
                      setOrigin([Number(e.currentTarget.value) / cmPerPx, origin[1]])
                    }
                  />
                  cm
                </label>
                <label className="bg-inline">
                  Y
                  <input
                    type="number"
                    step={1}
                    value={Math.round(origin[1] * cmPerPx * 10) / 10}
                    onChange={(e) =>
                      setOrigin([origin[0], Number(e.currentTarget.value) / cmPerPx])
                    }
                  />
                  cm
                </label>
                <span className="muted small">from the top-left corner of the image</span>
              </div>
            )}
          </div>
        )}

        {error && <p className="bg-error">{error}</p>}
        <div className="dialog-actions">
          {busy && <span className="muted small">{busy}</span>}
          <span className="spacer" />
          <button type="button" onClick={onClose} disabled={!!busy}>
            Cancel
          </button>
          {index > 0 && (
            <button type="button" onClick={() => setStep(steps[index - 1].id)} disabled={!!busy}>
              Back
            </button>
          )}
          {index < steps.length - 1 ? (
            <button
              type="button"
              className="primary"
              onClick={() => setStep(steps[index + 1].id)}
              disabled={!canNext}
              title={step === "scale" && !lengthOk ? "Type the length of the marker" : undefined}
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => void finish()}
              disabled={!!busy || !cmPerPx}
            >
              {existing ? "Apply" : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
