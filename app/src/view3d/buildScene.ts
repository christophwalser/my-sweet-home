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
import { holesAt, parseSvgPath, staircases } from "./staircase";
import { cachedTexture } from "./textures";
import { baseboardOf, baseboardPolygon } from "./wallSides";

export type LevelInfo = { elevation: number; height: number; floorThickness: number };

/** Floor thickness of homes without levels (Sweet Home 3D's default preference). */
const DEFAULT_FLOOR_THICKNESS = 12;
/**
 * Walls of upper levels reach this far into the walls below. A gap, even of 1 mm, shows
 * as a dark crack where the wall tops meet; the tiny overlap is not visible.
 */
const LEVEL_WALL_OVERLAP = 0.1;

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

export { visibleLevels } from "./levels3d";

export function colorOf(argb: number | null | undefined, fallback: number): THREE.Color {
  return new THREE.Color(argb === null || argb === undefined ? fallback : argb & 0xffffff);
}

/** Constant depth offset of floors (in depth buffer steps), see buildRooms. */
const FLOOR_OFFSET_UNITS = 2;

/** Repeating texture sized in centimeters (one image covers width × height cm). */
export function loadTiledTexture(url: string, t: Texture, onLoad: () => void): THREE.Texture {
  const tex = cachedTexture(url, onLoad);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const scale = t.scale ?? 1;
  tex.repeat.set(1 / (t.width * scale), 1 / (t.height * scale));
  tex.rotation = t.angle ?? 0;
  tex.offset.set(t.x_offset ?? 0, t.y_offset ?? 0);
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

/**
 * Prism that cuts the opening of a door or window with its own outline (Sweet Home 3D's
 * `doorOrWindowCutOutShape`: an SVG path in the unit square of the front, y downwards), e.g.
 * a round arch or an opening smaller than the frame. Null if the path has no outline.
 */
function shapedOpeningBrush(
  p: Piece,
  baseY: number,
  depth: number,
  materials: THREE.Material[],
): Brush | null {
  const a = p.attrs;
  const outline = parseSvgPath(a.cut_out_shape ?? "")[0];
  if (!outline || outline.length < 3) return null;
  const mirror = a.model_mirrored ? -1 : 1;
  const shape = new THREE.Shape(
    outline.map(([u, v]) => new THREE.Vector2(mirror * (u - 0.5) * a.width, (0.5 - v) * a.height)),
  );
  const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  geom.translate(0, 0, -depth / 2);
  for (const g of geom.groups) g.materialIndex = EDGE_OTHER;
  const brush = new Brush(geom, materials);
  brush.position.set(a.x, baseY + (a.elevation ?? 0) + a.height / 2, a.y);
  brush.rotation.y = -(a.angle ?? 0);
  brush.updateMatrixWorld();
  return brush;
}

/** Box that cuts the wall opening of a door or window. */
function openingBrush(p: Piece, baseY: number, depth: number, materials: THREE.Material[]): Brush {
  const a = p.attrs;
  const shaped = a.cut_out_shape ? shapedOpeningBrush(p, baseY, depth, materials) : null;
  if (shaped) return shaped;
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

/**
 * Geometries of walls and baseboards with their door and window openings cut out, kept from
 * one build of the scene to the next: cutting the openings is the slowest part of a rebuild,
 * and most changes (moving a piece, a texture) leave the walls as they are. A geometry is
 * looked up by everything that shapes it, so a changed wall or opening is cut again.
 * The cache owns its geometries (`userData.wallCache`): `disposeObject` leaves them alone.
 */
export class WallGeometryCache {
  private entries = new Map<string, THREE.BufferGeometry>();
  private used = new Map<string, THREE.BufferGeometry>();
  /** Number of geometries built (not found) since the cache was created; for tests. */
  built = 0;

  /** The geometry of `key`, from the last build or built now by `build`. */
  get(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let geometry = this.used.get(key) ?? this.entries.get(key);
    if (!geometry) {
      geometry = build();
      geometry.userData.wallCache = true;
      this.built++;
    }
    this.used.set(key, geometry);
    return geometry;
  }

  /** Ends a build: frees the geometries that it no longer uses. */
  commit(): void {
    for (const [key, geometry] of this.entries) {
      if (!this.used.has(key)) geometry.dispose();
    }
    this.entries = this.used;
    this.used = new Map();
  }

  /** Frees all geometries (another home, or the 3D view is closed). */
  clear(): void {
    for (const geometry of new Set([...this.entries.values(), ...this.used.values()])) {
      geometry.dispose();
    }
    this.entries.clear();
    this.used.clear();
  }
}

/** Attributes of a door or window that shape its wall opening (see `openingBrush`). */
function openingKey(p: Piece): unknown[] {
  const a = p.attrs;
  return [
    a.x,
    a.y,
    a.elevation,
    a.angle,
    a.width,
    a.height,
    a.depth,
    a.wall_width,
    a.wall_height,
    a.wall_left,
    a.wall_top,
    a.cut_out_shape,
    a.model_mirrored,
  ];
}

/**
 * Walls of the visible levels with textures, baseboards and door/window openings. With a
 * `cache`, unchanged wall geometries of the last build are reused (call `cache.commit()`
 * after the build).
 */
export function buildWalls(
  opened: OpenedHome,
  levels: Map<string | null, LevelInfo>,
  shown: Set<string | null>,
  requestRender: () => void,
  cache?: WallGeometryCache,
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

  const cutDepth = (p: Piece) => p.attrs.depth + 2 * maxThickness + 10;
  /** Bounds of the cut of each opening (they do not depend on the wall's materials). */
  const cutBoxes = new Map<string, THREE.Box3>();
  const cutBox = (p: Piece, index: number, baseY: number): THREE.Box3 => {
    const k = `${index}|${baseY}`;
    let box = cutBoxes.get(k);
    if (!box) {
      box = new THREE.Box3().setFromObject(openingBrush(p, baseY, cutDepth(p), []));
      cutBoxes.set(k, box);
    }
    return box;
  };

  /**
   * Subtracts the door and window openings of `level` from a wall or baseboard. `key`
   * describes `geom` completely; with the openings that touch it, it finds the cut
   * geometry of an earlier build.
   */
  const cutOpenings = (
    geom: THREE.BufferGeometry,
    materials: THREE.Material[],
    level: string | null,
    baseY: number,
    key: string,
  ): THREE.BufferGeometry => {
    const box = new THREE.Box3().setFromBufferAttribute(
      geom.getAttribute("position") as THREE.BufferAttribute,
    );
    const cuts: Piece[] = [];
    openings.forEach((p, index) => {
      if (p.attrs.level === level && cutBox(p, index, baseY).intersectsBox(box)) cuts.push(p);
    });
    const cut = (): THREE.BufferGeometry => {
      let brush = new Brush(geom, materials);
      brush.updateMatrixWorld();
      for (const p of cuts) {
        try {
          brush = evaluator.evaluate(
            brush,
            openingBrush(p, baseY, cutDepth(p), materials),
            SUBTRACTION,
          ) as Brush;
        } catch (e) {
          // A failed cut leaves the wall closed instead of failing the 3D view
          console.warn(`wall opening of ${p.attrs.name} skipped:`, e);
        }
        brush.updateMatrixWorld();
      }
      return brush.geometry;
    };
    if (!cache) return cut();
    return cache.get(JSON.stringify([key, level, baseY, maxThickness, cuts.map(openingKey)]), cut);
  };

  const lowestElevation = Math.min(...home.levels.map((l) => l.attrs.elevation));
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
    const leftMaterial = wallMaterial(
      a.left_side_color,
      wallsAlpha,
      textures.get(leftTexture),
      a.left_side_shininess,
    );
    const rightMaterial = wallMaterial(
      a.right_side_color,
      wallsAlpha,
      textures.get(rightTexture),
      a.right_side_shininess,
    );
    // Top (and ends and bottom): its own color and texture, seen on walls lower than the ceiling
    const topTexture = wall.textures?.find((t) => t.role === "topTexture");
    const materials = [
      leftMaterial,
      rightMaterial,
      wallMaterial(a.top_color, wallsAlpha, textures.get(topTexture)),
    ];
    // Like Sweet Home 3D, walls of upper levels reach down through the floor slab to the top
    // of the walls below, otherwise a gap of the floor thickness shows between the storeys
    const drop =
      level && a.level !== null && level.elevation !== lowestElevation
        ? Math.max(0, level.floorThickness + LEVEL_WALL_OVERLAP)
        : 0;
    const wallHeightAt = (p: Pt) => heightAt(p) + drop;
    const geom = prismGeometry(poly, kinds, baseY - drop, wallHeightAt, axis);
    // The prism only evaluates the heights at the polygon's points; three distinct materials
    const key = JSON.stringify(["wall", poly, kinds, baseY - drop, poly.map(wallHeightAt), axis]);
    const mesh = new THREE.Mesh(cutOpenings(geom, materials, a.level, baseY, key), materials);
    mesh.name = `wall:${a.id}`;
    group.add(mesh);

    // Baseboards: thin prisms along the sides, colored like the side unless set
    for (const side of ["left", "right"] as const) {
      const bb = baseboardOf(wall, side);
      if (!bb || bb.attrs.thickness <= 0 || bb.attrs.height <= 0) continue;
      const outline = baseboardPolygon(shape, side, bb.attrs.thickness);
      if (!outline) continue;
      const sideMaterial = side === "left" ? leftMaterial : rightMaterial;
      let material: THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;
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
      // One material in all three slots
      const bbKey = JSON.stringify(["baseboard", outline.poly, bbKinds, baseY, height, axis]);
      const bbMesh = new THREE.Mesh(
        cutOpenings(bbGeom, bbMaterials, a.level, baseY, bbKey),
        bbMaterials,
      );
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
    const key = `${t.image}|${t.width}|${t.height}|${t.angle ?? 0}|${t.scale ?? 1}|${t.x_offset ?? 0}|${t.y_offset ?? 0}`;
    let tex = this.map.get(key);
    if (!tex) {
      tex = loadTiledTexture(docResourceUrl(this.docId, t.image), t, this.onLoad);
      this.map.set(key, tex);
    }
    return tex;
  }
}

/**
 * Material of a wall side, floor or ceiling: matt (Lambert) by default; a shininess above 0
 * (Sweet Home 3D's "shiny" is 0.25) gives a Phong material with a highlight.
 */
export function surfaceMaterial(
  params: THREE.MeshLambertMaterialParameters,
  shininess: number | null | undefined,
): THREE.MeshLambertMaterial | THREE.MeshPhongMaterial {
  if (!shininess || shininess <= 0) return new THREE.MeshLambertMaterial(params);
  return new THREE.MeshPhongMaterial({
    ...params,
    shininess: shininess * 128,
    specular: new THREE.Color(0xffffff).multiplyScalar(Math.min(1, shininess * 1.6)),
  });
}

function wallMaterial(
  color: number | null,
  wallsAlpha: number,
  map: THREE.Texture | null,
  shininess?: number | null,
): THREE.MeshLambertMaterial | THREE.MeshPhongMaterial {
  // Like Sweet Home 3D, a texture replaces the color
  const m = surfaceMaterial({ color: map ? 0xffffff : colorOf(color, 0xffffff) }, shininess);
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
  // Staircases cut holes in the floors above and the ceilings they reach through
  const stairs = staircases(opened.home, levels);
  const evaluator = new Evaluator();
  evaluator.useGroups = true;
  const ceilings: { level: string | null; points: Pt[]; ceilingY: number; mat: THREE.Material }[] =
    [];
  for (const room of opened.home.rooms) {
    const a = room.attrs;
    if (!shown.has(a.level) || room.points.length < 3) continue;
    const level = levels.get(a.level) ?? levels.get(null);
    const shape = new THREE.Shape(room.points.map((p) => new THREE.Vector2(p.x, p.y)));
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(Math.PI / 2); // (x, y, 0) → (x, 0, y)
    const floorY = level?.elevation ?? 0;
    const ceilingY = floorY + (level?.height ?? 250) - 0.2;
    const floorHoles = touching(holesAt(stairs, floorY), room.points);
    const ceilingHoles = touching(holesAt(stairs, ceilingY), room.points);

    if (a.floor_visible !== false) {
      const floorTexture = room.textures?.find((t) => t.role === "floorTexture");
      // Polygon offset: where furniture stands exactly on the floor, the furniture wins the
      // depth test, so nothing flickers and nothing pokes through the floor. Constant only
      // (no slope factor): at flat viewing angles a slope factor pushed floors behind the
      // ground just below them, which then showed through.
      const mat = surfaceMaterial(
        {
          color: floorTexture ? 0xffffff : colorOf(a.floor_color, 0xd8d2c4),
          polygonOffset: true,
          polygonOffsetFactor: 0,
          polygonOffsetUnits: FLOOR_OFFSET_UNITS,
        },
        a.floor_shininess,
      );
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
        polygonOffsetFactor: 0,
        polygonOffsetUnits: FLOOR_OFFSET_UNITS,
      });
      const floorGeometry =
        floorHoles.length > 0 ? cutOut(evaluator, slab, floorHoles, [mat, edges]) : slab;
      const floor = new THREE.Mesh(floorGeometry, [mat, edges]);
      floor.position.y = level?.elevation ?? 0;
      floor.name = `floor:${a.id ?? ""}`;
      group.add(floor);
    }
    if (a.ceiling_visible !== false) {
      const ceilingTexture = room.textures?.find((t) => t.role === "ceilingTexture");
      const mat = surfaceMaterial(
        {
          color: ceilingTexture ? 0xffffff : colorOf(a.ceiling_color, 0xf4f4f4),
          // The rotated shape faces down: visible from below, hidden in the aerial view
          side: THREE.FrontSide,
        },
        a.ceiling_shininess,
      );
      if (ceilingTexture) {
        mat.map = loadTiledTexture(
          docResourceUrl(opened.id, ceilingTexture.image),
          ceilingTexture,
          requestRender,
        );
      }
      let ceilingGeometry: THREE.BufferGeometry = geom;
      if (ceilingHoles.length > 0) {
        // Cut through a thin slab, then keep its downward faces: the ceiling with holes
        const slab = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
        slab.rotateX(Math.PI / 2);
        ceilingGeometry = facesDown(cutOut(evaluator, slab, ceilingHoles, [mat, mat]), -1);
      }
      ceilings.push({ level: a.level, points: room.points.map((p) => [p.x, p.y]), ceilingY, mat });
      const ceiling = new THREE.Mesh(ceilingGeometry, mat);
      // The cut slab's lower face is 1 cm below its top
      ceiling.position.y = ceilingY + (ceilingHoles.length > 0 ? 1 : 0);
      ceiling.name = `ceiling:${a.id ?? ""}`;
      group.add(ceiling);
    }
  }
  for (const cap of wallCeilingCaps(opened.home, ceilings)) group.add(cap);
  return group;
}

