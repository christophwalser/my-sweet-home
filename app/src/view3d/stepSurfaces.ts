// Steps of staircase models under the virtual visitor: a ray straight down through the
// loaded models finds the faces it could stand on, whatever the shape of the staircase.

import * as THREE from "three";
import type { Pt } from "../model";

const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
const normal = new THREE.Vector3();
const normalMatrix = new THREE.Matrix3();
/** Faces steeper than this (cosine of the slope) are no steps, e.g. risers or handrails */
const MIN_UP = 0.5;

/**
 * Elevations of the upward faces of `stairs` (piece objects) at the plan point `p`, highest
 * first, or null while a model is still loading.
 */
export function stepSurfaces(stairs: THREE.Object3D[], p: Pt): number[] | null {
  if (stairs.some((s) => s.children.length === 0)) return null;
  raycaster.set(new THREE.Vector3(p[0], 1e6, p[1]), down);
  const heights: number[] = [];
  for (const hit of raycaster.intersectObjects(stairs, true)) {
    if (!hit.face) continue;
    normalMatrix.getNormalMatrix(hit.object.matrixWorld);
    normal.copy(hit.face.normal).applyMatrix3(normalMatrix).normalize();
    if (normal.y >= MIN_UP) heights.push(hit.point.y);
  }
  return heights;
}
