// Lights of lamps (point lights, or spot lights with a cone) and the ceiling lights of
// photos.
//
// WebGL forward rendering evaluates every light for every pixel, so the 3D view lights
// only the lamps closest to the viewer; photos use all of them.

import * as THREE from "three";
import { forEachPiece, type Home, type Piece } from "../model";
import type { LevelInfo } from "./buildScene";
import { heightInPlan } from "./models";

/** Upper limit of lamp lights in the 3D view, to keep shaders and frame times small. */
export const MAX_LAMP_LIGHTS = 16;
/** Upper limit of lights in a rasterized (draft) photo. */
export const MAX_PHOTO_LIGHTS = 48;
/** Intensity of a light source with power 1 (candela with distances in cm). */
const LIGHT_INTENSITY = 40000;
/** Distance in cm at which a lamp's light fades out completely. */
const LIGHT_RANGE = 1200;
/** Piece property with the opening angle of a lamp's light cone in degrees. */
export const SPOT_ANGLE_PROPERTY = "mySweetHome.spotAngle";

export type LampLight = {
  position: THREE.Vector3;
  color: THREE.Color;
  power: number;
  /** Full opening angle of the cone in radians, or null for a point light */
  spot: number | null;
  /** Direction of the cone: down through the bottom of the (tilted) piece */
  direction: THREE.Vector3;
};

/** Opening angle of a lamp's light cone in degrees, or null for a point light. */
export function spotAngle(p: Piece): number | null {
  const v = Number(p.properties?.find((pr) => pr.name === SPOT_ANGLE_PROPERTY)?.value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Same transform as the piece's 3D object (see createPieceObject). */
function pieceTransform(p: Piece, base: number): THREE.Object3D {
  const a = p.attrs;
  const pitch = a.pitch ?? 0;
  const roll = a.roll ?? 0;
  const tmp = new THREE.Object3D();
  tmp.position.set(a.x, base + (a.elevation ?? 0) + heightInPlan(a, pitch, roll) / 2, a.y);
  tmp.rotation.order = "YZX";
  tmp.rotation.set(-pitch, -(a.angle ?? 0), -roll);
  tmp.updateMatrix();
  return tmp;
}

/** World positions and colors of all light sources of visible lamps. */
export function lampLights(
  home: Home,
  levels: Map<string | null, LevelInfo>,
  shown: Set<string | null>,
): LampLight[] {
  const result: LampLight[] = [];
  forEachPiece(home.furniture, (p) => {
    const sources = p.light_sources;
    if (!sources?.length || !shown.has(p.attrs.level)) return;
    const a = p.attrs;
    const power = a.power ?? 0.5;
    if (power <= 0) return;
    const base = (levels.get(a.level) ?? levels.get(null))?.elevation ?? 0;
    const tmp = pieceTransform(p, base);
    const spot = spotAngle(p);
    const direction = new THREE.Vector3(0, -1, 0).applyQuaternion(tmp.quaternion);
    for (const s of sources) {
      // x, y, z are relative to width, depth and height, measured from the
      // left, back and bottom of the piece
      const lx = (s.x - 0.5) * a.width * (a.model_mirrored ? -1 : 1);
      const ly = (s.z - 0.5) * a.height;
      const lz = (s.y - 0.5) * a.depth;
      result.push({
        position: new THREE.Vector3(lx, ly, lz).applyMatrix4(tmp.matrix),
        color: new THREE.Color(s.color & 0xffffff),
        power,
        spot: spot === null ? null : THREE.MathUtils.degToRad(spot),
        direction,
      });
    }
  });
  return result;
}

/** Light color of a source: they are dim on purpose (they tint the light), so normalize. */
export function normalizedColor(c: THREE.Color): THREE.Color {
  const color = c.clone();
  const max = Math.max(color.r, color.g, color.b);
  if (max > 0) color.multiplyScalar(1 / max);
  else color.setRGB(1, 1, 1);
  return color;
}

/** Lights for the lamps nearest to `viewer`, at most `max`. */
export function buildLampLights(
  lights: LampLight[],
  viewer: THREE.Vector3,
  max = MAX_LAMP_LIGHTS,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "lamps";
  const nearest = [...lights]
    .sort((a, b) => a.position.distanceToSquared(viewer) - b.position.distanceToSquared(viewer))
    .slice(0, max);
  for (const l of nearest) {
    const color = normalizedColor(l.color);
    if (l.spot === null) {
      const light = new THREE.PointLight(color, LIGHT_INTENSITY * l.power, LIGHT_RANGE, 2);
      light.position.copy(l.position);
      group.add(light);
    } else {
      // A cone concentrates the light of the lamp: narrow cones are brighter
      const half = Math.min(Math.PI / 2 - 0.01, l.spot / 2);
      const focus = THREE.MathUtils.clamp(0.25 / (1 - Math.cos(half)), 1, 4);
      const light = new THREE.SpotLight(
        color,
        LIGHT_INTENSITY * l.power * focus,
        LIGHT_RANGE * 1.5,
        half,
        0.35,
        2,
      );
      light.position.copy(l.position);
      light.target.position.copy(l.position).addScaledVector(l.direction, 100);
      group.add(light, light.target);
    }
  }
  return group;
}

/** Point in the middle of a polygon (area centroid, the average for degenerate ones). */
function centroid(points: { x: number; y: number }[]): [number, number] {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const { x: x0, y: y0 } = points[i];
    const { x: x1, y: y1 } = points[(i + 1) % points.length];
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const n = Math.max(1, points.length);
    return [points.reduce((s, p) => s + p.x, 0) / n, points.reduce((s, p) => s + p.y, 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Lights under the ceilings of the rooms of the shown levels, like Sweet Home 3D's
 * "ceiling lights" of photos: brighter for larger rooms.
 */
export function buildCeilingLights(
  home: Home,
  levels: Map<string | null, LevelInfo>,
  shown: Set<string | null>,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "ceiling-lights";
  const c = home.environment?.attrs.ceiling_light_color;
  if (c == null || (c & 0xffffff) === 0) return group;
  const color = normalizedColor(new THREE.Color(c & 0xffffff));
  const strength = Math.max((c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff) / 0xd0;
  for (const room of home.rooms) {
    if (!shown.has(room.attrs.level) || room.attrs.ceiling_visible === false) continue;
    if (room.points.length < 3) continue;
    const info = levels.get(room.attrs.level) ?? levels.get(null);
    const height = info?.height ?? home.attrs.wall_height ?? 250;
    const [x, y] = centroid(room.points);
    let area = 0;
    room.points.forEach(({ x: x0, y: y0 }, i) => {
      const { x: x1, y: y1 } = room.points[(i + 1) % room.points.length];
      area += x0 * y1 - x1 * y0;
    });
    const squareMeters = Math.abs(area) / 2 / 10000;
    const light = new THREE.PointLight(
      color,
      LIGHT_INTENSITY * 0.5 * strength * Math.sqrt(Math.max(1, squareMeters) / 10),
      LIGHT_RANGE * 1.5,
      2,
    );
    light.position.set(x, (info?.elevation ?? 0) + height - 25, y);
    group.add(light);
  }
  return group;
}
