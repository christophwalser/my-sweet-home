// Turns the plan to match a map: the walls are drawn over an OpenStreetMap map (north up)
// around the location of the home. Dragging the walls moves them (only to compare), dragging
// beside them moves the map, Ctrl+wheel or the buttons zoom; the mouse wheel or the field
// turns the walls, and the angle becomes the north direction of the compass.

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { errorText } from "../errorText";
import { t } from "../i18n";
import { useStore } from "../store";
import Icon from "../ui/Icon";
import {
  insideOutlines,
  northRotation,
  type Outline,
  offsetPosition,
  planOutlines,
} from "./northMap";

type MapImage = {
  image: string;
  width: number;
  height: number;
  /** Pixel of the requested position */
  x: number;
  y: number;
  meters_per_pixel: number;
  zoom: number;
  latitude: number;
  longitude: number;
  attribution: string;
};

/** A downloaded map and where its requested position lies, in meters east and south of the home. */
type LoadedMap = MapImage & { east: number; south: number; img: HTMLImageElement };

/** Middle of the shown map in meters east and south of the home, and its zoom level. */
type View = { east: number; south: number; zoom: number };

const MIN_ZOOM = 15;
const MAX_ZOOM = 19;

/** Normalized angle in degrees (0..360), one decimal. */
function normalized(deg: number): number {
  return Math.round((((deg % 360) + 360) % 360) * 10) / 10;
}

