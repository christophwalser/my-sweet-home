// Shared properties of several selected elements of the same kind (walls, rooms,
// furniture). A field shows the common value or "mixed"; a change applies to all
// selected elements of that kind in one command (one undo step).

import { forEachPiece, type Home, type Piece, type Room, type Texture, type Wall } from "../model";
import { byRole, Field, SelectField, SideSection, toHex, WALL_PATTERNS } from "./fields";
import TextureField from "./TextureField";

type Run = (command: string, params: Record<string, unknown>) => Promise<unknown>;

/** Common value of all items, or `undefined` if they differ ("mixed"). */
function common<T>(values: T[]): { value: T | undefined; mixed: boolean } {
  if (values.length === 0) return { value: undefined, mixed: false };
  const first = values[0];
  const same = values.every((v) => v === first);
  return { value: same ? first : undefined, mixed: !same };
}

/** Common texture (by image) of all items. */
function commonTexture(textures: (Texture | null)[]): { value: Texture | null; mixed: boolean } {
  const c = common(textures.map((t) => t?.image ?? null));
  return { value: c.mixed ? null : (textures[0] ?? null), mixed: c.mixed };
}

function WallsSection({ walls, home, run }: { walls: Wall[]; home: Home; run: Run }) {
  const ids = walls.map((w) => w.attrs.id);
  const update = (values: Record<string, unknown>) => void run("wall_update", { ids, ...values });
  const set = (field: string) => (v: string | number | boolean) => update({ [field]: v });
  const defaultHeight = home.attrs.wall_height ?? 250;
  const thickness = common(walls.map((w) => w.attrs.thickness));
  const height = common(walls.map((w) => w.attrs.height ?? defaultHeight));
  const heightAtEnd = common(
    walls.map((w) => w.attrs.height_at_end ?? w.attrs.height ?? defaultHeight),
  );
  const pattern = common(walls.map((w) => w.attrs.pattern ?? "hatchUp"));
  const totalLength = walls.reduce(
    (sum, w) => sum + Math.hypot(w.attrs.x_end - w.attrs.x_start, w.attrs.y_end - w.attrs.y_start),
    0,
  );
  return (
    <>
      <h2>{walls.length} walls</h2>
      <p className="muted small">Total length: {(totalLength / 100).toFixed(2)} m</p>
      <Field
        label="Thickness"
        type="number"
        unit="cm"
        value={thickness.value}
        mixed={thickness.mixed}
        onCommit={set("thickness")}
      />
      <Field
        label="Height"
        type="number"
        unit="cm"
        value={height.value}
        mixed={height.mixed}
        onCommit={set("height")}
      />
      <Field
        label="Height at end"
        type="number"
        unit="cm"
        value={heightAtEnd.value}
        mixed={heightAtEnd.mixed}
        onCommit={set("height_at_end")}
      />
      <SelectField
        label="Pattern"
        value={pattern.value ?? ""}
        mixed={pattern.mixed}
        options={WALL_PATTERNS}
        onCommit={set("pattern")}
      />
      {(["left", "right"] as const).map((side) => (
        <WallsSide key={side} walls={walls} side={side} update={update} />
      ))}
    </>
  );
}

