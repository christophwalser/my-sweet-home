// Properties of the selected element (or of the home and level if nothing is
// selected). Every change runs an *_update command: one undo step per field.

import { forEachPiece, type Piece } from "../model";
import { useStore } from "../store";

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

export default function PropertiesPanel() {
  const opened = useStore((s) => s.opened);
  const selection = useStore((s) => s.selection);
  const levelId = useStore((s) => s.selectedLevel);
  const run = useStore((s) => s.run);
  if (!opened) return <div className="props muted">No home open</div>;
  const home = opened.home;

  if (selection.length > 1) {
    return (
      <div className="props">
        <h2>{selection.length} elements selected</h2>
        <p className="muted">Drag to move, arrow keys move by 1 cm (Shift: 10 cm).</p>
        <button type="button" onClick={() => void run("edit_delete", { ids: selection })}>
          Delete
        </button>
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
        <Field
          label="Left side"
          type="color"
          value={toHex(a.left_side_color)}
          onCommit={set("left_side_color")}
        />
        <Field
          label="Right side"
          type="color"
          value={toHex(a.right_side_color)}
          onCommit={set("right_side_color")}
        />
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
        <Field
          label="Floor color"
          type="color"
          value={toHex(a.floor_color)}
          onCommit={set("floor_color")}
        />
        <Field
          label="Ceiling color"
          type="color"
          value={toHex(a.ceiling_color)}
          onCommit={set("ceiling_color")}
        />
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
