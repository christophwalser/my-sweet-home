// Point lights for the light sources of lamps.
//
// WebGL forward rendering evaluates every light for every pixel, so only the
// lamps closest to the viewer are lit.

import * as THREE from "three";
import { forEachPiece, type Home } from "../model";
import type { LevelInfo } from "./buildScene";

/** Upper limit of point lights, to keep shaders and frame times small. */
export const MAX_LAMP_LIGHTS = 12;
/** Intensity of a light source with power 1 (candela with distances in cm). */
const LIGHT_INTENSITY = 40000;
/** Distance in cm at which a lamp's light fades out completely. */
const LIGHT_RANGE = 1200;

type LampLight = { position: THREE.Vector3; color: THREE.Color; power: number };

/** World positions and colors of all light sources of visible lamps. */
export function lampLights(
  home: Home,
  levels: Map<string | null, LevelInfo>,
  shown: Set<string | null>,
): LampLight[] {
  const result: LampLight[] = [];
  const tmp = new THREE.Object3D();
  tmp.rotation.order = "YXZ";
  forEachPiece(home.furniture, (p) => {
    const sources = p.light_sources;
    if (!sources?.length || !shown.has(p.attrs.level)) return;
    const a = p.attrs;
    const power = a.power ?? 0.5;
    if (power <= 0) return;
    const base = (levels.get(a.level) ?? levels.get(null))?.elevation ?? 0;
    // Same transform as the piece's 3D object (see createPieceObject)
    tmp.position.set(a.x, base + (a.elevation ?? 0) + a.height / 2, a.y);
    tmp.rotation.set(a.pitch ?? 0, -(a.angle ?? 0), a.roll ?? 0);
    tmp.updateMatrix();
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
      });
    }
  });
  return result;
}

/** Point lights for the lamps nearest to `viewer`, at most MAX_LAMP_LIGHTS. */
export function buildLampLights(lights: LampLight[], viewer: THREE.Vector3): THREE.Group {
  const group = new THREE.Group();
  group.name = "lamps";
  const nearest = [...lights]
    .sort((a, b) => a.position.distanceToSquared(viewer) - b.position.distanceToSquared(viewer))
    .slice(0, MAX_LAMP_LIGHTS);
  for (const l of nearest) {
    // Light source colors are dim on purpose (they tint the light), so normalize them
    const color = l.color.clone();
    const max = Math.max(color.r, color.g, color.b);
    if (max > 0) color.multiplyScalar(1 / max);
    else color.setRGB(1, 1, 1);
    const light = new THREE.PointLight(color, LIGHT_INTENSITY * l.power, LIGHT_RANGE, 2);
    light.position.copy(l.position);
    group.add(light);
  }
  return group;
}
