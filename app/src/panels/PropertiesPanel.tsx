// Properties of the selected element (or of the home and level if nothing is
// selected). Every change runs an *_update command: one undo step per field.

import { useEffect, useState } from "react";
import { docResourceUrl } from "../api";
import { forEachPiece, type Home, type Piece, type Wall } from "../model";
import { DEFAULT_ROOM_FONT } from "../plan2d/drawPlan";
import { useStore } from "../store";
import { modelMaterialNames } from "../view3d/models";
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
          title="Rotate this wall around the corner to a right angle (length stays)"
          onClick={() =>
            void run("wall_set_angle", {
              id: wall.attrs.id,
              at: atStart ? "start" : "end",
              angle_deg: 90,
            })
          }
        >
          Make 90°
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
  const title = side === "left" ? "Left side" : "Right side";
  const color = side === "left" ? wall.attrs.left_side_color : wall.attrs.right_side_color;
  const baseboard = wall.baseboards?.find((b) => b.attrs.role === `${side}SideBaseboard`);
  const update = (field: string, value: unknown) =>
    void run("wall_update", { id, [`${side}_side_${field}`]: value });
  const updateBaseboard = (values: Record<string, unknown>) => update("baseboard", values);
  return (
    <SideSection side={side} title={title}>
      <Field label="Color" type="color" value={toHex(color)} onCommit={(v) => update("color", v)} />
      {color !== null && (
        <button type="button" className="link-button" onClick={() => update("color", "")}>
          Default color
        </button>
      )}
      <TextureField
        label="Texture"
        current={byRole(wall.textures, `${side}SideTexture`)}
        onCommit={(v) => update("texture", v)}
      />
      <Field
        label="Baseboard"
        type="checkbox"
        value={!!baseboard}
        onCommit={(v) => updateBaseboard({ height: v ? 7 : 0 })}
      />
      {baseboard && (
        <>
          <Field
            label="Height"
            type="number"
            unit="cm"
            value={baseboard.attrs.height}
            onCommit={(v) => updateBaseboard({ height: v })}
          />
          <Field
            label="Thickness"
            type="number"
            unit="cm"
            value={baseboard.attrs.thickness}
            onCommit={(v) => updateBaseboard({ thickness: v })}
          />
          <Field
            label="Color"
            type="color"
            value={toHex(baseboard.attrs.color ?? color)}
            onCommit={(v) => updateBaseboard({ color: v })}
          />
          <TextureField
            label="Texture"
            current={baseboard.texture}
            onCommit={(v) => updateBaseboard({ texture: v })}
          />
        </>
      )}
    </SideSection>
  );
}