/**
 * The ceilings of rooms end at their walls. Above a wall lower than the ceiling (a half-height
 * wall) that left a gap, through which the sky showed when the level above is not displayed:
 * such walls get a piece of the ceiling of the room next to them.
 */
function wallCeilingCaps(
  home: OpenedHome["home"],
  ceilings: { level: string | null; points: Pt[]; ceilingY: number; mat: THREE.Material }[],
): THREE.Mesh[] {
  const caps: THREE.Mesh[] = [];
  const defaultHeight = home.attrs.wall_height ?? 250;
  const levelElevation = (id: string | null) =>
    home.levels.find((l) => l.attrs.id === id)?.attrs.elevation ?? 0;
  for (const wall of home.walls) {
    const a = wall.attrs;
    if (a.arc_extent) continue;
    const dx = a.x_end - a.x_start;
    const dy = a.y_end - a.y_start;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    const half = a.thickness / 2;
    const top =
      levelElevation(a.level) +
      Math.max(a.height ?? defaultHeight, a.height_at_end ?? a.height ?? defaultHeight);
    // Points just beside both faces: the room whose ceiling covers them is next to the wall
    const probes: Pt[] = [];
    for (const t of [0.25, 0.5, 0.75]) {
      for (const side of [1, -1]) {
        const d = side * (half + 2);
        probes.push([a.x_start + dx * t - uy * d, a.y_start + dy * t + ux * d]);
      }
    }
    const next = ceilings.find(
      (c) =>
        c.level === a.level &&
        top < c.ceilingY - 1 &&
        probes.some((p) => insidePolygon(p, c.points)),
    );
    if (!next) continue;
    // A little wider (3 cm) and longer (10 cm, into the walls it meets) than the wall, so no slit stays to the rooms' ceilings
    const w = half + 3;
    const [sx, sy] = [a.x_start - ux * 10, a.y_start - uy * 10];
    const [ex, ey] = [a.x_end + ux * 10, a.y_end + uy * 10];
    const corners: Pt[] = [
      [sx - uy * w, sy + ux * w],
      [ex - uy * w, ey + ux * w],
      [ex + uy * w, ey - ux * w],
      [sx + uy * w, sy - ux * w],
    ];
    const geom = new THREE.ShapeGeometry(
      new THREE.Shape(corners.map(([x, y]) => new THREE.Vector2(x, y))),
    );
    geom.rotateX(Math.PI / 2); // faces down like the ceilings
    const cap = new THREE.Mesh(geom, next.mat);
    cap.position.y = next.ceilingY;
    cap.name = `wallCeiling:${a.id}`;
    caps.push(cap);
  }
  return caps;
}