/** Color, texture and baseboard of one side of several walls. */
function WallsSide({
  walls,
  side,
  update,
}: {
  walls: Wall[];
  side: "left" | "right";
  update: (values: Record<string, unknown>) => void;
}) {
  const field = (name: string) => `${side}_side_${name}`;
  const color = common(
    walls.map((w) => (side === "left" ? w.attrs.left_side_color : w.attrs.right_side_color)),
  );
  const texture = commonTexture(walls.map((w) => byRole(w.textures, `${side}SideTexture`)));
  const baseboards = walls.map(
    (w) => w.baseboards?.find((b) => b.attrs.role === `${side}SideBaseboard`) ?? null,
  );
  const hasBaseboard = common(baseboards.map((b) => b !== null));
  const present = baseboards.filter((b) => b !== null);
  const bbHeight = common(present.map((b) => b.attrs.height));
  const bbThickness = common(present.map((b) => b.attrs.thickness));
  const bbColor = common(present.map((b) => b.attrs.color));
  const bbTexture = commonTexture(present.map((b) => b.texture));
  const updateBaseboard = (values: Record<string, unknown>) =>
    update({ [field("baseboard")]: values });
  return (
    <SideSection side={side} title={side === "left" ? "Left sides" : "Right sides"}>
      <Field
        label="Color"
        type="color"
        value={toHex(color.value)}
        mixed={color.mixed}
        onCommit={(v) => update({ [field("color")]: v })}
      />
      {(color.mixed || color.value !== null) && (
        <button
          type="button"
          className="link-button"
          onClick={() => update({ [field("color")]: "" })}
        >
          Default color
        </button>
      )}
      <TextureField
        label="Texture"
        current={texture.value}
        mixed={texture.mixed}
        onCommit={(v) => update({ [field("texture")]: v })}
      />
      <Field
        label="Baseboard"
        type="checkbox"
        value={hasBaseboard.value}
        mixed={hasBaseboard.mixed}
        onCommit={(v) =>
          // Walls that already have one keep its size when it is switched on for all
          updateBaseboard(v ? { height: bbHeight.value ?? 7 } : { height: 0 })
        }
      />
      {present.length > 0 && (
        <>
          <Field
            label="Height"
            type="number"
            unit="cm"
            value={bbHeight.value}
            mixed={bbHeight.mixed}
            onCommit={(v) => updateBaseboard({ height: v })}
          />
          <Field
            label="Thickness"
            type="number"
            unit="cm"
            value={bbThickness.value}
            mixed={bbThickness.mixed}
            onCommit={(v) => updateBaseboard({ thickness: v })}
          />
          <Field
            label="Color"
            type="color"
            value={toHex(bbColor.value)}
            mixed={bbColor.mixed}
            onCommit={(v) => updateBaseboard({ color: v })}
          />
          <TextureField
            label="Texture"
            current={bbTexture.value}
            mixed={bbTexture.mixed}
            onCommit={(v) => updateBaseboard({ texture: v })}
          />
        </>
      )}
    </SideSection>
  );
}

function roomArea(room: Room): number {
  let area = 0;
  for (let i = 0; i < room.points.length; i++) {
    const p = room.points[i];
    const q = room.points[(i + 1) % room.points.length];
    area += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area) / 2;
}

function RoomsSection({ rooms, run }: { rooms: Room[]; run: Run }) {
  const ids = rooms.map((r) => r.attrs.id).filter((id): id is string => !!id);
  const update = (values: Record<string, unknown>) => void run("room_update", { ids, ...values });
  const set = (field: string) => (v: string | number | boolean) => update({ [field]: v });
  const areaVisible = common(rooms.map((r) => !!r.attrs.area_visible));
  const floorVisible = common(rooms.map((r) => r.attrs.floor_visible !== false));
  const ceilingVisible = common(rooms.map((r) => r.attrs.ceiling_visible !== false));
  const floorColor = common(rooms.map((r) => r.attrs.floor_color));
  const ceilingColor = common(rooms.map((r) => r.attrs.ceiling_color));
  const floorTexture = commonTexture(rooms.map((r) => byRole(r.textures, "floorTexture")));
  const ceilingTexture = commonTexture(rooms.map((r) => byRole(r.textures, "ceilingTexture")));
  const area = rooms.reduce((sum, r) => sum + roomArea(r), 0);
  return (
    <>
      <h2>{rooms.length} rooms</h2>
      <p className="muted small">Total area: {(area / 10000).toFixed(2)} m²</p>
      <Field
        label="Show area"
        type="checkbox"
        value={areaVisible.value}
        mixed={areaVisible.mixed}
        onCommit={set("area_visible")}
      />
      <Field
        label="Floor visible"
        type="checkbox"
        value={floorVisible.value}
        mixed={floorVisible.mixed}
        onCommit={set("floor_visible")}
      />
      <Field
        label="Ceiling visible"
        type="checkbox"
        value={ceilingVisible.value}
        mixed={ceilingVisible.mixed}
        onCommit={set("ceiling_visible")}
      />
      <h3>Floors</h3>
      <Field
        label="Color"
        type="color"
        value={toHex(floorColor.value)}
        mixed={floorColor.mixed}
        onCommit={set("floor_color")}
      />
      <TextureField
        label="Texture"
        current={floorTexture.value}
        mixed={floorTexture.mixed}
        onCommit={set("floor_texture")}
      />
      <h3>Ceilings</h3>
      <Field
        label="Color"
        type="color"
        value={toHex(ceilingColor.value)}
        mixed={ceilingColor.mixed}
        onCommit={set("ceiling_color")}
      />
      <TextureField
        label="Texture"
        current={ceilingTexture.value}
        mixed={ceilingTexture.mixed}
        onCommit={set("ceiling_texture")}
      />
    </>
  );
}

