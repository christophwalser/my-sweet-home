// Builders of small homes for the unit tests (`*.test.ts`). Every field the model declares
// gets a neutral default, so a test only states what matters to it.

import type {
  DimensionLine,
  Home,
  Level,
  Piece,
  Polyline,
  Pt,
  Room,
  Wall,
  WallShape,
} from "./model";

export function makeHome(parts: Partial<Home> = {}): Home {
  return {
    attrs: {
      name: null,
      camera: null,
      selected_level: null,
      wall_height: 250,
      base_plan_locked: null,
    },
    environment: null,
    compass: null,
    background_image: null,
    cameras: [],
    levels: [],
    furniture: [],
    walls: [],
    rooms: [],
    polylines: [],
    dimension_lines: [],
    labels: [],
    ...parts,
  };
}

export function makeWall(id: string, start: Pt, end: Pt, attrs: Partial<Wall["attrs"]> = {}): Wall {
  return {
    attrs: {
      id,
      level: null,
      wall_at_start: null,
      wall_at_end: null,
      x_start: start[0],
      y_start: start[1],
      x_end: end[0],
      y_end: end[1],
      height: null,
      height_at_end: null,
      thickness: 10,
      arc_extent: null,
      pattern: null,
      top_color: null,
      left_side_color: null,
      right_side_color: null,
      ...attrs,
    },
  };
}

/** Shape of a straight, unjoined wall: both sides offset by half the thickness. */
export function straightShape(wall: Wall): WallShape {
  const a = wall.attrs;
  const len = Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start) || 1;
  // Left normal (y down): (dy, -dx)
  const lx = ((a.y_end - a.y_start) / len) * (a.thickness / 2);
  const ly = (-(a.x_end - a.x_start) / len) * (a.thickness / 2);
  return {
    id: a.id,
    left: [
      [a.x_start + lx, a.y_start + ly],
      [a.x_end + lx, a.y_end + ly],
    ],
    right: [
      [a.x_start - lx, a.y_start - ly],
      [a.x_end - lx, a.y_end - ly],
    ],
  };
}

export function makePiece(
  attrs: Partial<Piece["attrs"]> = {},
  extra: Partial<Omit<Piece, "attrs">> = {},
): Piece {
  return {
    type: "piece",
    kind: "Piece",
    attrs: {
      id: "piece",
      level: null,
      catalog_id: null,
      name: "Box",
      model: null,
      icon: null,
      plan_icon: null,
      x: 0,
      y: 0,
      elevation: null,
      angle: null,
      pitch: null,
      roll: null,
      width_in_plan: null,
      depth_in_plan: null,
      height_in_plan: null,
      width: 100,
      depth: 50,
      resizable: null,
      price: null,
      deformable: null,
      height: 80,
      visible: null,
      model_mirrored: null,
      model_rotation: null,
      name_visible: null,
      name_angle: null,
      name_x_offset: null,
      name_y_offset: null,
      color: null,
      shininess: null,
      back_face_shown: null,
      wall_thickness: null,
      wall_distance: null,
      wall_width: null,
      wall_left: null,
      wall_height: null,
      wall_top: null,
      cut_out_shape: null,
      width_depth_deformable: null,
      power: null,
      movable: null,
      ...attrs,
    },
    texture: null,
    text_style: null,
    ...extra,
  };
}

export function makeRoom(points: Pt[], attrs: Partial<Room["attrs"]> = {}): Room {
  return {
    attrs: {
      id: "room",
      level: null,
      name: null,
      name_angle: null,
      name_x_offset: null,
      name_y_offset: null,
      area_visible: null,
      area_angle: null,
      area_x_offset: null,
      area_y_offset: null,
      floor_visible: null,
      floor_color: null,
      ceiling_visible: null,
      ceiling_color: null,
      ...attrs,
    },
    points: points.map(([x, y]) => ({ x, y })),
  };
}

export function makePolyline(points: Pt[], attrs: Partial<Polyline["attrs"]> = {}): Polyline {
  return {
    attrs: {
      id: "polyline",
      level: null,
      thickness: null,
      dash_style: null,
      start_arrow_style: null,
      end_arrow_style: null,
      elevation: null,
      color: null,
      closed_path: null,
      join_style: null,
      ...attrs,
    },
    points: points.map(([x, y]) => ({ x, y })),
  };
}

export function makeDimension(
  start: Pt,
  end: Pt,
  attrs: Partial<DimensionLine["attrs"]> = {},
): DimensionLine {
  return {
    attrs: {
      id: "dimension",
      level: null,
      x_start: start[0],
      y_start: start[1],
      x_end: end[0],
      y_end: end[1],
      elevation_start: null,
      elevation_end: null,
      offset: 0,
      end_mark_size: null,
      pitch: null,
      color: null,
      visible_in_3d: null,
      ...attrs,
    },
    text_style: null,
  };
}

export function makeLevel(
  id: string,
  elevation: number,
  attrs: Partial<Level["attrs"]> = {},
): Level {
  return {
    attrs: {
      id,
      name: id,
      elevation,
      floor_thickness: 12,
      height: 250,
      elevation_index: null,
      visible: null,
      viewable: null,
      ...attrs,
    },
    background_image: null,
  };
}

/** A point rounded to `digits` decimals (−0 becomes 0), for exact comparisons. */
export function roundPt(p: Pt, digits = 6): Pt {
  const f = 10 ** digits;
  return [Math.round(p[0] * f) / f + 0, Math.round(p[1] * f) / f + 0];
}