/** True if `p` lies inside the polygon (even-odd rule). */
function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Holes that reach into the room's area. Rooms are often drawn around the stairwell
 * already (Sweet Home 3D's example homes): a hole in such a notch only touches the room's
 * edges and must not be cut (the cut would fail on the coinciding edges).
 */
function touching(holes: Pt[][], points: { x: number; y: number }[]): Pt[][] {
  const room: Pt[] = points.map((p) => [p.x, p.y]);
  return holes.filter((hole) => {
    // Points of the hole slightly inside it: its corners pulled towards its center, and
    // the middles of its edges
    const cx = hole.reduce((s, p) => s + p[0], 0) / hole.length;
    const cy = hole.reduce((s, p) => s + p[1], 0) / hole.length;
    const samples: Pt[] = [[cx, cy]];
    hole.forEach((p, i) => {
      const q = hole[(i + 1) % hole.length];
      samples.push([p[0] + (cx - p[0]) * 0.02, p[1] + (cy - p[1]) * 0.02]);
      const mx = (p[0] + q[0]) / 2;
      const my = (p[1] + q[1]) / 2;
      samples.push([mx + (cx - mx) * 0.02, my + (cy - my) * 0.02]);
    });
    if (samples.some((p) => insidePolygon(p, room))) return true;
    // A room smaller than the hole lies inside it
    return room.some((p) => insidePolygon(p, hole));
  });
}

/**
 * Subtracts vertical prisms of the hole outlines from a slab made by ExtrudeGeometry and
 * rotated like the floors (top at y = 0, bottom below).
 */
function cutOut(
  evaluator: Evaluator,
  slab: THREE.BufferGeometry,
  holes: Pt[][],
  materials: THREE.Material[],
): THREE.BufferGeometry {
  let brush = new Brush(slab, materials);
  brush.updateMatrixWorld();
  for (const outline of holes) {
    const prism = new THREE.ExtrudeGeometry(
      new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))),
      { depth: 400, bevelEnabled: false },
    );
    prism.rotateX(Math.PI / 2);
    prism.translate(0, 200, 0);
    const hole = new Brush(prism, materials);
    hole.updateMatrixWorld();
    try {
      brush = evaluator.evaluate(brush, hole, SUBTRACTION);
    } catch (e) {
      // A failed cut leaves the surface without this hole instead of failing the 3D view
      console.warn("staircase cut-out skipped:", e);
    }
    prism.dispose();
  }
  return brush.geometry;
}