function FurnitureSection({ pieces, run }: { pieces: Piece[]; run: Run }) {
  const ids = pieces.map((p) => p.attrs.id).filter((id): id is string => !!id);
  const set = (field: string) => (v: string | number | boolean) =>
    void run("furniture_update", { ids, [field]: v });
  const elevation = common(pieces.map((p) => p.attrs.elevation ?? 0));
  const angle = common(pieces.map((p) => Math.round(((p.attrs.angle ?? 0) * 1800) / Math.PI) / 10));
  const width = common(pieces.map((p) => p.attrs.width));
  const depth = common(pieces.map((p) => p.attrs.depth));
  const height = common(pieces.map((p) => p.attrs.height));
  const color = common(pieces.map((p) => p.attrs.color));
  const visible = common(pieces.map((p) => p.attrs.visible !== false));
  const mirrored = common(pieces.map((p) => !!p.attrs.model_mirrored));
  return (
    <>
      <h2>{pieces.length} pieces of furniture</h2>
      <Field
        label="Elevation"
        type="number"
        unit="cm"
        value={elevation.value}
        mixed={elevation.mixed}
        onCommit={set("elevation")}
      />
      <Field
        label="Angle"
        type="number"
        unit="°"
        value={angle.value}
        mixed={angle.mixed}
        onCommit={set("angle_deg")}
      />
      <Field
        label="Width"
        type="number"
        unit="cm"
        value={width.value}
        mixed={width.mixed}
        onCommit={set("width")}
      />
      <Field
        label="Depth"
        type="number"
        unit="cm"
        value={depth.value}
        mixed={depth.mixed}
        onCommit={set("depth")}
      />
      <Field
        label="Height"
        type="number"
        unit="cm"
        value={height.value}
        mixed={height.mixed}
        onCommit={set("height")}
      />
      <Field
        label="Color"
        type="color"
        value={toHex(color.value)}
        mixed={color.mixed}
        onCommit={set("color")}
      />
      {(color.mixed || color.value !== null) && (
        <button type="button" className="link-button" onClick={() => set("color")("")}>
          Restore model colors
        </button>
      )}
      <Field
        label="Mirrored"
        type="checkbox"
        value={mirrored.value}
        mixed={mirrored.mixed}
        onCommit={set("mirrored")}
      />
      <Field
        label="Visible"
        type="checkbox"
        value={visible.value}
        mixed={visible.mixed}
        onCommit={set("visible")}
      />
    </>
  );
}

/** Sections for the walls, rooms and furniture among the selected elements. */
export default function MultiPanel({
  home,
  selection,
  run,
}: {
  home: Home;
  selection: string[];
  run: Run;
}) {
  const sel = new Set(selection);
  const walls = home.walls.filter((w) => sel.has(w.attrs.id));
  const rooms = home.rooms.filter((r) => r.attrs.id && sel.has(r.attrs.id));
  const pieces: Piece[] = [];
  forEachPiece(home.furniture, (p) => {
    if (p.attrs.id && sel.has(p.attrs.id)) pieces.push(p);
  });
  return (
    <>
      {walls.length > 0 && <WallsSection walls={walls} home={home} run={run} />}
      {rooms.length > 0 && <RoomsSection rooms={rooms} run={run} />}
      {pieces.length > 0 && <FurnitureSection pieces={pieces} run={run} />}
    </>
  );
}
