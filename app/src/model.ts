// TypeScript view of the home model as serialized by the Rust backend
// (crates/msh-model). Only the fields used by the frontend are declared.
// Lengths are in centimeters, angles in radians, colors are ARGB numbers.

export type Pt = [number, number];

export type TextStyle = {
  role: string | null;
  font_name: string | null;
  font_size: number;
  bold: boolean | null;
  italic: boolean | null;
  alignment: string | null;
};

export type Texture = {
  role: string | null;
  name: string;
  image: string;
  width: number;
  height: number;
  angle: number | null;
  scale: number | null;
};

export type Level = {
  attrs: {
    id: string;
    name: string;
    elevation: number;
    floor_thickness: number;
    height: number;
    elevation_index: number | null;
    visible: boolean | null;
    viewable: boolean | null;
  };
};

export type Camera = {
  observer: boolean;
  attrs: {
    role: string;
    name: string | null;
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    field_of_view: number;
  };
};

export type PieceKind = "Piece" | "DoorOrWindow" | "Light" | "ShelfUnit";

export type Material = {
  attrs: { name: string; key: string | null; color: number | null; shininess: number | null };
  texture: Texture | null;
};

export type Sash = {
  x_axis: number;
  y_axis: number;
  width: number;
  start_angle: number;
  end_angle: number;
};

/** Light source of a lamp; x, y and z are relative to the piece's width, depth and height. */
export type LightSource = {
  x: number;
  y: number;
  z: number;
  color: number;
  diameter: number | null;
};

export type Piece = {
  type: "piece";
  kind: PieceKind;
  attrs: {
    id: string | null;
    level: string | null;
    catalog_id: string | null;
    name: string;
    model: string | null;
    icon: string | null;
    plan_icon: string | null;
    x: number;
    y: number;
    elevation: number | null;
    angle: number | null;
    pitch: number | null;
    roll: number | null;
    /** Size of the bounding box after pitch/roll (plan footprint and height) */
    width_in_plan: number | null;
    depth_in_plan: number | null;
    height_in_plan: number | null;
    width: number;
    depth: number;
    resizable: boolean | null;
    /** `false`: width, depth and height only change proportionally */
    deformable: boolean | null;
    height: number;
    visible: boolean | null;
    model_mirrored: boolean | null;
    model_rotation: string | null;
    name_visible: boolean | null;
    name_x_offset: number | null;
    name_y_offset: number | null;
    color: number | null;
    shininess: number | null;
    back_face_shown: boolean | null;
    wall_thickness: number | null;
    wall_distance: number | null;
    wall_width: number | null;
    wall_left: number | null;
    wall_height: number | null;
    wall_top: number | null;
    cut_out_shape: string | null;
    power: number | null;
  };
  sashes?: Sash[];
  light_sources?: LightSource[];
  texture: Texture | null;
  materials?: Material[];
  text_style: TextStyle | null;
};

export type FurnitureGroup = {
  type: "group";
  attrs: { id: string | null; level: string | null; name: string; visible: boolean | null };
  items: Furniture[];
};

export type Furniture = Piece | FurnitureGroup;

export type Wall = {
  attrs: {
    id: string;
    level: string | null;
    x_start: number;
    y_start: number;
    x_end: number;
    y_end: number;
    height: number | null;
    height_at_end: number | null;
    thickness: number;
    arc_extent: number | null;
    pattern: string | null;
    top_color: number | null;
    left_side_color: number | null;
    right_side_color: number | null;
  };
  textures?: Texture[];
  baseboards?: Baseboard[];
};

export type Baseboard = {
  attrs: {
    /** `leftSideBaseboard` or `rightSideBaseboard` */
    role: string;
    thickness: number;
    height: number;
    color: number | null;
  };
  texture: Texture | null;
};

export type Room = {
  attrs: {
    id: string | null;
    level: string | null;
    name: string | null;
    name_angle: number | null;
    name_x_offset: number | null;
    name_y_offset: number | null;
    area_visible: boolean | null;
    area_angle: number | null;
    area_x_offset: number | null;
    area_y_offset: number | null;
    floor_visible: boolean | null;
    floor_color: number | null;
    ceiling_visible: boolean | null;
    ceiling_color: number | null;
  };
  text_styles?: TextStyle[];
  textures?: Texture[];
  points: { x: number; y: number }[];
};

export type Polyline = {
  attrs: {
    id: string | null;
    level: string | null;
    thickness: number | null;
    dash_style: string | null;
    start_arrow_style: string | null;
    end_arrow_style: string | null;
    elevation: number | null;
    color: number | null;
    closed_path: boolean | null;
  };
  points: { x: number; y: number }[];
};

export type DimensionLine = {
  attrs: {
    id: string | null;
    level: string | null;
    x_start: number;
    y_start: number;
    x_end: number;
    y_end: number;
    elevation_start: number | null;
    elevation_end: number | null;
    offset: number;
    end_mark_size: number | null;
    pitch: number | null;
    color: number | null;
    visible_in_3d: boolean | null;
  };
  text_style: TextStyle | null;
};

export type Label = {
  attrs: {
    id: string | null;
    level: string | null;
    x: number;
    y: number;
    angle: number | null;
    elevation: number | null;
    pitch: number | null;
    color: number | null;
    outline_color: number | null;
  };
  text_style: TextStyle | null;
  text: string;
};

export type Home = {
  attrs: {
    name: string | null;
    camera: string | null;
    selected_level: string | null;
    wall_height: number | null;
  };
  environment: {
    attrs: {
      ground_color: number | null;
      sky_color: number | null;
      light_color: number | null;
      walls_alpha: number | null;
      all_levels_visible: boolean | null;
    };
    textures: Texture[];
  } | null;
  compass: {
    attrs: {
      x: number;
      y: number;
      diameter: number;
      north_direction: number | null;
      visible: boolean | null;
    };
  } | null;
  cameras: Camera[];
  levels: Level[];
  furniture: Furniture[];
  walls: Wall[];
  rooms: Room[];
  polylines: Polyline[];
  dimension_lines: DimensionLine[];
  labels: Label[];
};

export type WallShape = { id: string; left: Pt[]; right: Pt[] };

/** State of the open home as sent by the backend (`HomeView` in app/src-tauri/src/state.rs). */
export type OpenedHome = {
  /** Changes when another home is opened or created */
  id: number;
  path: string | null;
  home: Home;
  wallShapes: WallShape[];
  modified: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

/** Calls `fn` for every visible piece, expanding groups. */
export function forEachPiece(items: Furniture[], fn: (p: Piece) => void): void {
  for (const item of items) {
    if (item.type === "group") {
      if (item.attrs.visible !== false) forEachPiece(item.items, fn);
    } else if (item.attrs.visible !== false) {
      fn(item);
    }
  }
}

/** CSS color from an ARGB number; RGB-only colors (alpha 0) are treated as opaque. */
export function cssColor(argb: number | null | undefined, fallback: string): string {
  if (argb === null || argb === undefined) return fallback;
  const rgb = argb & 0xffffff;
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

/** Polygon outline of a wall: left side forward, right side backward. */
export function wallPolygon(s: WallShape): Pt[] {
  return [...s.left, ...[...s.right].reverse()];
}

/** Whether an item on `itemLevel` belongs to the level `levelId` (no levels = everything). */
export function onLevel(itemLevel: string | null, levelId: string | null): boolean {
  return levelId === null || itemLevel === levelId || (itemLevel === null && levelId === null);
}
