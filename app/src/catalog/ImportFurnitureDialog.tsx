// Furniture import wizard: choose a 3D model (OBJ, DAE, 3DS, glTF, GLB, FBX, ZIP, KMZ, STL,
// 3MF, PLY, VRML) or the heights of terrain (XYZ, ASC), turn it
// upright with 90° rotations, set name, unit and size, and import it into the user's
// library "My furniture" (shared with Sweet Home 3D). The icon is rendered from
// the preview. Optionally the new piece is placed in the home right away: as furniture in
// the middle of the home, or as reference object (scan, terrain, neighbor house) that may
// keep the zero point of its file.

import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { api, stageResourceUrl } from "../api";
import { errorText } from "../errorText";
import { t } from "../i18n";
import { useStore } from "../store";
import { useDialogEscape } from "../ui/dialogEscape";
import { useUi } from "../ui/uiStore";
import { parseLength } from "../units";
import { disposeObject, loadModelUncached } from "../view3d/models";
import CategoryField from "./CategoryField";
import { originPlacement } from "./importPlacement";
import { extensionOf, MODEL_EXTENSIONS, prepareModel, TERRAIN_EXTENSIONS } from "./modelConvert";

type Staged = { id: number; main: string; sizeCm: [number, number, number] | null; path: string };

/** Units a model can be in, with their centimeters; "auto" is what the file suggests. */
const UNITS: { value: string; cm: number; label: () => string }[] = [
  { value: "mm", cm: 0.1, label: () => t("Millimeters") },
  { value: "cm", cm: 1, label: () => t("Centimeters") },
  { value: "m", cm: 100, label: () => t("Meters") },
  { value: "in", cm: 2.54, label: () => t("Inches") },
  { value: "ft", cm: 30.48, label: () => t("Feet") },
];

/** Name of the unit with `cm` centimeters, or the number of centimeters. */
function unitName(cm: number): string {
  const unit = UNITS.find((u) => Math.abs(u.cm - cm) < u.cm * 1e-3);
  return unit ? unit.label() : `${Math.round(cm * 100) / 100} cm`;
}

/** Labels of the size fields (translated when shown). */
const SIZE_LABELS = { width: () => t("Width"), depth: () => t("Depth"), height: () => t("Height") };

const PREVIEW_PX = 260;
/** View of the preview like catalog icons: from the front, slightly from above and the right. */
const DEFAULT_ORBIT = { yaw: 0.4636, pitch: 0.373, distance: 3.84 };

/** Puts the camera on its orbit around the model (at the origin). */
function placeCamera(camera: THREE.PerspectiveCamera, o: typeof DEFAULT_ORBIT): void {
  const r = o.distance * Math.cos(o.pitch);
  camera.position.set(r * Math.sin(o.yaw), o.distance * Math.sin(o.pitch), r * Math.cos(o.yaw));
  camera.lookAt(0, 0, 0);
}
const ICON_PX = 128;

function fileStem(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.[^.]+$/, "");
}

/** Sweet Home 3D's modelRotation: the 3x3 part of `m`, row major. */
function rotationRowMajor(m: THREE.Matrix4): number[] {
  const e = m.elements;
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]].map(
    (v) => Math.round(v * 1e6) / 1e6,
  );
}

const fmt = (v: number) => String(Math.round(v * 10) / 10);

/** Centimeters of a typed size; a unit may be typed with it ("60 cm", "24 in", "1.2 m"). */
function cmOf(text: string): number {
  return parseLength(text, "cm") ?? Number.NaN;
}

