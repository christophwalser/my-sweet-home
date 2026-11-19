// Cut through the model of a reference object (a scanned house, a neighbor house, terrain) for
// the plan: where a horizontal plane meets the triangles of the model. The view from above of a
// scanned house shows its roof; the cut at 1 m above the floor shows its walls, which can be
// traced. Cuts are computed one after another, like the views from above, and cached.

import type * as THREE from "three";
import {
  forEachPiece,
  type Home,
  hiddenInPlan,
  isReference,
  type Piece,
  type Pt,
  pieceAtLevel,
  sectionHeightIn,
  sectionSnaps,
} from "../model";
import { loadPiece, pieceKey, schedule } from "./topView";

export type SectionCut = {
  /** x1, y1, x2, y2 of each line in cm from the center of the piece, before its angle */
  segments: Float32Array;
  /** The same lines, ready to be drawn */
  path: Path2D | null;
};

type Entry = SectionCut | "pending" | "failed";

const cache = new Map<string, Entry>();
let cacheDoc: number | null = null;

/** Most lines offered to the magnetism at once (those nearest to the pointer). */
const MAX_SNAP_LINES = 200;

/**
 * Adds the lines in which the plane y = `height` cuts the triangles to `out` (x1, z1, x2, z2).
 * `position` holds x, y, z of the vertices, `index` three vertices per triangle (null: the
 * vertices in their order), `m` the matrix (column major) that puts them into the piece.
 */
export function cutTriangles(
  position: ArrayLike<number>,
  index: ArrayLike<number> | null,
  m: ArrayLike<number>,
  height: number,
  out: number[],
): void {
  const count = index ? index.length : position.length / 3;
  const x = [0, 0, 0];
  const y = [0, 0, 0];
  const z = [0, 0, 0];
  for (let t = 0; t + 2 < count; t += 3) {
    let above = 0;
    for (let k = 0; k < 3; k++) {
      const i = (index ? index[t + k] : t + k) * 3;
      const px = position[i];
      const py = position[i + 1];
      const pz = position[i + 2];
      y[k] = m[1] * px + m[5] * py + m[9] * pz + m[13];
      if (y[k] >= height) above++;
      x[k] = m[0] * px + m[4] * py + m[8] * pz + m[12];
      z[k] = m[2] * px + m[6] * py + m[10] * pz + m[14];
    }
    if (above === 0 || above === 3) continue;
    // Two of the three edges cross the plane
    let n = 0;
    let ax = 0;
    let az = 0;
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      if (y[k] >= height === y[j] >= height) continue;
      const f = (height - y[k]) / (y[j] - y[k]);
      const cx = x[k] + (x[j] - x[k]) * f;
      const cz = z[k] + (z[j] - z[k]) * f;
      if (n === 0) {
        ax = cx;
        az = cz;
      } else if (Math.abs(cx - ax) + Math.abs(cz - az) > 1e-6) {
        out.push(ax, az, cx, cz);
      }
      n++;
    }
  }
}

/** The lines in which the plane y = `height` cuts all meshes of an object. */
export function sectionOfObject(obj: THREE.Object3D, height: number): Float32Array {
  const out: number[] = [];
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (position?.itemSize !== 3) return;
    let array: ArrayLike<number> = position.array;
    if (
      (position as unknown as { isInterleavedBufferAttribute?: boolean })
        .isInterleavedBufferAttribute
    ) {
      const copy = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        copy[i * 3] = position.getX(i);
        copy[i * 3 + 1] = position.getY(i);
        copy[i * 3 + 2] = position.getZ(i);
      }
      array = copy;
    }
    cutTriangles(array, mesh.geometry.index?.array ?? null, mesh.matrixWorld.elements, height, out);
  });
  return Float32Array.from(out);
}

function key(p: Piece, docId: number, height: number): string {
  return `${pieceKey(p, docId)}|${Math.round(height)}`;
}

/**
 * The cut through a piece at `height` cm above its bottom, or null while it is computed (or if
 * the piece has no model). `onReady` is called when a requested cut becomes available.
 */
