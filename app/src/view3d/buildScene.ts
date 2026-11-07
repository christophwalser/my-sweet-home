// Builds the static part of the 3D scene: ground, walls (with openings) and rooms.
//
// Coordinate mapping from Sweet Home 3D: plan x → 3D x, plan y → 3D z,
// elevation → 3D y. Units stay centimeters.

import * as THREE from "three";
import { Brush, Evaluator, SUBTRACTION } from "three-bvh-csg";
import { docResourceUrl } from "../api";
import {
  forEachPiece,
  type Home,
  type OpenedHome,
  type Piece,
  type Pt,
  type Texture,
} from "../model";

export type LevelInfo = { elevation: number; height: number };

/** Elevation and height of every level; `null` key = home without levels. */
export function levelInfos(home: Home): Map<string | null, LevelInfo> {
  const map = new Map<string | null, LevelInfo>();
  map.set(null, { elevation: 0, height: home.attrs.wall_height ?? 250 });
  for (const l of home.levels) {
    map.set(l.attrs.id, { elevation: l.attrs.elevation, height: l.attrs.height });
  }
  return map;
}

/** Levels shown in 3D: the selected level and all levels below it. */
export function visibleLevels(home: Home, selected: string | null): Set<string | null> {
  const set = new Set<string | null>();
  if (home.levels.length === 0) {
    set.add(null);
    return set;
  }
  const all = home.environment?.attrs.all_levels_visible === true;
  const sel = home.levels.find((l) => l.attrs.id === selected);
  const maxElevation = sel ? sel.attrs.elevation : Number.POSITIVE_INFINITY;
  for (const l of home.levels) {
    // `visible` is derived state saved by Sweet Home 3D (levels above the selected
    // one); only `viewable` is the user's choice.
    if (l.attrs.viewable === false) continue;
    if (all || l.attrs.elevation <= maxElevation) set.add(l.attrs.id);
  }
  return set;
}

export function colorOf(argb: number | null | undefined, fallback: number): THREE.Color {
  return new THREE.Color(argb === null || argb === undefined ? fallback : argb & 0xffffff);
}

const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");

/** Repeating texture sized in centimeters (one image covers width × height cm). */
export function loadTiledTexture(url: string, t: Texture, onLoad: () => void): THREE.Texture {
  const tex = textureLoader.load(url, onLoad);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const scale = t.scale ?? 1;
  tex.repeat.set(1 / (t.width * scale), 1 / (t.height * scale));
  tex.rotation = t.angle ?? 0;
  return tex;
}

// ------------------------------------------------------------------ Walls

const EDGE_LEFT = 0;
const EDGE_RIGHT = 1;
const EDGE_OTHER = 2;

/**
 * Builds a vertical prism from a plan polygon. `heightAt` returns the top
 * height for a plan point. Faces are grouped: 0 = left side, 1 = right side,
 * 2 = top, bottom and wall ends.
 */
