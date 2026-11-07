// Properties of the selected element (or of the home and level if nothing is
// selected). Every change runs an *_update command: one undo step per field.

import { forEachPiece, type Piece, type Texture, type Wall } from "../model";
import { useStore } from "../store";
import TextureField from "./TextureField";

type FieldType = "number" | "text" | "color" | "checkbox" | "angle";

type FieldProps = {
  label: string;
  type: FieldType;
  value: string | number | boolean | null | undefined;
  unit?: string;
  onCommit: (value: string | number | boolean) => void;
};

function toHex(argb: number | null | undefined): string {
  if (argb === null || argb === undefined) return "#ffffff";
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** Input that commits on Enter or blur, not on every keystroke. */
function Field({ label, type, value, unit, onCommit }: FieldProps) {
  if (type === "checkbox") {
    return (
      <label className="prop-row prop-check">
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onCommit(e.currentTarget.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }
  const display =
    type === "angle" && typeof value === "number"
      ? Math.round(((value * 180) / Math.PI) * 10) / 10
      : typeof value === "number"
        ? Math.round(value * 10) / 10
        : (value ?? "");
  const commit = (raw: string) => {
    if (type === "number" || type === "angle") {
      const n = Number.parseFloat(raw.replace(",", "."));
      if (Number.isFinite(n) && n !== display) onCommit(n);
    } else if (raw !== display) {
      onCommit(raw);
    }
  };
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <input
        // Re-create the input when the value changes from outside (undo, CLI, MCP)
        key={String(display)}
        type={type === "color" ? "color" : "text"}
        inputMode={type === "number" || type === "angle" ? "decimal" : undefined}
        defaultValue={String(display)}
        // Also for colors: one command (and undo step) when leaving the field
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
      />
      {unit && <span className="prop-unit">{unit}</span>}
    </label>
  );
}

/** Drop-down field that commits on change. */
function SelectField({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onCommit: (value: string) => void;
}) {
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <select value={value} onChange={(e) => onCommit(e.currentTarget.value)}>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const WALL_PATTERNS: [string, string][] = [
  ["hatchUp", "Hatch up"],
  ["hatchDown", "Hatch down"],
  ["reversedHatchUp", "Reversed hatch up"],
  ["reversedHatchDown", "Reversed hatch down"],
  ["crossHatch", "Cross hatch"],
  ["background", "Background"],
  ["foreground", "Foreground"],
];

const DASH_STYLES: [string, string][] = [
  ["SOLID", "Solid"],
  ["DOT", "Dot"],
  ["DASH", "Dash"],
  ["DASH_DOT", "Dash dot"],
  ["DASH_DOT_DOT", "Dash dot dot"],
];

const ARROW_STYLES: [string, string][] = [
  ["NONE", "None"],
  ["DELTA", "Triangle"],
  ["OPEN", "Open"],
  ["DISC", "Disc"],
];

const byRole = (textures: Texture[] | undefined, role: string) =>
  textures?.find((t) => t.role === role) ?? null;

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
    <>
      <h3>{title}</h3>
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

  if (selection.length > 1) {
    return (
      <div className="props">
        <h2>{selection.length} elements selected</h2>
        <p className="muted">Drag to move, arrow keys move by 1 cm (Shift: 10 cm).</p>
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
          </>
        )}
        <p className="muted">Click an element in the plan to edit it.</p>
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
