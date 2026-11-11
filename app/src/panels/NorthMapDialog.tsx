// Turns the plan to match a map: the walls are drawn over an OpenStreetMap map (north up)
// around the location of the home. Dragging moves the walls (only to compare), the mouse
// wheel or the field turns them; the angle becomes the north direction of the compass.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { useStore } from "../store";
import { northRotation, type Outline, planOutlines } from "./northMap";

type MapImage = {
  image: string;
  width: number;
  height: number;
  /** Pixel of the location of the home */
  x: number;
  y: number;
  meters_per_pixel: number;
  attribution: string;
};

/** Normalized angle in degrees (0..360), one decimal. */
function normalized(deg: number): number {
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
}

export default function NorthMapDialog({ onClose }: { onClose: () => void }) {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  const [map, setMap] = useState<MapImage | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const north = opened?.home.compass?.attrs.north_direction ?? 0;
  const [angle, setAngle] = useState(() => normalized((north * 180) / Math.PI));
  /** Offset of the walls on the map in map pixels (to compare them with a building) */
  const [offset, setOffset] = useState<[number, number]>([0, 0]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; start: [number, number] } | null>(null);
  const outlines = useRef<Outline[]>([]);
  outlines.current = opened ? planOutlines(opened.wallShapes) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    api
      .execute("location_map", {})
      .then((m) => {
        if (!alive) return;
        const data = m as MapImage;
        setMap(data);
        const image = new Image();
        image.onload = () => alive && setImg(image);
        image.src = data.image;
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = map.width;
    canvas.height = map.height;
    ctx.drawImage(img, 0, 0);
    const scale = 1 / (100 * map.meters_per_pixel);
    const rotate = northRotation((angle * Math.PI) / 180);
    const cx = map.x + offset[0];
    const cy = map.y + offset[1];
    ctx.fillStyle = "rgba(230, 60, 140, 0.45)";
    ctx.strokeStyle = "rgba(170, 20, 90, 0.95)";
    ctx.lineWidth = 1.5;
    for (const outline of outlines.current) {
      ctx.beginPath();
      outline.forEach(([x, y], i) => {
        const [rx, ry] = rotate(x, y);
        const px = cx + rx * scale;
        const py = cy + ry * scale;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // North arrow of the map
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.font = "bold 16px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("N ↑", 28, 28);
    // Attribution, as the tile usage policy asks
    ctx.font = "11px sans-serif";
    ctx.textAlign = "right";
    const text = map.attribution;
    const w = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillRect(map.width - w - 10, map.height - 18, w + 10, 18);
    ctx.fillStyle = "#333";
    ctx.fillText(text, map.width - 5, map.height - 5);
  }, [map, img, angle, offset]);

  useEffect(draw, [draw]);

  /** Map pixels per CSS pixel of the shown canvas. */
  const ratio = () => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return 1;
    return map.width / Math.max(1, canvas.getBoundingClientRect().width);
  };

  const apply = async () => {
    await run("compass_update", { north_direction_deg: angle });
    onClose();
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog north-map"
        role="dialog"
        aria-modal="true"
        aria-label={t("Align north with the map")}
      >
        <header className="dialog-header">
          <h2>{t("Align north with the map")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            {"✕"}
          </button>
        </header>
        <p className="muted small">
          {t(
            "Turn the walls with the mouse wheel (Shift: finer) or the field until they match the building on the map; drag them to compare.",
          )}
        </p>
        <div className="north-map-stage">
          {error && <p className="settings3d-error">{error}</p>}
          {!error && !img && <p className="muted">{t("Loading the map…")}</p>}
          <canvas
            ref={canvasRef}
            hidden={!img}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, start: offset };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const r = ratio();
              setOffset([d.start[0] + (e.clientX - d.x) * r, d.start[1] + (e.clientY - d.y) * r]);
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onWheel={(e) => {
              const step = e.shiftKey ? 0.1 : 1;
              setAngle((a) => normalized(a + (e.deltaY > 0 ? step : -step)));
            }}
          />
        </div>
        <div className="dialog-actions">
          <label className="prop-row">
            <span className="prop-label">{t("North direction")}</span>
            <input
              type="number"
              step={0.1}
              value={angle}
              onChange={(e) => {
                const v = Number.parseFloat(e.currentTarget.value);
                if (Number.isFinite(v)) setAngle(normalized(v));
              }}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <span className="prop-unit">°</span>
          </label>
          <button type="button" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button type="button" className="primary" disabled={!img} onClick={() => void apply()}>
            {t("Apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