function prismGeometry(
  poly: Pt[],
  edgeKinds: number[],
  baseY: number,
  heightAt: (p: Pt) => number,
): THREE.BufferGeometry {
  // Orient the polygon clockwise in (x, z) so that top faces point up
  let pts = poly;
  let kinds = edgeKinds;
  if (signedArea(pts) > 0) {
    pts = [...pts].reverse();
    // Edge i of the reversed polygon is edge (n-2-i) of the original
    const n = pts.length;
    kinds = pts.map((_, i) => edgeKinds[(2 * n - 2 - i) % n]);
  }
  const positions: number[] = [];
  const groups: { start: number; count: number; index: number }[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const addGroup = (index: number, startVertex: number) => {
    const count = positions.length / 3 - startVertex;
    if (count > 0) groups.push({ start: startVertex, count, index });
  };

  // Sides, sorted by material group so that groups are contiguous
  for (const group of [EDGE_LEFT, EDGE_RIGHT, EDGE_OTHER]) {
    const start = positions.length / 3;
    for (let i = 0; i < pts.length; i++) {
      if (kinds[i] !== group) continue;
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const b0 = new THREE.Vector3(p[0], baseY, p[1]);
      const b1 = new THREE.Vector3(q[0], baseY, q[1]);
      const t0 = new THREE.Vector3(p[0], baseY + heightAt(p), p[1]);
      const t1 = new THREE.Vector3(q[0], baseY + heightAt(q), q[1]);
      // Outward normal of an edge of a clockwise polygon (in x, z) is on its left
      const outward = new THREE.Vector3(-(q[1] - p[1]), 0, q[0] - p[0]);
      const n = new THREE.Vector3()
        .subVectors(b1, b0)
        .cross(new THREE.Vector3().subVectors(t1, b0));
      if (n.dot(outward) >= 0) {
        pushTri(b0, b1, t1);
        pushTri(b0, t1, t0);
      } else {
        pushTri(b0, t1, b1);
        pushTri(b0, t0, t1);
      }
    }
    if (group !== EDGE_OTHER) addGroup(group, start);
    else {
      // Top and bottom also belong to the "other" group
      const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      for (const [ia, ib, ic] of tris) {
        const [a, b, c] = [pts[ia], pts[ib], pts[ic]];
        // For an upward normal the (x, z) triangle must be clockwise
        const cw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
        const [x, y, z] = cw ? [a, b, c] : [a, c, b];
        pushTri(
          new THREE.Vector3(x[0], baseY + heightAt(x), x[1]),
          new THREE.Vector3(y[0], baseY + heightAt(y), y[1]),
          new THREE.Vector3(z[0], baseY + heightAt(z), z[1]),
        );
        pushTri(
          new THREE.Vector3(x[0], baseY, x[1]),
          new THREE.Vector3(z[0], baseY, z[1]),
          new THREE.Vector3(y[0], baseY, y[1]),
        );
      }
      addGroup(EDGE_OTHER, start);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
  );
  geom.computeVertexNormals();
  for (const g of groups) geom.addGroup(g.start, g.count, g.index);
  return geom;
}

function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Box that cuts the wall opening of a door or window. */
function openingBrush(p: Piece, baseY: number, depth: number, materials: THREE.Material[]): Brush {
  const a = p.attrs;
  const cutWidth = a.width * (a.wall_width ?? 1);
  const cutHeight = a.height * (a.wall_height ?? 1);
  const cutLeft = a.width * (a.wall_left ?? 0);
  const cutTop = a.height * (a.wall_top ?? 0);
  const geom = new THREE.BoxGeometry(cutWidth, cutHeight, depth);
  for (const g of geom.groups) g.materialIndex = EDGE_OTHER;
  const brush = new Brush(geom, materials);
  // Offset of the cut-out center relative to the piece center
  const localX = -a.width / 2 + cutLeft + cutWidth / 2;
  const localY = a.height / 2 - cutTop - cutHeight / 2;
  const angle = a.angle ?? 0;
  brush.position.set(
    a.x + localX * Math.cos(angle) * (a.model_mirrored ? -1 : 1),
    baseY + (a.elevation ?? 0) + a.height / 2 + localY,
    a.y + localX * Math.sin(angle) * (a.model_mirrored ? -1 : 1),
  );
  brush.rotation.y = -angle;
  brush.updateMatrixWorld();
  return brush;
}

/** Walls of the visible levels with door and window openings cut out. */
export function buildWalls(
  opened: OpenedHome,
  levels: Map<string | null, LevelInfo>,
  shown: Set<string | null>,
): THREE.Group {
  const { home, wallShapes } = opened;
  const group = new THREE.Group();
  group.name = "walls";
  const evaluator = new Evaluator();
  evaluator.useGroups = true;
  const defaultHeight = home.attrs.wall_height ?? 250;
  const wallsAlpha = home.environment?.attrs.walls_alpha ?? 0;

  const openings: Piece[] = [];
  forEachPiece(home.furniture, (p) => {
    if (p.kind === "DoorOrWindow") openings.push(p);
  });
  const maxThickness = Math.max(1, ...home.walls.map((w) => w.attrs.thickness));

  home.walls.forEach((wall, i) => {
    const a = wall.attrs;
    if (!shown.has(a.level)) return;
    const level = levels.get(a.level) ?? levels.get(null);
    const baseY = level?.elevation ?? 0;
    const shape = wallShapes[i];
    const poly: Pt[] = [...shape.left, ...[...shape.right].reverse()];
    const kinds: number[] = poly.map((_, j) => {
      if (j < shape.left.length - 1) return EDGE_LEFT;
      if (j >= shape.left.length && j < poly.length - 1) return EDGE_RIGHT;
      return EDGE_OTHER;
    });
    const h0 = a.height ?? defaultHeight;
    const h1 = a.height_at_end ?? h0;
    const dx = a.x_end - a.x_start;
    const dz = a.y_end - a.y_start;
    const len2 = dx * dx + dz * dz || 1;
    const heightAt = (p: Pt) => {
      const t = Math.min(
        1,
        Math.max(0, ((p[0] - a.x_start) * dx + (p[1] - a.y_start) * dz) / len2),
      );
      return h0 + (h1 - h0) * t;
    };

    // Wall textures need UVs along the wall sides; they follow with editing in P4.
    const materials = [
      wallMaterial(a.left_side_color, wallsAlpha),
      wallMaterial(a.right_side_color, wallsAlpha),
      wallMaterial(a.top_color, wallsAlpha),
    ];
    const geom = prismGeometry(poly, kinds, baseY, heightAt);
    let brush = new Brush(geom, materials);
    brush.updateMatrixWorld();

    const wallBox = new THREE.Box3().setFromBufferAttribute(
      geom.getAttribute("position") as THREE.BufferAttribute,
    );
    for (const p of openings) {
      if (p.attrs.level !== a.level) continue;
      const cut = openingBrush(p, baseY, p.attrs.depth + 2 * maxThickness, materials);
      const cutBox = new THREE.Box3().setFromObject(cut);
      if (!cutBox.intersectsBox(wallBox)) continue;
      brush = evaluator.evaluate(brush, cut, SUBTRACTION) as Brush;
      brush.updateMatrixWorld();
    }
    const mesh = new THREE.Mesh(brush.geometry, materials);
    mesh.name = `wall:${a.id}`;
    group.add(mesh);
  });
  return group;
}

function wallMaterial(color: number | null, wallsAlpha: number): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: colorOf(color, 0xffffff) });
  if (wallsAlpha > 0) {
    m.transparent = true;
    m.opacity = 1 - wallsAlpha;
  }
  return m;
}