export default function ImportFurnitureDialog({
  initialPath,
  onClose,
}: {
  /** Model to load right away (e.g. dropped onto the catalog) */
  initialPath?: string;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    holder: THREE.Group;
    model: THREE.Object3D | null;
  } | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [rotation, setRotation] = useState(() => new THREE.Matrix4());
  /** cm per model unit, from the backend size or guessed */
  const [unitCm, setUnitCm] = useState(1);
  /** Unit chosen by the user ("auto": what the file suggests, `autoCm`) */
  const [unit, setUnit] = useState("auto");
  const [autoCm, setAutoCm] = useState(1);
  /** Middle of the model's box in its units, from the zero point of its file */
  const center = useRef(new THREE.Vector3());
  /** Placed as reference object (scan, terrain, neighbor house) */
  const [reference, setReference] = useState(false);
  const [terrain, setTerrain] = useState(false);
  /** The zero point of the model lands on the zero point of the plan */
  const [keepOrigin, setKeepOrigin] = useState(false);
  const [name, setName] = useState("");
  // Category and creator of a catalog item the model comes from
  const extra = useUi.getState().dialogExtra;
  const [category, setCategory] = useState(extra?.category ?? "My furniture");
  const creator = extra?.creator;
  /** Library chosen in the library editor (null: the user's own) */
  const library = useUi((s) => s.libraryTarget);
  const [size, setSize] = useState({ width: "", depth: "", height: "" });
  const [keepRatio, setKeepRatio] = useState(true);
  const [elevation, setElevation] = useState("0");
  const [doorOrWindow, setDoorOrWindow] = useState(false);
  const [staircase, setStaircase] = useState(false);
  const [addToHome, setAddToHome] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opened = useStore((s) => s.opened);
  /** View of the preview: dragging turns it, the wheel zooms, a double-click resets it */
  const orbit = useRef({ ...DEFAULT_ORBIT });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const redraw = () => {
    const t = three.current;
    if (!t) return;
    placeCamera(t.camera, orbit.current);
    t.renderer.render(t.scene, t.camera);
  };

  // Preview renderer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setSize(PREVIEW_PX, PREVIEW_PX, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 3, 4);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    placeCamera(camera, orbit.current);
    const holder = new THREE.Group();
    scene.add(holder);
    three.current = { renderer, scene, camera, holder, model: null };
    renderer.render(scene, camera);
    // Textures of the model load after it is shown: redraw a few times per second
    const timer = window.setInterval(() => renderer.render(scene, camera), 250);
    return () => {
      window.clearInterval(timer);
      if (three.current?.model) disposeObject(three.current.model);
      renderer.dispose();
      three.current = null;
    };
  }, []);

  /** Shows the model with the current rotation, centered and scaled to the preview. */
  const render = useCallback((rot: THREE.Matrix4) => {
    const t = three.current;
    if (!t?.model) return null;
    t.holder.clear();
    const rotated = new THREE.Group();
    rotated.add(t.model);
    rotated.matrixAutoUpdate = false;
    rotated.matrix.copy(rot);
    rotated.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(rotated);
    const extent = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 1.6 / Math.max(extent.x, extent.y, extent.z, 1e-6);
    const fit = new THREE.Group();
    fit.scale.setScalar(scale);
    fit.position.copy(center.multiplyScalar(-scale));
    fit.add(rotated);
    t.holder.add(fit);
    t.renderer.render(t.scene, t.camera);
    return extent;
  }, []);

  const resetSize = (extent: THREE.Vector3 | null, cm: number) => {
    if (!extent) return;
    setSize({
      width: fmt(extent.x * cm),
      depth: fmt(extent.z * cm),
      height: fmt(extent.y * cm),
    });
  };

  const chooseModel = async () => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: t("3D models"), extensions: MODEL_EXTENSIONS }],
    });
    if (typeof chosen === "string") await loadModel(chosen);
  };

  const loadModel = async (chosen: string) => {
    setBusy(true);
    setStatus(t("Loading model…"));
    try {
      // FBX and VRML are converted to GLB in the app first
      const s = await api.modelStage(await prepareModel(chosen));
      const model = await loadModelUncached(stageResourceUrl(s.id, s.main));
      const t = three.current;
      if (!t) return;
      if (t.model) disposeObject(t.model);
      t.model = model;
      const identity = new THREE.Matrix4();
      setRotation(identity);
      const extent = render(identity);
      // Units: the backend knows the size of OBJ and glTF models; otherwise guess
      // meters for small models and centimeters for others
      let cm = 1;
      if (s.sizeCm && extent && extent.x > 0) cm = s.sizeCm[0] / extent.x;
      else if (extent && Math.max(extent.x, extent.y, extent.z) < 10) cm = 100;
      setUnitCm(cm);
      setAutoCm(cm);
      setUnit("auto");
      // The middle of the box: the backend knows it also where it moved the model towards its
      // zero point (terrain in national coordinates); otherwise it is measured here
      if (s.centerCm) {
        center.current.fromArray(s.centerCm).divideScalar(s.unitCm);
      } else {
        new THREE.Box3().setFromObject(model).getCenter(center.current);
      }
      // Heights of terrain: a reference object that replaces the flat ground
      const isTerrain = TERRAIN_EXTENSIONS.includes(extensionOf(chosen));
      setReference(isTerrain);
      setTerrain(isTerrain);
      setKeepOrigin(false);
      resetSize(extent, cm);
      setStaged({ ...s, path: chosen });
      setName(fileStem(chosen));
      setStatus(null);
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // A model given by the caller (dropped file) loads right away
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once for the given file
  useEffect(() => {
    if (initialPath) void loadModel(initialPath);
  }, [initialPath]);

  const rotate = (axis: "x" | "y" | "z") => {
    const r = new THREE.Matrix4();
    if (axis === "x") r.makeRotationX(Math.PI / 2);
    else if (axis === "y") r.makeRotationY(Math.PI / 2);
    else r.makeRotationZ(Math.PI / 2);
    const next = r.multiply(rotation);
    setRotation(next);
    resetSize(render(next), unitCm);
  };

  const changeUnit = (value: string) => {
    const cm = UNITS.find((u) => u.value === value)?.cm ?? autoCm;
    setUnit(value);
    setUnitCm(cm);
    resetSize(render(rotation), cm);
  };

  const changeSize = (field: "width" | "depth" | "height", value: string) => {
    const n = cmOf(value);
    const old = cmOf(size[field]);
    if (keepRatio && n > 0 && old > 0) {
      const f = n / old;
      const scaled = (v: string) => fmt(cmOf(v) * f);
      setSize({
        width: field === "width" ? value : scaled(size.width),
        depth: field === "depth" ? value : scaled(size.depth),
        height: field === "height" ? value : scaled(size.height),
      });
    } else {
      setSize({ ...size, [field]: value });
    }
  };

  /** PNG icon rendered from the preview. */
  const iconBase64 = (): string | undefined => {
    const t = three.current;
    if (!t) return undefined;
    t.renderer.render(t.scene, t.camera);
    const icon = document.createElement("canvas");
    icon.width = ICON_PX;
    icon.height = ICON_PX;
    icon.getContext("2d")?.drawImage(t.renderer.domElement, 0, 0, ICON_PX, ICON_PX);
    return icon.toDataURL("image/png").split(",")[1];
  };

  const doImport = async () => {
    if (!staged) return;
    const [w, d, h] = [cmOf(size.width), cmOf(size.depth), cmOf(size.height)];
    if (!(w > 0 && d > 0 && h > 0)) {
      setStatus(t("Width, depth and height must be positive."));
      return;
    }
    setBusy(true);
    setStatus(t("Importing…"));
    try {
      const r = (await api.execute("furniture_import", {
        model_path: staged.path,
        name: name.trim() || fileStem(staged.path),
        category: category.trim() || "My furniture",
        ...(creator && { creator }),
        width: w,
        depth: d,
        height: h,
        elevation: cmOf(elevation) || 0,
        door_or_window: doorOrWindow,
        staircase,
        ...(library ? { library } : {}),
        model_rotation: rotationRowMajor(rotation),
        icon_png_base64: iconBase64(),
      })) as { catalog_id: string };
      if (addToHome && opened) {
        const level = useStore.getState().selectedLevel;
        let [x, y] = homeCenter(opened.home);
        let above: number | undefined;
        const extent = render(rotation);
        if (reference && keepOrigin && extent) {
          const turned = center.current.clone().applyMatrix4(rotation);
          const at = originPlacement(turned, extent, [w, d, h]);
          x = at.x;
          y = at.y;
          above = at.elevation + (cmOf(elevation) || 0);
        }
        const added = (await api.execute("furniture_add", {
          catalog_id: r.catalog_id,
          x,
          y,
          ...(above !== undefined ? { elevation: above } : {}),
          ...(level ? { level } : {}),
        })) as { id?: string };
        if (added.id && reference) {
          await api.execute("furniture_update", { id: added.id, reference: true, terrain });
        }
        if (added.id) useStore.getState().setSelection([added.id]);
      }
      useUi.getState().noteImport();
      onClose();
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Turning the model has no field that would show the change
  const turned = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogEscape(dialog, onClose, { guard: true, changed: () => turned.current, busy });

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialog}
        tabIndex={-1}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Import furniture")}
      >
        <header className="dialog-header">
          <h2>{t("Import furniture")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            ✕
          </button>
        </header>
        <p className="muted small">
          {t(
            'OBJ (with its MTL and texture files), DAE, 3DS, glTF, GLB, FBX, 3MF, STL, PLY, VRML, or a ZIP or KMZ archive with a model; for terrain a height grid as XYZ or ASC (in meters). The piece goes into your library "My furniture", which Sweet Home 3D uses too; formats Sweet Home 3D cannot read are converted to OBJ. Files can also be dropped onto the catalog.',
          )}
        </p>
        <div className="import-layout">
          <div className="import-preview">
            <canvas
              ref={canvasRef}
              width={PREVIEW_PX}
              height={PREVIEW_PX}
              className="import-canvas"
              title={t("Drag to turn the view, wheel to zoom, double-click for the default view")}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const o = orbit.current;
                o.yaw -= (e.clientX - d.x) * 0.01;
                o.pitch = Math.max(-1.45, Math.min(1.45, o.pitch + (e.clientY - d.y) * 0.01));
                drag.current = { x: e.clientX, y: e.clientY };
                redraw();
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onWheel={(e) => {
                const o = orbit.current;
                o.distance = Math.max(1.5, Math.min(12, o.distance * Math.exp(e.deltaY * 0.001)));
                redraw();
              }}
              onDoubleClick={() => {
                orbit.current = { ...DEFAULT_ORBIT };
                redraw();
              }}
            />
            <div className="prop-actions">
              <button type="button" onClick={() => void chooseModel()} disabled={busy}>
                {staged ? t("Other model…") : t("Choose model…")}
              </button>
            </div>
            {staged && (
              <div
                className="prop-actions"
                title={t("Turn the model until it stands upright and faces you")}
              >
                {(["x", "y", "z"] as const).map((axis) => (
                  <button
                    key={axis}
                    type="button"
                    onClick={() => {
                      turned.current = true;
                      rotate(axis);
                    }}
                  >
                    ⟳ {axis.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="import-fields props">
            <label className="prop-row">
              <span className="prop-label">{t("Name")}</span>
              <input type="text" value={name} onChange={(e) => setName(e.currentTarget.value)} />
            </label>
            <CategoryField kind="furniture" value={category} onChange={setCategory} />
            <label
              className="prop-row"
              title={t(
                "Unit of the coordinates in the file: with the right one the model has its real size",
              )}
            >
              <span className="prop-label">{t("Unit of the model")}</span>
              <select
                value={unit}
                disabled={!staged}
                onChange={(e) => changeUnit(e.currentTarget.value)}
              >
                <option value="auto">{t("Automatic ({unit})", { unit: unitName(autoCm) })}</option>
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label()}
                  </option>
                ))}
              </select>
            </label>
            {(["width", "depth", "height"] as const).map((f) => (
              <label className="prop-row" key={f}>
                <span className="prop-label">{SIZE_LABELS[f]()}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={size[f]}
                  onChange={(e) => changeSize(f, e.currentTarget.value)}
                />
                <span className="prop-unit">{t("cm")}</span>
              </label>
            ))}
            <label className="prop-row prop-check">
              <input
                type="checkbox"
                checked={keepRatio}
                onChange={(e) => setKeepRatio(e.currentTarget.checked)}
              />
              <span>{t("Keep proportions")}</span>
            </label>
            <label className="prop-row">
              <span className="prop-label">{t("Elevation")}</span>
              <input
                type="text"
                inputMode="decimal"
                value={elevation}
                onChange={(e) => setElevation(e.currentTarget.value)}
              />
              <span className="prop-unit">{t("cm")}</span>
            </label>
            <label className="prop-row prop-check">
              <input
                type="checkbox"
                checked={doorOrWindow}
                onChange={(e) => setDoorOrWindow(e.currentTarget.checked)}
              />
              <span>{t("Door or window (cuts an opening into walls)")}</span>
            </label>
            <label className="prop-row prop-check">
              <input
                type="checkbox"
                checked={staircase}
                onChange={(e) => setStaircase(e.currentTarget.checked)}
              />
              <span>{t("Staircase (cuts a hole in the floor above, can be walked up)")}</span>
            </label>
            <label className="prop-row prop-check">
              <input
                type="checkbox"
                checked={addToHome}
                disabled={!opened}
                onChange={(e) => setAddToHome(e.currentTarget.checked)}
              />
              <span>{t("Place it in the home after the import")}</span>
            </label>
            <label
              className="prop-row prop-check"
              title={t(
                "Lies faint under the plan and is not picked or snapped to there; listed under the plan in the status bar and in the home details",
              )}
            >
              <input
                type="checkbox"
                checked={reference}
                disabled={!opened || !addToHome}
                onChange={(e) => setReference(e.currentTarget.checked)}
              />
              <span>{t("As reference object (scan, terrain, neighbor house)")}</span>
            </label>
            {reference && addToHome && (
              <>
                <label
                  className="prop-row prop-check"
                  title={t(
                    "For scans and models that were measured from a known point: the piece keeps its place, and a second model from the same file system lies right next to it",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={keepOrigin}
                    onChange={(e) => setKeepOrigin(e.currentTarget.checked)}
                  />
                  <span>{t("Put the zero point of the model on the zero point of the plan")}</span>
                </label>
                <label className="prop-row prop-check">
                  <input
                    type="checkbox"
                    checked={terrain}
                    onChange={(e) => setTerrain(e.currentTarget.checked)}
                  />
                  <span>{t("Terrain (replaces the flat ground under it in 3D)")}</span>
                </label>
              </>
            )}
            <div className="prop-actions">
              <button type="button" onClick={() => void doImport()} disabled={!staged || busy}>
                {t("Import")}
              </button>
              <button type="button" onClick={onClose}>
                {t("Cancel")}
              </button>
            </div>
            {status && <p className="small">{status}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Center of the walls and rooms of the home (where a new piece is placed). */
export function homeCenter(home: {
  walls: { attrs: { x_start: number; y_start: number; x_end: number; y_end: number } }[];
  rooms: { points: { x: number; y: number }[] }[];
}): [number, number] {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const w of home.walls) {
    xs.push(w.attrs.x_start, w.attrs.x_end);
    ys.push(w.attrs.y_start, w.attrs.y_end);
  }
  for (const r of home.rooms) {
    for (const p of r.points) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length === 0) return [0, 0];
  return [
    Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
    Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
  ];
}
