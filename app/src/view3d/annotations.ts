// Plan annotations shown in 3D: labels with a pitch, dimension lines marked
// "visible in 3D" and polylines with an elevation (Sweet Home 3D 6.0+ / 7.2+).

import * as THREE from "three";
import type { DimensionLine, Home, Label, Polyline, TextStyle } from "../model";
import { polylinePath } from "../plan2d/curve";
import { type DimensionStyle, dimensionStyle, formatDimension } from "../plan2d/dimensionStyle";
import { colorOf, type LevelInfo } from "./buildScene";

const DEFAULT_LABEL_FONT = 18;
const DEFAULT_DIMENSION_FONT = 18;
/** Canvas pixels per centimeter of text textures. */
const TEXT_RESOLUTION = 4;

export function buildAnnotations(
  home: Home,
  levels: Map<string | null, LevelInfo>,
  shown: Set<string | null>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "annotations";
  const baseOf = (level: string | null) => (levels.get(level) ?? levels.get(null))?.elevation ?? 0;
  for (const l of home.labels) {
    if (shown.has(l.attrs.level) && l.attrs.pitch !== null && l.text.trim()) {
      group.add(labelObject(l, baseOf(l.attrs.level)));
    }
  }
  const style = dimensionStyle(home);
  for (const d of home.dimension_lines) {
    if (shown.has(d.attrs.level) && d.attrs.visible_in_3d === true) {
      const obj = dimensionObject(d, baseOf(d.attrs.level), style);
      if (obj) group.add(obj);
    }
  }
  for (const p of home.polylines) {
    if (shown.has(p.attrs.level) && p.attrs.elevation !== null && p.points.length >= 2) {
      group.add(polylineObject(p, baseOf(p.attrs.level)));
    }
  }
  return group;
}

/**
 * Flat mesh showing `lines` of text. The mesh lies in its local XY plane, the
 * text baseline of the last line runs along the x axis and is anchored at the
 * origin according to the style's alignment. The text is readable from both
 * sides: the back face is a second plane with the image turned around.
 */