/** Only the faces of a geometry that face down (keeps the material groups' order). */
function facesDown(geometry: THREE.BufferGeometry, y: number): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.getAttribute("position");
  const keep: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    if (normal.y < 0 && Math.abs(a.y - y) < 0.01) keep.push(i, i + 1, i + 2);
  }
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const src = attr as THREE.BufferAttribute;
    const array = new (src.array.constructor as Float32ArrayConstructor)(
      keep.length * src.itemSize,
    );
    keep.forEach((v, k) => {
      for (let j = 0; j < src.itemSize; j++)
        array[k * src.itemSize + j] = src.array[v * src.itemSize + j];
    });
    out.setAttribute(name, new THREE.BufferAttribute(array, src.itemSize));
  }
  return out;
}

// ------------------------------------------------------------------ Ground and environment

/**
 * The flat ground. `holes` are footprints (plan coordinates) it leaves open, e.g. where
 * terrain replaces it.
 */
export function buildGround(
  opened: OpenedHome,
  requestRender: () => void,
  holes: Pt[][] = [],
): THREE.Mesh {
  const env = opened.home.environment;
  const groundTexture = env?.textures.find((t) => t.role === "groundTexture");
  // The ground always loses against floors lying on it, also at flat viewing angles
  const mat = new THREE.MeshLambertMaterial({
    color: groundTexture ? 0xffffff : colorOf(env?.attrs.ground_color, 0xa8a8a8),
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 8,
  });
  if (groundTexture) {
    mat.map = loadTiledTexture(
      docResourceUrl(opened.id, groundTexture.image),
      groundTexture,
      requestRender,
    );
  }
  const size = 200000;
  let geom: THREE.BufferGeometry;
  if (holes.length === 0) {
    geom = new THREE.PlaneGeometry(size, size);
  } else {
    // Drawn with y up (the plan's y points to the front), so that the face looks up
    const half = size / 2;
    const shape = new THREE.Shape([
      new THREE.Vector2(-half, -half),
      new THREE.Vector2(half, -half),
      new THREE.Vector2(half, half),
      new THREE.Vector2(-half, half),
    ]);
    for (const ring of holes) {
      shape.holes.push(new THREE.Path(ring.map(([x, y]) => new THREE.Vector2(x, -y))));
    }
    geom = new THREE.ShapeGeometry(shape);
  }
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
  const tex = cachedTexture(docResourceUrl(opened.id, skyTexture.image), requestRender);
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
