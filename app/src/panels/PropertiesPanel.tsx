// Properties of the selected element (or of the home and level if nothing is
// selected). Every change runs an *_update command: one undo step per field.

import { useEffect, useState } from "react";
import { docResourceUrl } from "../api";
import { t } from "../i18n";
import {
  forEachPiece,
  forEveryPiece,
  type Home,
  isReference,
  type Piece,
  type Wall,
} from "../model";
import { DEFAULT_ROOM_FONT } from "../plan2d/drawPlan";
import { guideAngle, guideEnd, guideLength, homeGuides } from "../plan2d/guides";
import { usePreferences } from "../preferences";
import { formatMoney, piecePrice } from "../prices";
import { currentVisitor, setVisitor, useStore, VISITOR_ID } from "../store";
import { useUi } from "../ui/uiStore";
import { formatArea, formatLength } from "../units";
import { spotAngle } from "../view3d/lights";
import { modelMaterialNames } from "../view3d/models";
import { levelOfEye } from "../view3d/visitor";
import BackgroundImageSection from "./BackgroundImageSection";
import {
  ARROW_STYLES,
  byRole,
  DASH_STYLES,
  Field,
  SelectField,
  SideSection,
  toHex,
  WALL_PATTERNS,
} from "./fields";
import LocationFields from "./LocationFields";
import MultiPanel from "./MultiPanel";
import OpeningDistances from "./OpeningDistances";
import { type Dimension, resizedPiece } from "./pieceSize";
import TextStyleFields from "./TextStyleFields";
import TextureField from "./TextureField";

/**
 * Angle in degrees between `wall` and the wall joined at its start (or end), measured
 * at their common corner; null if that end is not joined.
 */