// ------------------------------------------------------------------ Rooms

export function buildRooms(
  opened: OpenedHome,
  levels: Map<string | null, LevelInfo>,
  shown: Set<string | null>,
  requestRender: () => void,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "rooms";
  for (const room of opened.home.rooms) {
    const a = room.attrs;
    if (!shown.has(a.level) || room.points.length < 3) continue;
    const level = levels.get(a.level) ?? levels.get(null);
    const shape = new THREE.Shape(room.points.map((p) => new THREE.Vector2(p.x, p.y)));
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(Math.PI / 2); // (x, y, 0) → (x, 0, y)

    if (a.floor_visible !== false) {
      const floorTexture = room.textures?.find((t) => t.role === "floorTexture");
      const mat = new THREE.MeshLambertMaterial({
        color: floorTexture ? 0xffffff : colorOf(a.floor_color, 0xd8d2c4),
        side: THREE.DoubleSide,
      });
      if (floorTexture) {
        mat.map = loadTiledTexture(
          docResourceUrl(opened.id, floorTexture.image),
          floorTexture,
          requestRender,
        );
      }
      const floor = new THREE.Mesh(geom, mat);
      floor.position.y = (level?.elevation ?? 0) + 0.2;
      floor.name = `floor:${a.id ?? ""}`;
      group.add(floor);
    }
    if (a.ceiling_visible !== false) {
      const ceilingTexture = room.textures?.find((t) => t.role === "ceilingTexture");
      const mat = new THREE.MeshLambertMaterial({
        color: ceilingTexture ? 0xffffff : colorOf(a.ceiling_color, 0xf4f4f4),
        // The rotated shape faces down: visible from below, hidden in the aerial view
        side: THREE.FrontSide,
      });
      if (ceilingTexture) {
        mat.map = loadTiledTexture(
          docResourceUrl(opened.id, ceilingTexture.image),
          ceilingTexture,
          requestRender,
        );
      }
      const ceiling = new THREE.Mesh(geom, mat);
      ceiling.position.y = (level?.elevation ?? 0) + (level?.height ?? 250) - 0.2;
      ceiling.name = `ceiling:${a.id ?? ""}`;
      group.add(ceiling);
    }
  }
  return group;
}

// ------------------------------------------------------------------ Ground and environment

export function buildGround(opened: OpenedHome, requestRender: () => void): THREE.Mesh {
  const env = opened.home.environment;
  const groundTexture = env?.textures.find((t) => t.role === "groundTexture");
  const mat = new THREE.MeshLambertMaterial({
    color: groundTexture ? 0xffffff : colorOf(env?.attrs.ground_color, 0xa8a8a8),
  });
  if (groundTexture) {
    mat.map = loadTiledTexture(
      docResourceUrl(opened.id, groundTexture.image),
      groundTexture,
      requestRender,
    );
  }
  const size = 200000;
  const geom = new THREE.PlaneGeometry(size, size);
  geom.rotateX(-Math.PI / 2);
  // UVs in centimeters so that tiled textures have the right size
  const uv = geom.getAttribute("uv") as THREE.BufferAttribute;
  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.y = -0.5;
  mesh.name = "ground";
  return mesh;
}

export function skyColor(home: Home): THREE.Color {
  return colorOf(home.environment?.attrs.sky_color, 0xcce4fc);
}

export function lightColor(home: Home): THREE.Color {
  return colorOf(home.environment?.attrs.light_color, 0xd0d0d0);
}