export default function NorthMapDialog({ onClose }: { onClose: () => void }) {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  const [map, setMap] = useState<LoadedMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const north = opened?.home.compass?.attrs.north_direction ?? 0;
  const [angle, setAngle] = useState(() => normalized((north * 180) / Math.PI));
  const [view, setView] = useState<View>({ east: 0, south: 0, zoom: MAX_ZOOM });
  /** Position of the walls in meters east and south of the home (to compare with a building) */
  const [building, setBuilding] = useState<[number, number]>([0, 0]);
  const [overBuilding, setOverBuilding] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{
    kind: "map" | "building";
    x: number;
    y: number;
    view: View;
    building: [number, number];
    moved: boolean;
  } | null>(null);
  /** Location of the home (degrees), known from the first map */
  const home = useRef<{ lat: number; lon: number } | null>(null);
  /** Number of the latest map request; older answers are dropped */
  const request = useRef(0);
  const outlines = useRef<Outline[]>([]);
  outlines.current = opened ? planOutlines(opened.wallShapes) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Downloads the map around a point given in meters east and south of the home. */
  const load = useCallback((east: number, south: number, zoom: number) => {
    const id = ++request.current;
    const h = home.current;
    const params: Record<string, unknown> = { zoom };
    if (h) {
      const [latitude, longitude] = offsetPosition(h.lat, h.lon, east, south);
      Object.assign(params, { latitude, longitude });
    }
    setLoading(true);
    api
      .execute("location_map", params)
      .then((m) => {
        if (id !== request.current) return;
        const data = m as MapImage;
        if (!home.current) home.current = { lat: data.latitude, lon: data.longitude };
        const img = new Image();
        img.onload = () => {
          if (id !== request.current) return;
          setMap({ ...data, east, south, img });
          setLoading(false);
        };
        img.src = data.image;
      })
      .catch((e) => {
        if (id !== request.current) return;
        setError(errorText(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => load(0, 0, MAX_ZOOM), [load]);

  /** Meters per canvas pixel at the shown zoom. */
  const metersPerPixel = useCallback(
    () => (map ? map.meters_per_pixel * 2 ** (map.zoom - view.zoom) : 1),
    [map, view.zoom],
  );

  /** Canvas pixel of a point given in meters east and south of the home. */
  const toScreen = useCallback(
    (east: number, south: number): [number, number] => {
      const mpp = metersPerPixel();
      const w = map?.width ?? 0;
      const h = map?.height ?? 0;
      return [w / 2 + (east - view.east) / mpp, h / 2 + (south - view.south) / mpp];
    },
    [map, view, metersPerPixel],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = map.width;
    canvas.height = map.height;
    ctx.fillStyle = "#e0e0e0";
    ctx.fillRect(0, 0, map.width, map.height);
    // The downloaded map, scaled while the map of a new zoom level loads
    const s = 2 ** (view.zoom - map.zoom);
    const [mx, my] = toScreen(map.east, map.south);
    ctx.drawImage(map.img, mx - map.x * s, my - map.y * s, map.width * s, map.height * s);
    const scale = 1 / (100 * metersPerPixel());
    const rotate = northRotation((angle * Math.PI) / 180);
    const [cx, cy] = toScreen(building[0], building[1]);
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
  }, [map, view, angle, building, toScreen, metersPerPixel]);

  useEffect(draw, [draw]);

  /** Canvas pixel under the pointer. */
  const canvasPoint = (clientX: number, clientY: number): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return [0, 0];
    const r = canvas.getBoundingClientRect();
    const k = map.width / Math.max(1, r.width);
    return [(clientX - r.left) * k, (clientY - r.top) * k];
  };

  /** Whether a canvas pixel lies on the walls (within a few pixels around them). */
  const onBuilding = (p: [number, number]): boolean => {
    const scale = 1 / (100 * metersPerPixel());
    const [cx, cy] = toScreen(building[0], building[1]);
    // Back to the plan: turned the other way
    const [x, y] = northRotation((-angle * Math.PI) / 180)(
      (p[0] - cx) / scale,
      (p[1] - cy) / scale,
    );
    return insideOutlines(outlines.current, x, y, 8 / scale);
  };

  const zoomTo = (zoom: number) => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    if (z === view.zoom) return;
    setView({ ...view, zoom: z });
    load(view.east, view.south, z);
  };

  // Ctrl+wheel zooms the map; the page itself must not zoom (needs a non-passive listener)
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        zoomRef.current(viewRef.current.zoom + (e.deltaY > 0 ? -1 : 1));
        return;
      }
      const step = e.shiftKey ? 0.1 : 1;
      setAngle((a) => normalized(a + (e.deltaY > 0 ? step : -step)));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

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
            "Turn the walls with the mouse wheel (Shift: finer) or the field until they match the building on the map. Drag the walls to move them, drag beside them to move the map; Ctrl+wheel or the buttons zoom.",
          )}
        </p>
        <div className="north-map-stage">
          {error && <p className="settings3d-error">{error}</p>}
          {!error && !map && <p className="muted">{t("Loading the map…")}</p>}
          <canvas
            ref={canvasRef}
            hidden={!map}
            style={{
              cursor: drag.current ? "grabbing" : overBuilding ? "move" : "grab",
            }}
            onPointerDown={(e) => {
              const p = canvasPoint(e.clientX, e.clientY);
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = {
                kind: onBuilding(p) ? "building" : "map",
                x: p[0],
                y: p[1],
                view,
                building,
                moved: false,
              };
            }}
            onPointerMove={(e) => {
              const p = canvasPoint(e.clientX, e.clientY);
              const d = drag.current;
              if (!d) {
                setOverBuilding(onBuilding(p));
                return;
              }
              const mpp = metersPerPixel();
              const dx = (p[0] - d.x) * mpp;
              const dy = (p[1] - d.y) * mpp;
              d.moved = true;
              if (d.kind === "building") {
                setBuilding([d.building[0] + dx, d.building[1] + dy]);
              } else {
                setView({ ...d.view, east: d.view.east - dx, south: d.view.south - dy });
              }
            }}
            onPointerUp={() => {
              const d = drag.current;
              drag.current = null;
              if (d?.kind !== "map" || !d.moved || !map) return;
              // A new map once the shown part leaves the downloaded one
              const [mx, my] = toScreen(map.east, map.south);
              const s = 2 ** (view.zoom - map.zoom);
              const [w, h] = [map.width, map.height];
              const left = mx - map.x * s;
              const top = my - map.y * s;
              if (left > 0 || top > 0 || left + w * s < w || top + h * s < h) {
                load(view.east, view.south, view.zoom);
              }
            }}
          />
          {map && (
            <div className="north-map-zoom">
              <button
                type="button"
                className="icon-button"
                title={t("Zoom in")}
                aria-label={t("Zoom in")}
                disabled={view.zoom >= MAX_ZOOM}
                onClick={() => zoomTo(view.zoom + 1)}
              >
                <Icon name="zoomin" size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={t("Zoom out")}
                aria-label={t("Zoom out")}
                disabled={view.zoom <= MIN_ZOOM}
                onClick={() => zoomTo(view.zoom - 1)}
              >
                <Icon name="zoomout" size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={t("Show the walls in the middle")}
                aria-label={t("Show the walls in the middle")}
                onClick={() => {
                  setView({ ...view, east: building[0], south: building[1] });
                  load(building[0], building[1], view.zoom);
                }}
              >
                <Icon name="zoomfit" size={16} />
              </button>
              {loading && <span className="muted small">{t("Loading the map…")}</span>}
            </div>
          )}
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
          <button type="button" className="primary" disabled={!map} onClick={() => void apply()}>
            {t("Apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
