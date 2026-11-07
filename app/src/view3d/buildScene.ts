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
import { baseboardOf, baseboardPolygon } from "./wallSides";

export type LevelInfo = { elevation: number; height: number; floorThickness: number };

/** Floor thickness of homes without levels (Sweet Home 3D's default preference). */
const DEFAULT_FLOOR_THICKNESS = 12;

/** Elevation, height and floor thickness of every level; `null` key = home without levels. */
export function levelInfos(home: Home): Map<string | null, LevelInfo> {
  const map = new Map<string | null, LevelInfo>();
  map.set(null, {
    elevation: 0,
    height: home.attrs.wall_height ?? 250,
    floorThickness: DEFAULT_FLOOR_THICKNESS,
  });
  for (const l of home.levels) {
    map.set(l.attrs.id, {
      elevation: l.attrs.elevation,
      height: l.attrs.height,
      floorThickness: l.attrs.floor_thickness,
    });
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

/** Axis along which side textures run: u = distance along `dir` from `origin`. */
type SideAxis = { origin: Pt; dir: Pt };

/**
 * Builds a vertical prism from a plan polygon. `heightAt` returns the top
 * height for a plan point. Faces are grouped: 0 = left side, 1 = right side,
 * 2 = top, bottom and wall ends.
 *
 * UVs are in centimeters: on the sides u runs along `axis` (oriented so that
 * textures are not mirrored when looking at the face) and v is the height above
 * `baseY`; top and bottom faces use the plan coordinates.
 */
function prismGeometry(
  poly: Pt[],
  edgeKinds: number[],
  baseY: number,
  heightAt: (p: Pt) => number,
  axis: SideAxis,
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
  const uvs: number[] = [];
  const groups: { start: number; count: number; index: number }[] = [];
  type V = [THREE.Vector3, number, number];
  const pushTri = (a: V, b: V, c: V) => {
    for (const [p, u, v] of [a, b, c]) {
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  };
  const flat = (p: THREE.Vector3): V => [p, p.x, p.z];
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
      // u must grow to the right of a viewer facing the side: right = (nz, -nx)
      const sign = outward.z * axis.dir[0] - outward.x * axis.dir[1] >= 0 ? 1 : -1;
      const u = (r: Pt) =>
        sign * ((r[0] - axis.origin[0]) * axis.dir[0] + (r[1] - axis.origin[1]) * axis.dir[1]);
      const vb0: V = [b0, u(p), 0];
      const vb1: V = [b1, u(q), 0];
      const vt0: V = [t0, u(p), t0.y - baseY];
      const vt1: V = [t1, u(q), t1.y - baseY];
      const n = new THREE.Vector3()
        .subVectors(b1, b0)
        .cross(new THREE.Vector3().subVectors(t1, b0));
      if (n.dot(outward) >= 0) {
        pushTri(vb0, vb1, vt1);
        pushTri(vb0, vt1, vt0);
      } else {
        pushTri(vb0, vt1, vb1);
        pushTri(vb0, vt0, vt1);
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
          flat(new THREE.Vector3(x[0], baseY + heightAt(x), x[1])),
          flat(new THREE.Vector3(y[0], baseY + heightAt(y), y[1])),
          flat(new THREE.Vector3(z[0], baseY + heightAt(z), z[1])),
        );
        pushTri(
          flat(new THREE.Vector3(x[0], baseY, x[1])),
          flat(new THREE.Vector3(z[0], baseY, z[1])),
          flat(new THREE.Vector3(y[0], baseY, y[1])),
        );
      }
      addGroup(EDGE_OTHER, start);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
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

/** Walls of the visible levels with textures, baseboards and door/window openings. */
export function buildWalls(
  opened: OpenedHome,
  levels: Map<string | null, LevelInfo>,
  shown: Set<string | null>,
  requestRender: () => void,
): THREE.Group {
  const { home, wallShapes } = opened;
  const group = new THREE.Group();
  group.name = "walls";
  const evaluator = new Evaluator();
  evaluator.useGroups = true;
  const defaultHeight = home.attrs.wall_height ?? 250;
  const wallsAlpha = home.environment?.attrs.walls_alpha ?? 0;
  const textures = new TextureCache(opened.id, requestRender);

  const openings: Piece[] = [];
  forEachPiece(home.furniture, (p) => {
    if (p.kind === "DoorOrWindow") openings.push(p);
  });
  const maxThickness = Math.max(1, ...home.walls.map((w) => w.attrs.thickness));

  /** Subtracts the door and window openings of `level` from a wall or baseboard. */
  const cutOpenings = (
    geom: THREE.BufferGeometry,
    materials: THREE.Material[],
    level: string | null,
    baseY: number,
  ): THREE.BufferGeometry => {
    let brush = new Brush(geom, materials);
    brush.updateMatrixWorld();
    const box = new THREE.Box3().setFromBufferAttribute(
      geom.getAttribute("position") as THREE.BufferAttribute,
    );
    for (const p of openings) {
      if (p.attrs.level !== level) continue;
      const cut = openingBrush(p, baseY, p.attrs.depth + 2 * maxThickness + 10, materials);
      const cutBox = new THREE.Box3().setFromObject(cut);
      if (!cutBox.intersectsBox(box)) continue;
      brush = evaluator.evaluate(brush, cut, SUBTRACTION) as Brush;
      brush.updateMatrixWorld();
    }
    return brush.geometry;
  };

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
    const len = Math.hypot(dx, dz) || 1;
    const axis: SideAxis = { origin: [a.x_start, a.y_start], dir: [dx / len, dz / len] };
    const heightAt = (p: Pt) => {
      const t = Math.min(
        1,
        Math.max(0, ((p[0] - a.x_start) * dx + (p[1] - a.y_start) * dz) / (len * len)),
      );
      return h0 + (h1 - h0) * t;
    };

    const leftTexture = wall.textures?.find((t) => t.role === "leftSideTexture");
    const rightTexture = wall.textures?.find((t) => t.role === "rightSideTexture");
    const leftMaterial = wallMaterial(a.left_side_color, wallsAlpha, textures.get(leftTexture));
    const rightMaterial = wallMaterial(a.right_side_color, wallsAlpha, textures.get(rightTexture));
    const materials = [leftMaterial, rightMaterial, wallMaterial(a.top_color, wallsAlpha, null)];
    const geom = prismGeometry(poly, kinds, baseY, heightAt, axis);
    const mesh = new THREE.Mesh(cutOpenings(geom, materials, a.level, baseY), materials);
    mesh.name = `wall:${a.id}`;
    group.add(mesh);

    // Baseboards: thin prisms along the sides, colored like the side unless set
    for (const side of ["left", "right"] as const) {
      const bb = baseboardOf(wall, side);
      if (!bb || bb.attrs.thickness <= 0 || bb.attrs.height <= 0) continue;
      const outline = baseboardPolygon(shape, side, bb.attrs.thickness);
      if (!outline) continue;
      const sideMaterial = side === "left" ? leftMaterial : rightMaterial;
      let material: THREE.MeshLambertMaterial;
      if (bb.texture) material = wallMaterial(null, wallsAlpha, textures.get(bb.texture));
      else if (bb.attrs.color !== null) material = wallMaterial(bb.attrs.color, wallsAlpha, null);
      else material = sideMaterial;
      const bbMaterials = [material, material, material];
      const n = outline.poly.length;
      const half = n / 2;
      // Edges of the offset polyline are the visible front of the baseboard
      const bbKinds = outline.poly.map((_, j) => (j >= half && j < n - 1 ? EDGE_LEFT : EDGE_OTHER));
      const height = Math.min(bb.attrs.height, Math.min(h0, h1));
      const bbGeom = prismGeometry(outline.poly, bbKinds, baseY, () => height, axis);
      const bbMesh = new THREE.Mesh(cutOpenings(bbGeom, bbMaterials, a.level, baseY), bbMaterials);
      bbMesh.name = `baseboard:${a.id}:${side}`;
      group.add(bbMesh);
    }
  });
  return group;
}

/** Shares texture objects between walls that use the same image and size. */
class TextureCache {
  private map = new Map<string, THREE.Texture>();
  constructor(
    private docId: number,
    private onLoad: () => void,
  ) {}

  get(t: Texture | null | undefined): THREE.Texture | null {
    if (!t) return null;
    const key = `${t.image}|${t.width}|${t.height}|${t.angle ?? 0}|${t.scale ?? 1}`;
    let tex = this.map.get(key);
    if (!tex) {
      tex = loadTiledTexture(docResourceUrl(this.docId, t.image), t, this.onLoad);
      this.map.set(key, tex);
    }
    return tex;
  }
}

function wallMaterial(
  color: number | null,
  wallsAlpha: number,
  map: THREE.Texture | null,
): THREE.MeshLambertMaterial {
  // Like Sweet Home 3D, a texture replaces the color
  const m = new THREE.MeshLambertMaterial({ color: map ? 0xffffff : colorOf(color, 0xffffff) });
  if (map) m.map = map;
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
      // Polygon offset: where furniture stands exactly on the floor, the furniture wins the
      // depth test, so nothing flickers and nothing pokes through the floor
      const mat = new THREE.MeshLambertMaterial({
        color: floorTexture ? 0xffffff : colorOf(a.floor_color, 0xd8d2c4),
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      if (floorTexture) {
        mat.map = loadTiledTexture(
          docResourceUrl(opened.id, floorTexture.image),
          floorTexture,
          requestRender,
        );
      }
      // The floor is a slab with the level's floor thickness below the level elevation (like
      // Sweet Home 3D); its edges get the plain floor color
      const slab = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(level?.floorThickness ?? DEFAULT_FLOOR_THICKNESS, 0.1),
        bevelEnabled: false,
      });
      slab.rotateX(Math.PI / 2); // (x, y, z) → (x, -z, y): top at 0, bottom at -thickness
      const edges = new THREE.MeshLambertMaterial({
        color: colorOf(a.floor_color, 0xd8d2c4),
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const floor = new THREE.Mesh(slab, [mat, edges]);
      floor.position.y = level?.elevation ?? 0;
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

/** Radius of the sky dome; it follows the camera and must stay inside the far plane. */
const SKY_RADIUS = 90000;

/**
 * Sky texture on a half sphere around the viewer, like Sweet Home 3D: the image
 * spans 360° horizontally, its bottom row at the horizon and its top at the zenith.
 * Returns null when the home has no sky texture (the sky color is used then).
 */
export function buildSky(opened: OpenedHome, requestRender: () => void): THREE.Mesh | null {
  const skyTexture = opened.home.environment?.textures.find((t) => t.role === "skyTexture");
  if (!skyTexture) return null;
  const tex = textureLoader.load(docResourceUrl(opened.id, skyTexture.image), requestRender);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  // Upper half sphere; u runs around the y axis, v from the zenith (1) to the horizon (0)
  const geom = new THREE.SphereGeometry(SKY_RADIUS, 64, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  // Mirror so that the inside faces are front faces and the image is not reversed
  geom.scale(-1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = "sky";
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