function textMesh(
  lines: string[],
  style: TextStyle | null,
  defaultSize: number,
  color: number,
  outline: number | null,
): THREE.Object3D {
  const size = style?.font_size ?? defaultSize;
  const family = style?.font_name ? `"${style.font_name}", sans-serif` : "sans-serif";
  const font = `${style?.italic ? "italic " : ""}${style?.bold ? "bold " : ""}${size * TEXT_RESOLUTION}px ${family}`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.font = font;
  const lineHeight = size * 1.2 * TEXT_RESOLUTION;
  const pad = Math.ceil(size * 0.1 * TEXT_RESOLUTION) + (outline !== null ? 4 : 0);
  const width = Math.ceil(Math.max(1, ...lines.map((t) => ctx.measureText(t).width))) + 2 * pad;
  const descent = size * 0.25 * TEXT_RESOLUTION;
  const height =
    Math.ceil(lineHeight * (lines.length - 1) + size * TEXT_RESOLUTION + descent) + 2 * pad;
  canvas.width = width;
  canvas.height = height;
  ctx.font = font;
  const align =
    style?.alignment === "LEFT" ? "left" : style?.alignment === "RIGHT" ? "right" : "center";
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  const x = align === "left" ? pad : align === "right" ? width - pad : width / 2;
  const baseline = height - pad - descent;
  lines.forEach((line, i) => {
    const y = baseline - (lines.length - 1 - i) * lineHeight;
    if (outline !== null) {
      ctx.lineWidth = TEXT_RESOLUTION * 1.5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = `#${(outline & 0xffffff).toString(16).padStart(6, "0")}`;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = `#${(color & 0xffffff).toString(16).padStart(6, "0")}`;
    ctx.fillText(line, x, y);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const w = width / TEXT_RESOLUTION;
  const h = height / TEXT_RESOLUTION;
  const geom = new THREE.PlaneGeometry(w, h);
  // Move the anchor (alignment point on the last baseline) to the origin
  geom.translate(w / 2 - x / TEXT_RESOLUTION, h / 2 - (height - baseline) / TEXT_RESOLUTION, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  // Same footprint, facing the other way: turn around the y axis, then shift back
  const back = geom.clone().rotateY(Math.PI);
  back.computeBoundingBox();
  geom.computeBoundingBox();
  const x0 = geom.boundingBox?.min.x ?? 0;
  const bx0 = back.boundingBox?.min.x ?? 0;
  back.translate(x0 - bx0, 0, 0);
  const group = new THREE.Group();
  for (const g of [geom, back]) {
    const mesh = new THREE.Mesh(g, mat);
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  return group;
}

/** Label at its elevation; pitch 0 stands upright, π/2 lies flat like in the plan. */
function labelObject(l: Label, baseY: number): THREE.Object3D {
  const a = l.attrs;
  const mesh = textMesh(
    l.text.split("\n"),
    l.text_style,
    DEFAULT_LABEL_FONT,
    a.color ?? 0,
    a.outline_color,
  );
  mesh.position.set(a.x, baseY + (a.elevation ?? 0), a.y);
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = -(a.angle ?? 0);
  mesh.rotation.x = -(a.pitch ?? 0);
  mesh.name = "label";
  return mesh;
}

/**
 * Dimension line drawn like in the plan inside a plane that contains the
 * measured segment; the pitch rotates that plane around the segment.
 */
function dimensionObject(
  d: DimensionLine,
  baseY: number,
  style: DimensionStyle,
): THREE.Object3D | null {
  const a = d.attrs;
  const start = new THREE.Vector3(a.x_start, baseY + (a.elevation_start ?? 0), a.y_start);
  const end = new THREE.Vector3(
    a.x_end,
    baseY + (a.elevation_end ?? a.elevation_start ?? 0),
    a.y_end,
  );
  const length = start.distanceTo(end);
  if (length < 1e-3) return null;
  const e1 = new THREE.Vector3().subVectors(end, start).normalize();
  const pitch = a.pitch ?? 0;
  let e2: THREE.Vector3;
  const planLength = Math.hypot(a.x_end - a.x_start, a.y_end - a.y_start);
  if (planLength < 1e-3) {
    // Elevation dimension line: the pitch is the direction of the offset in the plan
    e2 = new THREE.Vector3(Math.cos(pitch), 0, Math.sin(pitch));
  } else {
    // Same offset side as in the plan, rotated upward around the segment by the pitch
    e2 = new THREE.Vector3(-(a.y_end - a.y_start), 0, a.x_end - a.x_start)
      .normalize()
      .applyAxisAngle(e1, -pitch);
  }
  const e3 = new THREE.Vector3().crossVectors(e1, e2).normalize();
  e2.crossVectors(e3, e1).normalize();

  const group = new THREE.Group();
  group.name = "dimension";
  group.matrixAutoUpdate = false;
  group.matrix.makeBasis(e1, e2, e3).setPosition(start);

  const color = a.color ?? 0;
  const offset = a.offset;
  const mark = (a.end_mark_size ?? 10) / 2;
  const sign = Math.sign(offset || 1);
  const v: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number) => v.push(x0, y0, 0, x1, y1, 0);
  seg(0, 0, 0, offset + sign * mark);
  seg(length, 0, length, offset + sign * mark);
  seg(0, offset, length, offset);
  for (const [x, inward] of [
    [0, 1],
    [length, -1],
  ]) {
    if (style.mark === "slash") seg(x - mark, offset + mark, x + mark, offset - mark);
    else if (style.mark === "arrow") {
      seg(x, offset, x + inward * 2 * mark, offset - mark / 2);
      seg(x, offset, x + inward * 2 * mark, offset + mark / 2);
    } else if (style.mark === "dot") {
      // A small square around the end
      const r = mark / 2;
      seg(x - r, offset - r, x + r, offset - r);
      seg(x + r, offset - r, x + r, offset + r);
      seg(x + r, offset + r, x - r, offset + r);
      seg(x - r, offset + r, x - r, offset - r);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  group.add(new THREE.LineSegments(geom, new THREE.LineBasicMaterial({ color: color & 0xffffff })));

  // Text above the dimension line; in plan coordinates "above" is −y, so turn
  // the text mesh (whose up is +y) half a turn around the x axis
  const font = style.fontSize ?? DEFAULT_DIMENSION_FONT;
  const size = d.text_style?.font_size ?? font;
  const text = textMesh([formatDimension(length, style)], d.text_style, font, color, null);
  // Like Sweet Home 3D, the text sits on the outer side of the dimension line
  const baseline = offset > 0 ? offset + size * 0.95 : offset - size * 0.15;
  text.position.set(length / 2, baseline, 0);
  text.rotation.x = Math.PI;
  group.add(text);
  group.updateMatrixWorld(true);
  return group;
}

/** Polyline lying flat at its elevation, as wide as its thickness. */
function polylineObject(p: Polyline, baseY: number): THREE.Object3D {
  const a = p.attrs;
  const y = baseY + (a.elevation ?? 0);
  const half = Math.max(a.thickness ?? 1, 0.5) / 2;
  const pts = polylinePath(p.points, a.join_style, !!a.closed_path).map(
    (q) => new THREE.Vector2(q[0], q[1]),
  );
  if (a.closed_path && a.join_style !== "CURVED") pts.push(pts[0].clone());
  const positions: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i];
    const e = pts[i + 1];
    const dir = new THREE.Vector2().subVectors(e, s);
    const len = dir.length();
    if (len < 1e-6) continue;
    dir.divideScalar(len);
    // Square caps fill the joints between segments
    const s2 = s.clone().addScaledVector(dir, -half);
    const e2 = e.clone().addScaledVector(dir, half);
    const n = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(half);
    const c = [
      [s2.x + n.x, s2.y + n.y],
      [e2.x + n.x, e2.y + n.y],
      [e2.x - n.x, e2.y - n.y],
      [s2.x - n.x, s2.y - n.y],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) positions.push(c[k][0], y, c[k][1]);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: colorOf(a.color, 0x000000),
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = "polyline";
  return mesh;
}