export function sectionCut(
  p: Piece,
  docId: number,
  height: number,
  onReady: () => void,
): SectionCut | null {
  if (!p.attrs.model) return null;
  if (cacheDoc !== docId) {
    cache.clear();
    cacheDoc = docId;
  }
  const k = key(p, docId, height);
  const entry = cache.get(k);
  if (entry && typeof entry === "object") return entry;
  if (entry) return null;
  cache.set(k, "pending");
  const piece: Piece = JSON.parse(JSON.stringify(p));
  const at = Math.round(height);
  schedule(async () => {
    try {
      const a = piece.attrs;
      const centered: Piece = { ...piece, attrs: { ...a, x: 0, y: 0, angle: 0, elevation: 0 } };
      const obj = await loadPiece(centered, docId);
      const segments = sectionOfObject(obj, at);
      const path = typeof Path2D === "undefined" ? null : new Path2D();
      for (let i = 0; path && i + 3 < segments.length; i += 4) {
        path.moveTo(segments[i], segments[i + 1]);
        path.lineTo(segments[i + 2], segments[i + 3]);
      }
      if (cacheDoc === docId) cache.set(k, { segments, path });
    } catch (e) {
      console.warn(`section of ${piece.attrs.name}: ${String(e)}`);
      if (cacheDoc === docId) cache.set(k, "failed");
    }
    onReady();
  });
  return null;
}

/** The cut of a piece if it is already computed (it is not started here). */
function readyCut(p: Piece, height: number): SectionCut | null {
  if (cacheDoc === null) return null;
  const entry = cache.get(key(p, cacheDoc, height));
  return entry && typeof entry === "object" ? entry : null;
}

/**
 * Lines of `segments` (in the frame of a piece at `center` turned by `angle`) that lie within
 * `reach` of `near`, in plan coordinates, nearest first.
 */
export function linesNear(
  segments: ArrayLike<number>,
  center: Pt,
  angle: number,
  near: Pt,
  reach: number,
  limit = MAX_SNAP_LINES,
): [Pt, Pt][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // The pointer in the frame of the piece
  const dx = near[0] - center[0];
  const dy = near[1] - center[1];
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const found: { d: number; i: number }[] = [];
  for (let i = 0; i + 3 < segments.length; i += 4) {
    const x1 = segments[i];
    const y1 = segments[i + 1];
    const x2 = segments[i + 2];
    const y2 = segments[i + 3];
    if (
      Math.min(x1, x2) > lx + reach ||
      Math.max(x1, x2) < lx - reach ||
      Math.min(y1, y2) > ly + reach ||
      Math.max(y1, y2) < ly - reach
    ) {
      continue;
    }
    // Distance of the pointer from the line
    const ex = x2 - x1;
    const ey = y2 - y1;
    const len2 = ex * ex + ey * ey;
    const f = len2 > 0 ? Math.max(0, Math.min(1, ((lx - x1) * ex + (ly - y1) * ey) / len2)) : 0;
    const d = Math.hypot(lx - (x1 + ex * f), ly - (y1 + ey * f));
    if (d <= reach) found.push({ d, i });
  }
  found.sort((a, b) => a.d - b.d);
  const world = (x: number, y: number): Pt => [
    center[0] + x * c - y * s,
    center[1] + x * s + y * c,
  ];
  return found
    .slice(0, limit)
    .map(({ i }) => [world(segments[i], segments[i + 1]), world(segments[i + 2], segments[i + 3])]);
}

/**
 * Lines of the cuts through reference objects near the pointer that attract it: of the objects
 * shown in the plan of the level whose cut is switched on together with "attracts the pointer".
 */
export function sectionSnapLines(
  home: Home,
  levelId: string | null,
  near: Pt,
  reach: number,
): [Pt, Pt][] {
  const lines: [Pt, Pt][] = [];
  forEachPiece(home.furniture, (p) => {
    if (!isReference(p) || !sectionSnaps(p) || hiddenInPlan(p)) return;
    if (!pieceAtLevel(home, p, levelId)) return;
    const height = sectionHeightIn(home, p, levelId);
    const cut = height === null ? null : readyCut(p, height);
    if (!cut) return;
    lines.push(...linesNear(cut.segments, [p.attrs.x, p.attrs.y], p.attrs.angle ?? 0, near, reach));
  });
  return lines;
}