/** Compass of the home: position, size, north direction and geographic position. */
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
      <h2>Compass</h2>
      <Field
        label="Visible"
        type="checkbox"
        value={c ? c.visible !== false : false}
        onCommit={set("visible")}
      />
      <Field label="X" type="number" unit="cm" value={c?.x ?? -100} onCommit={set("x")} />
      <Field label="Y" type="number" unit="cm" value={c?.y ?? 50} onCommit={set("y")} />
      <Field
        label="Diameter"
        type="number"
        unit="cm"
        value={c?.diameter ?? 100}
        onCommit={set("diameter")}
      />
      <Field
        label="North"
        type="number"
        unit="°"
        value={deg(c?.north_direction) ?? 0}
        onCommit={set("north_direction_deg")}
      />
      <Field
        label="Latitude"
        type="number"
        unit="°"
        value={deg(c?.latitude)}
        onCommit={set("latitude_deg")}
      />
      <Field
        label="Longitude"
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
        {open ? "▾" : "▸"} Materials{changed.length > 0 ? ` (${changed.length} changed)` : ""}
      </button>
      {open && names === null && <p className="muted small">Loading materials…</p>}
      {open && names?.length === 0 && (
        <p className="muted small">The model has no named materials.</p>
      )}
      {open &&
        names?.map((name) => {
          const m = changed.find((c) => c.attrs.name === name);
          return (
            <fieldset key={name} className="material-row">
              <legend>{name}</legend>
              <Field
                label="Color"
                type="color"
                value={toHex(m?.attrs.color ?? 0xffffff)}
                onCommit={(v) => change(name, { color: v })}
              />
              <TextureField
                label="Texture"
                current={m?.texture ?? null}
                onCommit={(v) => change(name, { texture: v })}
              />
              <Field
                label="Shininess"
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
                  Model material
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
          Reset all materials
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
  if (!opened) return <div className="props muted">No home open</div>;
  const home = opened.home;

  const actions = (
    <div className="prop-actions">
      <button
        type="button"
        onClick={() => void run("edit_copy", { ids: selection })}
        title="Ctrl+C"
      >
        Copy
      </button>
      <button
        type="button"
        onClick={() => void run("edit_flip", { ids: selection, axis: "horizontal" })}
        title="Mirror left ↔ right (furniture gets a mirrored model)"
      >
        Flip ↔
      </button>
      <button
        type="button"
        onClick={() => void run("edit_flip", { ids: selection, axis: "vertical" })}
        title="Mirror top ↔ bottom (furniture gets a mirrored model)"
      >
        Flip ↕
      </button>
      <button
        type="button"
        title="Ctrl+D"
        onClick={() =>
          void run("edit_duplicate", { ids: selection }).then((r) => {
            const ids = (r as { ids?: string[] } | undefined)?.ids;
            if (ids) useStore.getState().setSelection(ids);
          })
        }
      >
        Duplicate
      </button>
      <button type="button" onClick={() => void run("edit_delete", { ids: selection })} title="Del">
        Delete
      </button>
    </div>
  );

  const selectedWalls = home.walls.filter((w) => selection.includes(w.attrs.id));
  const wallActions = selectedWalls.length > 0 && (
    <div className="prop-actions">
      {selectedWalls.length === 2 && (
        <button
          type="button"
          title="Extend or shorten both walls to the intersection of their axes and connect them (J)"
          onClick={() => void run("wall_join", { ids: selectedWalls.map((w) => w.attrs.id) })}
        >
          Join walls
        </button>
      )}
      {selectedWalls.length === 1 && (
        <button
          type="button"
          title="Split the wall into two connected walls at its middle"
          onClick={() =>
            void run("wall_split", { id: selectedWalls[0].attrs.id }).then((r) => {
              const ids = (r as { ids?: string[] } | undefined)?.ids;
              if (ids) useStore.getState().setSelection(ids);
            })
          }
        >
          Split
        </button>
      )}
      {selectedWalls.some((w) => w.attrs.wall_at_start || w.attrs.wall_at_end) && (
        <button
          type="button"
          title="Remove the connections of the selected walls"
          onClick={() => void run("wall_detach", { ids: selectedWalls.map((w) => w.attrs.id) })}
        >
          Detach
        </button>
      )}
    </div>
  );

  const topFurniture = home.furniture.filter((f) => f.attrs.id && selection.includes(f.attrs.id));
  const groupButton = topFurniture.length > 1 && (
    <div className="prop-actions">
      <button
        type="button"
        title="Group the selected furniture (Ctrl+G)"
        onClick={() =>
          void run("furniture_group", { ids: topFurniture.map((f) => f.attrs.id) }).then((r) => {
            const gid = (r as { id?: string } | undefined)?.id;
            if (gid) useStore.getState().setSelection([gid]);
          })
        }
      >
        Group
      </button>
    </div>
  );

  if (selection.length > 1) {
    return (
      <div className="props">
        <p className="muted small">
          {selection.length} elements selected · changes apply to all of the same kind
        </p>
        {selectedWalls.length === 2 &&
          (() => {
            const [w1, w2] = selectedWalls;
            // The corner where the second wall is joined to the first one
            const atStart = w2.attrs.wall_at_start === w1.attrs.id;
            const joined = atStart || w2.attrs.wall_at_end === w1.attrs.id;
            return joined ? (
              <CornerAngleField
                label="Angle between"
                home={home}
                wall={w2}
                atStart={atStart}
                run={run}
              />
            ) : null;
          })()}
        {selectedWalls.length === 2 && (
          <p className="muted small">
            Join walls connects both walls at the intersection of their axes (corner or T junction).
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
        <h2>Home</h2>
        <Field
          label="Name"
          type="text"
          value={home.attrs.name}
          onCommit={(v) => void run("home_set", { name: v })}
        />
        <Field
          label="Wall height"
          type="number"
          unit="cm"
          value={home.attrs.wall_height ?? 250}
          onCommit={(v) => void run("home_set", { wall_height: v })}
        />
        {level && (
          <>
            <h2>Level</h2>
            <Field
              label="Name"
              type="text"
              value={level.attrs.name}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, name: v })}
            />
            <Field
              label="Elevation"
              type="number"
              unit="cm"
              value={level.attrs.elevation}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, elevation: v })}
            />
            <Field
              label="Height"
              type="number"
              unit="cm"
              value={level.attrs.height}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, height: v })}
            />
            <Field
              label="Floor thickness"
              type="number"
              unit="cm"
              value={level.attrs.floor_thickness}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, floor_thickness: v })}
            />
            <Field
              label="Visible in 3D"
              type="checkbox"
              value={level.attrs.viewable !== false}
              onCommit={(v) => void run("level_update", { id: level.attrs.id, viewable: v })}
            />
            <div className="prop-actions">
              <button
                type="button"
                title="Add a level with the same elevation (e.g. a mezzanine or split level)"
                onClick={() =>
                  void run("level_add", {
                    name: `${level.attrs.name} (2)`,
                    elevation: level.attrs.elevation,
                    height: level.attrs.height,
                    floor_thickness: level.attrs.floor_thickness,
                  })
                }
              >
                Add level at same elevation
              </button>
              <button
                type="button"
                title="Delete this level and everything on it (Ctrl+Z restores it)"
                onClick={() => void run("edit_delete", { ids: [level.attrs.id] })}
              >
                Delete level
              </button>
            </div>
          </>
        )}
        {level ? (
          <BackgroundImageSection
            levelId={level.attrs.id}
            title={level.attrs.name}
            background={level.background_image ?? null}
          />
        ) : (
          home.levels.length === 0 && (
            <BackgroundImageSection
              levelId={null}
              title="Home"
              background={home.background_image ?? null}
            />
          )
        )}
        <CompassSection home={home} run={run} />
        <p className="muted">Click an element in the plan to edit it.</p>
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
        <h2>Group</h2>
        <p className="muted small">
          {group.attrs.name} · {count} pieces
        </p>
        <p className="muted small">
          Drag to move the group. Ungroup to edit its pieces one by one.
        </p>
        <div className="prop-actions">
          <button
            type="button"
            title="Dissolve the group (Ctrl+Shift+G)"
            onClick={() =>
              void run("furniture_ungroup", { ids: [id] }).then((r) => {
                const ids = (r as { ids?: string[] } | undefined)?.ids;
                if (ids) useStore.getState().setSelection(ids);
              })
            }
          >
            Ungroup
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
            ? "Door or window"
            : p.kind === "Light"
              ? "Light"
              : "Furniture"}
        </h2>
        <Field label="Name" type="text" value={a.name} onCommit={set("name")} />
        <Field label="X" type="number" unit="cm" value={a.x} onCommit={set("x")} />
        <Field label="Y" type="number" unit="cm" value={a.y} onCommit={set("y")} />
        <Field
          label="Elevation"
          type="number"
          unit="cm"
          value={a.elevation ?? 0}
          onCommit={set("elevation")}
        />
        <Field
          label="Angle"
          type="angle"
          unit="°"
          value={a.angle ?? 0}
          onCommit={set("angle_deg")}
        />
        {p.kind === "DoorOrWindow" && <OpeningDistances piece={p} />}
        <Field label="Width" type="number" unit="cm" value={a.width} onCommit={set("width")} />
        <Field label="Depth" type="number" unit="cm" value={a.depth} onCommit={set("depth")} />
        <Field label="Height" type="number" unit="cm" value={a.height} onCommit={set("height")} />
        <Field label="Color" type="color" value={toHex(a.color)} onCommit={set("color")} />
        {a.color !== null && (
          <button type="button" className="link-button" onClick={() => set("color")("")}>
            Restore model colors
          </button>
        )}
        <Field
          label="Mirrored"
          type="checkbox"
          value={a.model_mirrored}
          onCommit={set("mirrored")}
        />
        <Field
          label="Visible"
          type="checkbox"
          value={a.visible !== false}
          onCommit={set("visible")}
        />
        <MaterialsSection piece={p} docId={opened.id} run={run} />
        {a.catalog_id && <p className="muted small">Catalog ID: {a.catalog_id}</p>}
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
        <h2>Wall</h2>
        <p className="muted small">Length: {(length / 100).toFixed(2)} m</p>
        <Field
          label="X start"
          type="number"
          unit="cm"
          value={a.x_start}
          onCommit={set("x_start")}
        />
        <Field
          label="Y start"
          type="number"
          unit="cm"
          value={a.y_start}
          onCommit={set("y_start")}
        />
        <Field label="X end" type="number" unit="cm" value={a.x_end} onCommit={set("x_end")} />
        <Field label="Y end" type="number" unit="cm" value={a.y_end} onCommit={set("y_end")} />
        <CornerAngleField label="Angle at start" home={home} wall={wall} atStart run={run} />
        <CornerAngleField label="Angle at end" home={home} wall={wall} atStart={false} run={run} />
        <Field
          label="Thickness"
          type="number"
          unit="cm"
          value={a.thickness}
          onCommit={set("thickness")}
        />
        <Field
          label="Height"
          type="number"
          unit="cm"
          value={a.height ?? home.attrs.wall_height ?? 250}
          onCommit={set("height")}
        />
        <Field
          label="Height at end"
          type="number"
          unit="cm"
          value={a.height_at_end ?? a.height ?? home.attrs.wall_height ?? 250}
          onCommit={set("height_at_end")}
        />
        <SelectField
          label="Pattern"
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
        <h2>Room</h2>
        <p className="muted small">Area: {(Math.abs(area) / 20000).toFixed(2)} m²</p>
        <Field label="Name" type="text" value={a.name} onCommit={set("name")} />
        <Field
          label="Name size"
          type="number"
          unit="cm"
          value={
            room.text_styles?.find((t) => t.role === "nameStyle")?.font_size ?? DEFAULT_ROOM_FONT
          }
          onCommit={set("name_font_size")}
        />
        <Field
          label="Area size"
          type="number"
          unit="cm"
          value={
            room.text_styles?.find((t) => t.role === "areaStyle")?.font_size ?? DEFAULT_ROOM_FONT
          }
          onCommit={set("area_font_size")}
        />
        <Field
          label="Show area"
          type="checkbox"
          value={a.area_visible}
          onCommit={set("area_visible")}
        />
        <Field
          label="Floor visible"
          type="checkbox"
          value={a.floor_visible !== false}
          onCommit={set("floor_visible")}
        />
        <Field
          label="Ceiling visible"
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
            title="Place name and area automatically in the middle of the room again"
            onClick={() => void run("room_update", { id, reset_label_positions: true })}
          >
            Reset label positions
          </button>
        )}
        <p className="muted small">Drag the name or area in the plan to move it.</p>
        <h3>Floor</h3>
        <Field
          label="Color"
          type="color"
          value={toHex(a.floor_color)}
          onCommit={set("floor_color")}
        />
        {a.floor_color !== null && (
          <button type="button" className="link-button" onClick={() => set("floor_color")("")}>
            Default color
          </button>
        )}
        <TextureField
          label="Texture"
          current={byRole(room.textures, "floorTexture")}
          onCommit={set("floor_texture")}
        />
        <h3>Ceiling</h3>
        <Field
          label="Color"
          type="color"
          value={toHex(a.ceiling_color)}
          onCommit={set("ceiling_color")}
        />
        {a.ceiling_color !== null && (
          <button type="button" className="link-button" onClick={() => set("ceiling_color")("")}>
            Default color
          </button>
        )}
        <TextureField
          label="Texture"
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
        <h2>Label</h2>
        <Field label="Text" type="text" value={label.text} onCommit={set("text")} />
        <Field label="X" type="number" unit="cm" value={label.attrs.x} onCommit={set("x")} />
        <Field label="Y" type="number" unit="cm" value={label.attrs.y} onCommit={set("y")} />
        <Field
          label="Font size"
          type="number"
          unit="cm"
          value={label.text_style?.font_size ?? 18}
          onCommit={set("font_size")}
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
        <h2>Line</h2>
        <Field
          label="Thickness"
          type="number"
          unit="cm"
          value={a.thickness ?? 1}
          onCommit={set("thickness")}
        />
        <Field label="Color" type="color" value={toHex(a.color ?? 0)} onCommit={set("color")} />
        <SelectField
          label="Dashes"
          value={a.dash_style ?? "SOLID"}
          options={DASH_STYLES}
          onCommit={set("dash_style")}
        />
        <Field label="Closed" type="checkbox" value={a.closed_path} onCommit={set("closed")} />
        {!a.closed_path && (
          <>
            <SelectField
              label="Start arrow"
              value={a.start_arrow_style ?? "NONE"}
              options={ARROW_STYLES}
              onCommit={set("start_arrow")}
            />
            <SelectField
              label="End arrow"
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
        <h2>Dimension</h2>
        <p className="muted small">
          Length: {(Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start) / 100).toFixed(2)} m
        </p>
        <Field
          label="X start"
          type="number"
          unit="cm"
          value={a.x_start}
          onCommit={set("x_start")}
        />
        <Field
          label="Y start"
          type="number"
          unit="cm"
          value={a.y_start}
          onCommit={set("y_start")}
        />
        <Field label="X end" type="number" unit="cm" value={a.x_end} onCommit={set("x_end")} />
        <Field label="Y end" type="number" unit="cm" value={a.y_end} onCommit={set("y_end")} />
        <Field label="Offset" type="number" unit="cm" value={a.offset} onCommit={set("offset")} />
        {actions}
      </div>
    );
  }

  return (
    <div className="props">
      <h2>Element</h2>
      <p className="muted">This element has no editable properties yet.</p>
      <button type="button" onClick={() => void run("edit_delete", { ids: [id] })}>
        Delete
      </button>
    </div>
  );
}