function cornerAngle(home: Home, wall: Wall, atStart: boolean): number | null {
  const a = wall.attrs;
  const joinedId = atStart ? a.wall_at_start : a.wall_at_end;
  const other = joinedId ? home.walls.find((w) => w.attrs.id === joinedId) : null;
  if (!other) return null;
  const corner: [number, number] = atStart ? [a.x_start, a.y_start] : [a.x_end, a.y_end];
  const far: [number, number] = atStart ? [a.x_end, a.y_end] : [a.x_start, a.y_start];
  const o = other.attrs;
  const dStart = Math.hypot(o.x_start - corner[0], o.y_start - corner[1]);
  const dEnd = Math.hypot(o.x_end - corner[0], o.y_end - corner[1]);
  const otherFar: [number, number] = dStart < dEnd ? [o.x_end, o.y_end] : [o.x_start, o.y_start];
  const ux = otherFar[0] - corner[0];
  const uy = otherFar[1] - corner[1];
  const vx = far[0] - corner[0];
  const vy = far[1] - corner[1];
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < 1e-6 || lv < 1e-6) return null;
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Field for the angle at a joined corner of a wall (degrees, one undo step per change). */
function CornerAngleField({
  label,
  home,
  wall,
  atStart,
  run,
}: {
  label: string;
  home: Home;
  wall: Wall;
  atStart: boolean;
  run: (command: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const angle = cornerAngle(home, wall, atStart);
  if (angle === null) return null;
  const rounded = Math.round(angle * 100) / 100;
  return (
    <>
      <Field
        label={label}
        type="number"
        unit="°"
        value={rounded}
        onCommit={(v) =>
          void run("wall_set_angle", {
            id: wall.attrs.id,
            at: atStart ? "start" : "end",
            angle_deg: v,
          })
        }
      />
      {Math.abs(rounded - 90) > 0.005 && (
        <button
          type="button"
          className="link-button"
          title={t("Rotate this wall around the corner to a right angle (length stays)")}
          onClick={() =>
            void run("wall_set_angle", {
              id: wall.attrs.id,
              at: atStart ? "start" : "end",
              angle_deg: 90,
            })
          }
        >
          {t("Make 90°")}
        </button>
      )}
    </>
  );
}

/** Color, texture and baseboard of one wall side. */
function WallSide({
  wall,
  side,
  run,
}: {
  wall: Wall;
  side: "left" | "right";
  run: (command: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const id = wall.attrs.id;
  const title = side === "left" ? t("Left side") : t("Right side");
  const color = side === "left" ? wall.attrs.left_side_color : wall.attrs.right_side_color;
  const baseboard = wall.baseboards?.find((b) => b.attrs.role === `${side}SideBaseboard`);
  const update = (field: string, value: unknown) =>
    void run("wall_update", { id, [`${side}_side_${field}`]: value });
  const updateBaseboard = (values: Record<string, unknown>) => update("baseboard", values);
  return (
    <SideSection side={side} title={title}>
      <Field
        label={t("Color")}
        type="color"
        value={toHex(color)}
        onCommit={(v) => update("color", v)}
      />
      {color !== null && (
        <button type="button" className="link-button" onClick={() => update("color", "")}>
          {t("Default color")}
        </button>
      )}
      <TextureField
        label={t("Texture")}
        current={byRole(wall.textures, `${side}SideTexture`)}
        onCommit={(v) => update("texture", v)}
      />
      <SurfaceField
        value={side === "left" ? wall.attrs.left_side_shininess : wall.attrs.right_side_shininess}
        onCommit={(v) => update("shininess", v)}
      />
      <Field
        label={t("Baseboard")}
        type="checkbox"
        value={!!baseboard}
        onCommit={(v) => updateBaseboard({ height: v ? 7 : 0 })}
      />
      {baseboard && (
        <>
          <Field
            label={t("Height")}
            type="number"
            unit="cm"
            value={baseboard.attrs.height}
            onCommit={(v) => updateBaseboard({ height: v })}
          />
          <Field
            label={t("Thickness")}
            type="number"
            unit="cm"
            value={baseboard.attrs.thickness}
            onCommit={(v) => updateBaseboard({ thickness: v })}
          />
          <Field
            label={t("Color")}
            type="color"
            value={toHex(baseboard.attrs.color ?? color)}
            onCommit={(v) => updateBaseboard({ color: v })}
          />
          <TextureField
            label={t("Texture")}
            current={baseboard.texture}
            onCommit={(v) => updateBaseboard({ texture: v })}
          />
        </>
      )}
    </SideSection>
  );
}

/** Color and texture of the top of a wall (seen in 3D on walls lower than the ceiling). */
function WallTop({
  wall,
  run,
}: {
  wall: Wall;
  run: (command: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const id = wall.attrs.id;
  const color = wall.attrs.top_color;
  return (
    <fieldset className="side-section">
      <h3 title={t("Seen in 3D on walls lower than the ceiling, e.g. a half-height wall")}>
        {t("Top")}
      </h3>
      <Field
        label={t("Color")}
        type="color"
        value={toHex(color)}
        onCommit={(v) => void run("wall_update", { id, top_color: v })}
      />
      {color !== null && (
        <button
          type="button"
          className="link-button"
          onClick={() => void run("wall_update", { id, top_color: "" })}
        >
          {t("Default color")}
        </button>
      )}
      <TextureField
        label={t("Texture")}
        current={byRole(wall.textures, "topTexture")}
        onCommit={(v) => void run("wall_update", { id, top_texture: v })}
      />
    </fieldset>
  );
}

/** Position, eye height and view of the virtual visitor (Sweet Home 3D's observer). */
function VisitorSection() {
  const opened = useStore((s) => s.opened);
  // Re-render while the visitor walks
  useStore((s) => s.visitorPose);
  const v = currentVisitor();
  if (!opened || !v) return <p className="muted">{t("The home has no visitor yet.")}</p>;
  const levels = [...opened.home.levels].sort((a, b) => a.attrs.elevation - b.attrs.elevation);
  const level = levels.find((l) => l.attrs.id === levelOfEye(opened.home, v.z));
  const floor = level?.attrs.elevation ?? 0;
  const deg = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10;
  const rad = (d: number) => (d * Math.PI) / 180;
  const num = (f: (n: number) => void) => (value: string | number | boolean) => {
    const n = Number(value);
    if (Number.isFinite(n)) f(n);
  };
  return (
    <div className="props">
      <h2>{t("Visitor")}</h2>
      <Field
        label="X"
        type="number"
        unit="cm"
        value={Math.round(v.x * 10) / 10}
        onCommit={num((x) => void setVisitor({ x }))}
      />
      <Field
        label="Y"
        type="number"
        unit="cm"
        value={Math.round(v.y * 10) / 10}
        onCommit={num((y) => void setVisitor({ y }))}
      />
      <Field
        label={t("Eye height")}
        type="number"
        unit="cm"
        value={Math.round((v.z - floor) * 10) / 10}
        onCommit={num((h) => void setVisitor({ z: floor + Math.max(10, h) }))}
      />
      <Field
        label={t("Direction")}
        type="number"
        unit="°"
        value={((deg(v.yaw) % 360) + 360) % 360}
        onCommit={num((d) => void setVisitor({ yaw: rad(d) }))}
      />
      <Field
        label={t("Head tilt")}
        type="number"
        unit="°"
        value={deg(v.pitch)}
        onCommit={num((d) => void setVisitor({ pitch: rad(Math.max(-85, Math.min(85, d))) }))}
      />
      <Field
        label={t("Field of view")}
        type="number"
        unit="°"
        value={deg(v.fov)}
        onCommit={num((d) => void setVisitor({ fov: rad(Math.max(20, Math.min(120, d))) }))}
      />
      {level && levels.length > 1 && (
        <p className="muted small">
          {t("On level")} {level.attrs.name}
        </p>
      )}
      <p className="muted small">
        {t(
          "Drag the visitor to move it, the handle in front of it to turn it. Arrow keys move it, R turns it by 15°.",
        )}
      </p>
    </div>
  );
}

/**
 * Reference objects of the home (terrain, scans, neighbor houses): each can be shown or hidden
 * (in the plan and in 3D) and selected to change it.
 */
function ReferenceObjectsSection({
  home,
  run,
}: {
  home: Home;
  run: (command: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const setSelection = useStore((s) => s.setSelection);
  const references: Piece[] = [];
  // Hidden ones too, so that they can be shown again
  forEveryPiece(home.furniture, (p) => {
    if (isReference(p) && p.attrs.id) references.push(p);
  });
  return (
    <>
      <h2>{t("Reference objects")}</h2>
      <p className="muted small">
        {t(
          "Terrain, scans and neighbor houses: like the background image they lie faint under the plan, and they show in 3D.",
        )}
      </p>
      {references.length === 0 && (
        <p className="muted small">
          {t(
            "None yet: mark terrain, scans or neighbor houses as reference object in their properties.",
          )}
        </p>
      )}
      {references.map((p) => (
        <div key={p.attrs.id} className="prop-row prop-check">
          <input
            type="checkbox"
            checked={p.attrs.visible !== false}
            title={t("Visible")}
            aria-label={t("Show {name}", { name: p.attrs.name })}
            onChange={(e) =>
              void run("furniture_update", { id: p.attrs.id, visible: e.currentTarget.checked })
            }
          />
          <button
            type="button"
            className="link-button"
            title={t("Select it to change it")}
            onClick={() => p.attrs.id && setSelection([p.attrs.id])}
          >
            {p.attrs.name} ({t("Change…")})
          </button>
        </div>
      ))}
    </>
  );
}

/** Compass of the home: position, size, and the location with its north direction. */
function CompassSection({
  home,
  run,
}: {
  home: Home;
  run: (command: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const c = home.compass?.attrs;
  const set = (field: string) => (v: string | number | boolean) =>
    void run("compass_update", { [field]: v });
  return (
    <>
      <h2>{t("Compass")}</h2>
      <Field
        label={t("Visible")}
        type="checkbox"
        value={c ? c.visible !== false : false}
        onCommit={set("visible")}
      />
      <Field label="X" type="number" unit="cm" value={c?.x ?? -100} onCommit={set("x")} />
      <Field label="Y" type="number" unit="cm" value={c?.y ?? 50} onCommit={set("y")} />
      <Field
        label={t("Diameter")}
        type="number"
        unit="cm"
        value={c?.diameter ?? 100}
        onCommit={set("diameter")}
      />
      <h3>{t("Location")}</h3>
      <LocationFields />
    </>
  );
}

/** Shininess Sweet Home 3D gives to "shiny" pieces, walls and rooms (its dialogs). */
const SHINY = 0.25;

/** Matt or shiny surface of a wall side, floor or ceiling (matt is the default). */
function SurfaceField({
  value,
  onCommit,
}: {
  value: number | null | undefined;
  onCommit: (shininess: number) => void;
}) {
  return (
    <label className="prop-row">
      <span className="prop-label">{t("Surface")}</span>
      <select
        value={value && value > 0 ? "shiny" : "matt"}
        onChange={(e) => onCommit(e.currentTarget.value === "shiny" ? SHINY : -1)}
      >
        <option value="matt">{t("Matt")}</option>
        <option value="shiny">{t("Shiny")}</option>
      </select>
    </label>
  );
}

/**
 * Width, depth and height of a piece, and whether a change keeps its proportions (also for
 * the handles in the plan). Models that may not be deformed always keep them.
 */
function SizeFields({
  piece,
  run,
}: {
  piece: Piece;
  run: (command: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const keepChosen = useUi((s) => s.keepProportions);
  const setKeep = useUi((s) => s.setKeepProportions);
  const a = piece.attrs;
  const fixed = a.deformable === false;
  const keep = fixed || keepChosen;
  const change = (dimension: Dimension) => (v: string | number | boolean) => {
    const value = Number(v);
    if (!(value > 0)) return;
    const size = resizedPiece(
      { width: a.width, depth: a.depth, height: a.height },
      dimension,
      value,
      keep,
      a.width_depth_deformable === false,
    );
    void run("furniture_update", { id: a.id, ...size });
  };
  return (
    <>
      <Field
        label={t("Width")}
        type="number"
        unit="cm"
        value={a.width}
        onCommit={change("width")}
      />
      <Field
        label={t("Depth")}
        type="number"
        unit="cm"
        value={a.depth}
        onCommit={change("depth")}
      />
      <Field
        label={t("Height")}
        type="number"
        unit="cm"
        value={a.height}
        onCommit={change("height")}
      />
      <label
        className="prop-row prop-check"
        title={fixed ? t("The model of this piece may only be resized proportionally") : undefined}
      >
        <input
          type="checkbox"
          checked={keep}
          disabled={fixed}
          onChange={(e) => setKeep(e.currentTarget.checked)}
        />
        <span>{t("Keep proportions")}</span>
      </label>
    </>
  );
}

/**
 * Price and VAT of a piece, shown like Sweet Home 3D only when a currency is chosen in the
 * preferences; VAT only when prices with VAT are switched on.
 */
function PriceFields({
  piece,
  run,
}: {
  piece: Piece;
  run: (command: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const currency = usePreferences((s) => s.currency);
  const vatEnabled = usePreferences((s) => s.vatEnabled);
  const defaultVat = usePreferences((s) => s.defaultVatPercent);
  if (!currency) return null;
  const id = piece.attrs.id;
  const { price, vatFraction, withVat } = piecePrice(piece);
  const shown = piece.attrs.currency || currency;
  return (
    <>
      <Field
        label={t("Price")}
        type="number"
        unit={shown}
        value={price}
        onCommit={(v) => {
          const n = v === "" ? -1 : Number(v);
          if (!Number.isFinite(n)) return;
          const params: Record<string, unknown> = { id, price: n, currency };
          // A new price gets the default VAT, like Sweet Home 3D
          if (n >= 0 && vatEnabled && vatFraction === null && defaultVat > 0) {
            params.vat_percent = defaultVat;
          }
          void run("furniture_update", params);
        }}
      />
      {vatEnabled && (
        <>
          <Field
            label={t("VAT")}
            type="number"
            unit="%"
            value={vatFraction === null ? null : Math.round(vatFraction * 10000) / 100}
            onCommit={(v) => {
              const n = v === "" ? -1 : Number(v);
              if (Number.isFinite(n)) void run("furniture_update", { id, vat_percent: n });
            }}
          />
          {withVat !== null && (
            <p className="muted small">
              {t("Price incl. VAT: {amount}", { amount: formatMoney(withVat, shown) })}
            </p>
          )}
        </>
      )}
    </>
  );
}

/** Material editor: color, texture and shininess of each material of the model. */
function MaterialsSection({
  piece,
  docId,
  run,
}: {
  piece: Piece;
  docId: number;
  run: (command: string, params: Record<string, unknown>) => Promise<unknown>;
}) {
  const [names, setNames] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const model = piece.attrs.model;
  useEffect(() => {
    if (!open || !model) return;
    let alive = true;
    modelMaterialNames(docResourceUrl(docId, model))
      .then((n) => alive && setNames(n))
      .catch(() => alive && setNames([]));
    return () => {
      alive = false;
    };
  }, [open, model, docId]);
  if (!model) return null;
  const id = piece.attrs.id;
  const change = (name: string, values: Record<string, unknown>) =>
    void run("furniture_update", { id, materials: [{ name, ...values }] });
  const changed = piece.materials ?? [];
  return (
    <>
      <button
        type="button"
        className="link-button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? "▾" : "▸"} {t("Materials")}
        {changed.length > 0 ? t(" ({length} changed)", { length: changed.length }) : ""}
      </button>
      {open && names === null && <p className="muted small">{t("Loading materials…")}</p>}
      {open && names?.length === 0 && (
        <p className="muted small">{t("The model has no named materials.")}</p>
      )}
      {open &&
        names?.map((name) => {
          const m = changed.find((c) => c.attrs.name === name);
          return (
            <fieldset key={name} className="material-row">
              <legend>{name}</legend>
              <Field
                label={t("Color")}
                type="color"
                value={toHex(m?.attrs.color ?? 0xffffff)}
                onCommit={(v) => change(name, { color: v })}
              />
              <TextureField
                label={t("Texture")}
                current={m?.texture ?? null}
                onCommit={(v) => change(name, { texture: v })}
              />
              <Field
                label={t("Shininess")}
                type="number"
                unit="0–1"
                value={m?.attrs.shininess ?? null}
                onCommit={(v) => change(name, { shininess: v })}
              />
              {m && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => change(name, { color: "", texture: "", shininess: -1 })}
                >
                  {t("Model material")}
                </button>
              )}
            </fieldset>
          );
        })}
      {open && changed.length > 0 && (
        <button
          type="button"
          className="link-button"
          onClick={() => void run("furniture_update", { id, reset_materials: true })}
        >
          {t("Reset all materials")}
        </button>
      )}
    </>
  );
}

export default function PropertiesPanel() {
  const opened = useStore((s) => s.opened);
  const selection = useStore((s) => s.selection);
  const levelId = useStore((s) => s.selectedLevel);
  const run = useStore((s) => s.run);
  if (!opened) return <div className="props muted">{t("No home open")}</div>;
  const home = opened.home;

  const actions = (
    <div className="prop-actions">
      <button
        type="button"
        onClick={() => void run("edit_copy", { ids: selection })}
        title={t("Ctrl+C")}
      >
        {t("Copy")}
      </button>
      <button
        type="button"
        onClick={() => void run("edit_flip", { ids: selection, axis: "horizontal" })}
        title={t("Mirror left ↔ right (furniture gets a mirrored model)")}
      >
        {t("Flip ↔")}
      </button>
      <button
        type="button"
        onClick={() => void run("edit_flip", { ids: selection, axis: "vertical" })}
        title={t("Mirror top ↔ bottom (furniture gets a mirrored model)")}
      >
        {t("Flip ↕")}
      </button>
      <button
        type="button"
        title={t("Ctrl+D")}
        onClick={() =>
          void run("edit_duplicate", { ids: selection }).then((r) => {
            const ids = (r as { ids?: string[] } | undefined)?.ids;
            if (ids) useStore.getState().setSelection(ids);
          })
        }
      >
        {t("Duplicate")}
      </button>
      <button
        type="button"
        onClick={() => void run("edit_delete", { ids: selection })}
        title={t("Del")}
      >
        {t("Delete")}
      </button>
    </div>
  );

  const selectedWalls = home.walls.filter((w) => selection.includes(w.attrs.id));
  const wallActions = selectedWalls.length > 0 && (
    <div className="prop-actions">
      {selectedWalls.length === 2 && (
        <button
          type="button"
          title={t(
            "Extend or shorten both walls to the intersection of their axes and connect them (J)",
          )}
          onClick={() => void run("wall_join", { ids: selectedWalls.map((w) => w.attrs.id) })}
        >
          {t("Join walls")}
        </button>
      )}
      {selectedWalls.length === 1 && (
        <button
          type="button"
          title={t("Split the wall into two connected walls at its middle")}
          onClick={() =>
            void run("wall_split", { id: selectedWalls[0].attrs.id }).then((r) => {
              const ids = (r as { ids?: string[] } | undefined)?.ids;
              if (ids) useStore.getState().setSelection(ids);
            })
          }
        >
          {t("Split")}
        </button>
      )}
      {selectedWalls.some((w) => w.attrs.wall_at_start || w.attrs.wall_at_end) && (
        <button
          type="button"
          title={t("Remove the connections of the selected walls")}
          onClick={() => void run("wall_detach", { ids: selectedWalls.map((w) => w.attrs.id) })}
        >
          {t("Detach")}
        </button>
      )}
    </div>
  );

  const topFurniture = home.furniture.filter((f) => f.attrs.id && selection.includes(f.attrs.id));
  const groupButton = topFurniture.length > 1 && (
    <div className="prop-actions">
      <button
        type="button"
        title={t("Group the selected furniture (Ctrl+G)")}
        onClick={() =>
          void run("furniture_group", { ids: topFurniture.map((f) => f.attrs.id) }).then((r) => {
            const gid = (r as { id?: string } | undefined)?.id;
            if (gid) useStore.getState().setSelection([gid]);
          })
        }
      >
        {t("Group")}
      </button>
    </div>
  );

  if (selection.length > 1) {
    return (
      <div className="props">
        <p className="muted small">
          {selection.length} {t("elements selected · changes apply to all of the same kind")}
        </p>
        {selectedWalls.length === 2 &&
          (() => {
            const [w1, w2] = selectedWalls;
            // The corner where the second wall is joined to the first one
            const atStart = w2.attrs.wall_at_start === w1.attrs.id;
            const joined = atStart || w2.attrs.wall_at_end === w1.attrs.id;
            return joined ? (
              <CornerAngleField
                label={t("Angle between")}
                home={home}
                wall={w2}
                atStart={atStart}
                run={run}
              />
            ) : null;
          })()}
        {selectedWalls.length === 2 && (
          <p className="muted small">
            {t(
              "Join walls connects both walls at the intersection of their axes (corner or T junction).",
            )}
          </p>
        )}
        {wallActions}
        {groupButton}
        <MultiPanel home={home} selection={selection} run={run} />
        {actions}
      </div>
    );
  }

  const id = selection[0];
  if (!id) {
    const level = home.levels.find((l) => l.attrs.id === levelId);
    return (
      <div className="props">
        <h2>{t("Home")}</h2>
        <Field
          label={t("Name")}
          type="text"
          value={home.attrs.name}
          onCommit={(v) => void run("home_set", { name: v })}
        />
        <Field
          label={t("Wall height")}
          type="number"
          unit="cm"
          value={home.attrs.wall_height ?? 250}
          onCommit={(v) => void run("home_set", { wall_height: v })}
        />
        {level && (
          <>
            <h2>{t("Level")}</h2>
            <Field
              label={t("Name")}
              type="text"
              value={level.attrs.name}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, name: v })}
            />
            <Field
              label={t("Elevation")}
              type="number"
              unit="cm"
              value={level.attrs.elevation}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, elevation: v })}
            />
            <Field
              label={t("Height")}
              type="number"
              unit="cm"
              value={level.attrs.height}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, height: v })}
            />
            <Field
              label={t("Floor thickness")}
              type="number"
              unit="cm"
              value={level.attrs.floor_thickness}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, floor_thickness: v })}
            />
            <Field
              label={t("Visible in 3D")}
              type="checkbox"
              value={level.attrs.viewable !== false}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, viewable: v })}
            />
            <div className="prop-actions">
              <button
                type="button"
                title={t("Add a level with the same elevation (e.g. a mezzanine or split level)")}
                onClick={() =>
                  void run("level_add", {
                    name: `${level.attrs.name} (2)`,
                    elevation: level.attrs.elevation,
                    height: level.attrs.height,
                    floor_thickness: level.attrs.floor_thickness,
                  })
                }
              >
                {t("Add level at same elevation")}
              </button>
              <button
                type="button"
                title={t("Delete this level and everything on it (Ctrl+Z restores it)")}
                onClick={() => void run("edit_delete", { ids: [level.attrs.id] })}
              >
                {t("Delete level")}
              </button>
            </div>
          </>
        )}
        {level ? (
          <BackgroundImageSection
            levelId={level.attrs.id}
            background={level.background_image ?? null}
          />
        ) : (
          home.levels.length === 0 && (
            <BackgroundImageSection levelId={null} background={home.background_image ?? null} />
          )
        )}
        <ReferenceObjectsSection home={home} run={run} />
        <CompassSection home={home} run={run} />
        <p className="muted">{t("Click an element in the plan to edit it.")}</p>
      </div>
    );
  }

  const group = home.furniture.find((f) => f.type === "group" && f.attrs.id === id);
  if (group && group.type === "group") {
    let count = 0;
    forEachPiece(group.items, () => {
      count++;
    });
    return (
      <div className="props">
        <h2>{t("Group")}</h2>
        <p className="muted small">
          {group.attrs.name} · {count} {t("pieces")}
        </p>
        <p className="muted small">
          {t("Drag to move the group. Ungroup to edit its pieces one by one.")}
        </p>
        <div className="prop-actions">
          <button
            type="button"
            title={t("Dissolve the group (Ctrl+Shift+G)")}
            onClick={() =>
              void run("furniture_ungroup", { ids: [id] }).then((r) => {
                const ids = (r as { ids?: string[] } | undefined)?.ids;
                if (ids) useStore.getState().setSelection(ids);
              })
            }
          >
            {t("Ungroup")}
          </button>
        </div>
        {actions}
      </div>
    );
  }

  // Hidden pieces too (selected in the furniture list or the home details)
  let piece: Piece | null = null;
  forEveryPiece(home.furniture, (p) => {
    if (p.attrs.id === id) piece = p;
  });
  if (piece) {
    const p: Piece = piece;
    const a = p.attrs;
    const set = (field: string) => (v: string | number | boolean) =>
      void run("furniture_update", { id, [field]: v });
    if (isReference(p)) {
      // A reference object is not furniture: only what places it in the plan and 3D
      return (
        <div className="props">
          <h2>{t("Reference object")}</h2>
          {a.description && <p className="muted small">{a.description}</p>}
          <Field label={t("Name")} type="text" value={a.name} onCommit={set("name")} />
          <Field
            label={t("Visible")}
            type="checkbox"
            value={a.visible !== false}
            onCommit={set("visible")}
          />
          <Field label="X" type="number" unit="cm" value={a.x} onCommit={set("x")} />
          <Field label="Y" type="number" unit="cm" value={a.y} onCommit={set("y")} />
          <Field
            label={t("Elevation")}
            type="number"
            unit="cm"
            value={a.elevation ?? 0}
            onCommit={set("elevation")}
          />
          <Field
            label={t("Angle")}
            type="number"
            unit="°"
            value={Math.round(((a.angle ?? 0) * 1800) / Math.PI) / 10}
            onCommit={set("angle_deg")}
          />
          <p className="muted small">
            {t(
              "Shown faint under the plan of every level and as it is in 3D; it is saved as a piece of furniture, so Sweet Home 3D opens it too.",
            )}
          </p>
          <div className="prop-actions">
            <button
              type="button"
              title={t("Show it in the furniture list and let it be picked in the plan again")}
              onClick={() => set("reference")(false)}
            >
              {t("Make it a piece of furniture")}
            </button>
            <button type="button" onClick={() => void run("edit_delete", { ids: [id] })}>
              {t("Delete")}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="props">
        <h2>
          {p.kind === "DoorOrWindow"
            ? t("Door or window")
            : p.kind === "Light"
              ? t("Light")
              : t("Furniture")}
        </h2>
        <Field label={t("Name")} type="text" value={a.name} onCommit={set("name")} />
        <Field
          label={t("Description")}
          type="text"
          value={a.description ?? ""}
          onCommit={set("description")}
        />
        <SizeFields piece={p} run={run} />
        <Field
          label={t("Elevation")}
          type="number"
          unit="cm"
          value={a.elevation ?? 0}
          onCommit={set("elevation")}
        />
        <Field label="X" type="number" unit="cm" value={a.x} onCommit={set("x")} />
        <Field label="Y" type="number" unit="cm" value={a.y} onCommit={set("y")} />
        <Field
          label={t("Angle")}
          type="angle"
          unit="°"
          value={a.angle ?? 0}
          onCommit={set("angle_deg")}
        />
        {p.kind !== "DoorOrWindow" && a.horizontally_rotatable !== false && (
          <>
            <Field
              label={t("Tilt forward")}
              type="angle"
              unit="°"
              value={a.pitch ?? 0}
              onCommit={set("pitch_deg")}
            />
            <Field
              label={t("Tilt sideways")}
              type="angle"
              unit="°"
              value={a.roll ?? 0}
              onCommit={set("roll_deg")}
            />
          </>
        )}
        {p.kind === "DoorOrWindow" && <OpeningDistances piece={p} />}
        <Field label={t("Color")} type="color" value={toHex(a.color)} onCommit={set("color")} />
        {a.color !== null && (
          <button type="button" className="link-button" onClick={() => set("color")("")}>
            {t("Restore model colors")}
          </button>
        )}
        <TextureField
          label={t("Texture")}
          current={p.texture}
          onCommit={(v) => set("texture")(v)}
        />
        <label className="prop-row">
          <span className="prop-label">{t("Surface")}</span>
          <select
            value={
              a.shininess === null || a.shininess === undefined
                ? "model"
                : a.shininess > 0
                  ? "shiny"
                  : "matt"
            }
            onChange={(e) => {
              const v = e.currentTarget.value;
              set("shininess")(v === "model" ? -1 : v === "shiny" ? SHINY : 0);
            }}
          >
            <option value="model">{t("Like the model")}</option>
            <option value="matt">{t("Matt")}</option>
            <option value="shiny">{t("Shiny")}</option>
          </select>
        </label>
        <MaterialsSection piece={p} docId={opened.id} run={run} />
        {p.kind === "Light" && (
          <>
            <Field
              label={t("Light power")}
              type="number"
              unit="%"
              value={Math.round((a.power ?? 0.5) * 100)}
              onCommit={set("power")}
            />
            <Field
              label={t("Light cone")}
              type="number"
              unit="°"
              value={spotAngle(p) ?? 0}
              onCommit={set("spot_angle_deg")}
            />
            <p className="muted small">
              {t(
                "Light cone 0: the lamp lights in all directions; otherwise downwards through its bottom (tilt the lamp to aim it).",
              )}
            </p>
          </>
        )}
        <PriceFields piece={p} run={run} />
        <Field
          label={t("Mirrored")}
          type="checkbox"
          value={a.model_mirrored}
          onCommit={set("mirrored")}
        />
        <Field
          label={t("Visible")}
          type="checkbox"
          value={a.visible !== false}
          onCommit={set("visible")}
        />
        {p.kind !== "DoorOrWindow" && (
          <Field
            label={t("Part of the base plan")}
            type="checkbox"
            value={a.movable === false}
            onCommit={(v) => set("base_plan_item")(v)}
          />
        )}
        <label
          className="prop-row prop-check"
          title={t(
            "For terrain, scans and neighbor houses: faint in the plan and not picked or snapped to there (select it in the furniture list); unchanged in 3D",
          )}
        >
          <input
            type="checkbox"
            checked={isReference(p)}
            onChange={(e) => set("reference")(e.currentTarget.checked)}
          />
          <span>{t("Reference object")}</span>
        </label>
        <Field
          label={t("Name in plan")}
          type="checkbox"
          value={a.name_visible === true}
          onCommit={set("name_visible")}
        />
        {a.name_visible && (
          <TextStyleFields
            title={t("Name")}
            style={p.text_style}
            defaultSize={18}
            prefix="name_"
            onChange={(params) => void run("furniture_update", { id, ...params })}
          />
        )}
        {a.catalog_id && (
          <p className="muted small">
            {t("Catalog ID:")} {a.catalog_id}
          </p>
        )}
        {(a.creator || a.license || a.information) && (
          <p className="muted small">
            {a.creator && <>{t("Creator: {name}", { name: a.creator })} </>}
            {a.license && <>{t("License: {name}", { name: a.license })} </>}
            {a.information && <span className="selectable">{a.information}</span>}
          </p>
        )}
        {actions}
      </div>
    );
  }

  const wall = home.walls.find((w) => w.attrs.id === id);
  if (wall) {
    const a = wall.attrs;
    const set = (field: string) => (v: string | number | boolean) =>
      void run("wall_update", { id, [field]: v });
    const length = Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start);
    return (
      <div className="props">
        <h2>{t("Wall")}</h2>
        {/* The length between the end points, the same the plan shows for the selected wall */}
        <Field
          label={t("Length")}
          type="number"
          unit="cm"
          value={Math.round(length * 10) / 10}
          onCommit={set("length")}
        />
        <Field
          label={t("X start")}
          type="number"
          unit="cm"
          value={a.x_start}
          onCommit={set("x_start")}
        />
        <Field
          label={t("Y start")}
          type="number"
          unit="cm"
          value={a.y_start}
          onCommit={set("y_start")}
        />
        <Field label={t("X end")} type="number" unit="cm" value={a.x_end} onCommit={set("x_end")} />
        <Field label={t("Y end")} type="number" unit="cm" value={a.y_end} onCommit={set("y_end")} />
        <CornerAngleField label={t("Angle at start")} home={home} wall={wall} atStart run={run} />
        <CornerAngleField
          label={t("Angle at end")}
          home={home}
          wall={wall}
          atStart={false}
          run={run}
        />
        <Field
          label={t("Thickness")}
          type="number"
          unit="cm"
          value={a.thickness}
          onCommit={set("thickness")}
        />
        <Field
          label={t("Height")}
          type="number"
          unit="cm"
          value={a.height ?? home.attrs.wall_height ?? 250}
          onCommit={set("height")}
        />
        <Field
          label={t("Height at end")}
          type="number"
          unit="cm"
          value={a.height_at_end ?? a.height ?? home.attrs.wall_height ?? 250}
          onCommit={set("height_at_end")}
        />
        <SelectField
          label={t("Pattern")}
          value={a.pattern ?? "hatchUp"}
          options={WALL_PATTERNS}
          onCommit={set("pattern")}
        />
        <WallSide wall={wall} side="left" run={run} />
        <WallSide wall={wall} side="right" run={run} />
        <WallTop wall={wall} run={run} />
        {wallActions}
        {actions}
      </div>
    );
  }

  if (id === VISITOR_ID) {
    return <VisitorSection />;
  }

  if (id === "compass") {
    return (
      <div className="props">
        <CompassSection home={home} run={run} />
        <p className="muted small">
          {t(
            "Drag the compass to move it, the arrow tip to turn north, the ring to change its size.",
          )}
        </p>
      </div>
    );
  }

  const room = home.rooms.find((r) => r.attrs.id === id);
  if (room) {
    const a = room.attrs;
    const set = (field: string) => (v: string | number | boolean) =>
      void run("room_update", { id, [field]: v });
    let area = 0;
    for (let i = 0; i < room.points.length; i++) {
      const p = room.points[i];
      const q = room.points[(i + 1) % room.points.length];
      area += p.x * q.y - q.x * p.y;
    }
    return (
      <div className="props">
        <h2>{t("Room")}</h2>
        <p className="muted small">
          {t("Area:")} {formatArea(area / 2)}
        </p>
        <Field label={t("Name")} type="text" value={a.name} onCommit={set("name")} />
        <TextStyleFields
          title={t("Name")}
          style={room.text_styles?.find((t) => t.role === "nameStyle")}
          defaultSize={DEFAULT_ROOM_FONT}
          prefix="name_"
          onChange={(params) => void run("room_update", { id, ...params })}
        />
        <TextStyleFields
          title={t("Area")}
          style={room.text_styles?.find((t) => t.role === "areaStyle")}
          defaultSize={DEFAULT_ROOM_FONT}
          prefix="area_"
          onChange={(params) => void run("room_update", { id, ...params })}
        />
        <Field
          label={t("Show area")}
          type="checkbox"
          value={a.area_visible}
          onCommit={set("area_visible")}
        />
        <Field
          label={t("Floor visible")}
          type="checkbox"
          value={a.floor_visible !== false}
          onCommit={set("floor_visible")}
        />
        <Field
          label={t("Ceiling visible")}
          type="checkbox"
          value={a.ceiling_visible !== false}
          onCommit={set("ceiling_visible")}
        />
        {(a.name_x_offset != null ||
          a.name_y_offset != null ||
          a.area_x_offset != null ||
          a.area_y_offset != null) && (
          <button
            type="button"
            className="link-button"
            title={t("Place name and area automatically in the middle of the room again")}
            onClick={() => void run("room_update", { id, reset_label_positions: true })}
          >
            {t("Reset label positions")}
          </button>
        )}
        <p className="muted small">{t("Drag the name or area in the plan to move it.")}</p>
        <h3>{t("Floor")}</h3>
        <Field
          label={t("Color")}
          type="color"
          value={toHex(a.floor_color)}
          onCommit={set("floor_color")}
        />
        {a.floor_color !== null && (
          <button type="button" className="link-button" onClick={() => set("floor_color")("")}>
            {t("Default color")}
          </button>
        )}
        <TextureField
          label={t("Texture")}
          current={byRole(room.textures, "floorTexture")}
          onCommit={set("floor_texture")}
        />
        <SurfaceField value={a.floor_shininess} onCommit={set("floor_shininess")} />
        <h3>{t("Ceiling")}</h3>
        <Field
          label={t("Color")}
          type="color"
          value={toHex(a.ceiling_color)}
          onCommit={set("ceiling_color")}
        />
        {a.ceiling_color !== null && (
          <button type="button" className="link-button" onClick={() => set("ceiling_color")("")}>
            {t("Default color")}
          </button>
        )}
        <TextureField
          label={t("Texture")}
          current={byRole(room.textures, "ceilingTexture")}
          onCommit={set("ceiling_texture")}
        />
        <SurfaceField value={a.ceiling_shininess} onCommit={set("ceiling_shininess")} />
        {actions}
      </div>
    );
  }

  const guide = homeGuides(home).find((g) => g.id === id);
  if (guide) {
    const prefs = usePreferences.getState();
    const set = (field: string) => (v: string | number | boolean) =>
      void run("guide_update", { id: guide.id, [field]: v });
    return (
      <div className="props">
        <h2>{t("Ruler")}</h2>
        <Field
          label={t("Length")}
          type="number"
          unit="cm"
          value={guideLength(guide)}
          onCommit={(v) => {
            const length = Number(v);
            if (!(length >= 0.1)) return;
            const [x_end, y_end] = guideEnd(guide, length, guideAngle(guide));
            void run("guide_update", { id: guide.id, x_end, y_end });
          }}
        />
        <Field
          label={t("Angle")}
          type="number"
          unit="°"
          value={guideAngle(guide)}
          onCommit={(v) => {
            const [x_end, y_end] = guideEnd(guide, guideLength(guide), Number(v));
            void run("guide_update", { id: guide.id, x_end, y_end });
          }}
        />
        <Field
          label={t("Color")}
          type="color"
          value={guide.color ?? (prefs.rulerColor || "#b0267e")}
          onCommit={set("color")}
        />
        <SelectField
          label={t("Dashes")}
          value={guide.dash_style ?? prefs.rulerDashStyle}
          options={DASH_STYLES}
          onCommit={set("dash_style")}
        />
        {home.levels.length > 0 && (
          <label
            className="prop-row prop-check"
            title={t("Shows the ruler on every level, e.g. to line up the floors")}
          >
            <input
              type="checkbox"
              checked={guide.all_levels === true}
              onChange={(e) => set("all_levels")(e.currentTarget.checked)}
            />
            <span>{t("On all levels")}</span>
          </label>
        )}
        <p className="muted small">
          {t(
            "A guide for placing elements; it is saved with the home but not printed or exported. Drag it to move it, drag its ends to change it.",
          )}
        </p>
        <button type="button" onClick={() => void run("edit_delete", { ids: [guide.id] })}>
          {t("Delete")}
        </button>
      </div>
    );
  }

  const label = home.labels.find((l) => l.attrs.id === id);
  if (label) {
    const set = (field: string) => (v: string | number | boolean) =>
      void run("label_update", { id, [field]: v });
    return (
      <div className="props">
        <h2>{t("Label")}</h2>
        <Field label={t("Text")} type="text" value={label.text} onCommit={set("text")} />
        <Field label="X" type="number" unit="cm" value={label.attrs.x} onCommit={set("x")} />
        <Field label="Y" type="number" unit="cm" value={label.attrs.y} onCommit={set("y")} />
        <TextStyleFields
          style={label.text_style}
          defaultSize={18}
          prefix=""
          onChange={(params) => void run("label_update", { id, ...params })}
        />
        {actions}
      </div>
    );
  }

  const polyline = home.polylines.find((l) => l.attrs.id === id);
  if (polyline) {
    const a = polyline.attrs;
    const set = (field: string) => (v: string | number | boolean) =>
      void run("polyline_update", { id, [field]: v });
    return (
      <div className="props">
        <h2>{t("Line")}</h2>
        <Field
          label={t("Thickness")}
          type="number"
          unit="cm"
          value={a.thickness ?? 1}
          onCommit={set("thickness")}
        />
        <Field
          label={t("Color")}
          type="color"
          value={toHex(a.color ?? 0)}
          onCommit={set("color")}
        />
        <SelectField
          label={t("Dashes")}
          value={a.dash_style ?? "SOLID"}
          options={DASH_STYLES}
          onCommit={set("dash_style")}
        />
        <Field label={t("Closed")} type="checkbox" value={a.closed_path} onCommit={set("closed")} />
        <Field
          label={t("Curved")}
          type="checkbox"
          value={a.join_style === "CURVED"}
          onCommit={set("curved")}
        />
        <Field
          label={t("Visible in 3D")}
          type="checkbox"
          value={a.elevation !== null && a.elevation !== undefined}
          onCommit={set("visible_in_3d")}
        />
        {!a.closed_path && (
          <>
            <SelectField
              label={t("Start arrow")}
              value={a.start_arrow_style ?? "NONE"}
              options={ARROW_STYLES}
              onCommit={set("start_arrow")}
            />
            <SelectField
              label={t("End arrow")}
              value={a.end_arrow_style ?? "NONE"}
              options={ARROW_STYLES}
              onCommit={set("end_arrow")}
            />
          </>
        )}
        {actions}
      </div>
    );
  }

  const dim = home.dimension_lines.find((d) => d.attrs.id === id);
  if (dim) {
    const a = dim.attrs;
    const set = (field: string) => (v: string | number | boolean) =>
      void run("dimension_update", { id, [field]: v });
    return (
      <div className="props">
        <h2>
          {a.x_start === a.x_end && a.y_start === a.y_end ? t("Height dimension") : t("Dimension")}
        </h2>
        <p className="muted small">
          {t("Length:")}{" "}
          {formatLength(
            a.x_start === a.x_end && a.y_start === a.y_end
              ? Math.abs((a.elevation_end ?? 0) - (a.elevation_start ?? 0))
              : Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start),
          )}
        </p>
        <Field
          label={t("X start")}
          type="number"
          unit="cm"
          value={a.x_start}
          onCommit={set("x_start")}
        />
        <Field
          label={t("Y start")}
          type="number"
          unit="cm"
          value={a.y_start}
          onCommit={set("y_start")}
        />
        <Field label={t("X end")} type="number" unit="cm" value={a.x_end} onCommit={set("x_end")} />
        <Field label={t("Y end")} type="number" unit="cm" value={a.y_end} onCommit={set("y_end")} />
        <Field
          label={t("Offset")}
          type="number"
          unit="cm"
          value={a.offset}
          onCommit={set("offset")}
        />
        <TextStyleFields
          style={dim.text_style}
          defaultSize={18}
          prefix=""
          onChange={(params) => void run("dimension_update", { id, ...params })}
        />
        {actions}
      </div>
    );
  }

  return (
    <div className="props">
      <h2>{t("Element")}</h2>
      <p className="muted">{t("This element has no editable properties yet.")}</p>
      <button type="button" onClick={() => void run("edit_delete", { ids: [id] })}>
        {t("Delete")}
      </button>
    </div>
  );
}
