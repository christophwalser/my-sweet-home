// Properties of the selected element (or of the home and level if nothing is
// selected). Every change runs an *_update command: one undo step per field.

import { useEffect, useState } from "react";
import { docResourceUrl } from "../api";
import { t } from "../i18n";
import { forEachPiece, type Home, type Piece, type Wall } from "../model";
import { DEFAULT_ROOM_FONT } from "../plan2d/drawPlan";
import { currentVisitor, setVisitor, useStore, VISITOR_ID } from "../store";
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
import MultiPanel from "./MultiPanel";
import OpeningDistances from "./OpeningDistances";
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

/** Compass of the home: position, size, north direction and geographic position. */
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
  const deg = (rad: number | null | undefined) =>
    rad == null ? null : Math.round(((rad * 180) / Math.PI) * 100) / 100;
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
      <Field
        label={t("North")}
        type="number"
        unit="°"
        value={deg(c?.north_direction) ?? 0}
        onCommit={set("north_direction_deg")}
      />
      <Field
        label={t("Latitude")}
        type="number"
        unit="°"
        value={deg(c?.latitude)}
        onCommit={set("latitude_deg")}
      />
      <Field
        label={t("Longitude")}
        type="number"
        unit="°"
        value={deg(c?.longitude)}
        onCommit={set("longitude_deg")}
      />
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

  let piece: Piece | null = null;
  forEachPiece(home.furniture, (p) => {
    if (p.attrs.id === id) piece = p;
  });
  if (piece) {
    const p: Piece = piece;
    const a = p.attrs;
    const set = (field: string) => (v: string | number | boolean) =>
      void run("furniture_update", { id, [field]: v });
    return (
      <div className="props">
        <h2>
          {p.kind === "DoorOrWindow"
            ? t("Door or window")
            : p.kind === t("Light")
              ? t("Light")
              : t("Furniture")}
        </h2>
        <Field label={t("Name")} type="text" value={a.name} onCommit={set("name")} />
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
        <Field label={t("Width")} type="number" unit="cm" value={a.width} onCommit={set("width")} />
        <Field label={t("Depth")} type="number" unit="cm" value={a.depth} onCommit={set("depth")} />
        <Field
          label={t("Height")}
          type="number"
          unit="cm"
          value={a.height}
          onCommit={set("height")}
        />
        {p.kind === t("Light") && (
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
        <Field label={t("Color")} type="color" value={toHex(a.color)} onCommit={set("color")} />
        {a.color !== null && (
          <button type="button" className="link-button" onClick={() => set("color")("")}>
            {t("Restore model colors")}
          </button>
        )}
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
        <MaterialsSection piece={p} docId={opened.id} run={run} />
        {a.catalog_id && (
          <p className="muted small">
            {t("Catalog ID:")} {a.catalog_id}
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
        <p className="muted small">
          {t("Length:")} {formatLength(length)}
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
        {actions}
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
          {(
            (a.x_start === a.x_end && a.y_start === a.y_end
              ? Math.abs((a.elevation_end ?? 0) - (a.elevation_start ?? 0))
              : Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start)) / 100
          ).toFixed(2)}{" "}
          m
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
