// Selection in the 3D view: which element of the home an object of the scene belongs to, the
// outline drawn around selected elements, and the section planes that cut the home open.

import * as THREE from "three";
import { type Home, piecesWithTop } from "../model";

/** Kinds of elements that can be selected in the 3D view. */
export type ElementKind = "furniture" | "wall" | "room";

export type SceneElement = { id: string; kind: ElementKind };

const PREFIXES: [string, ElementKind][] = [
  ["piece:", "furniture"],
  ["wall:", "wall"],
  ["baseboard:", "wall"],
  ["wallCeiling:", "wall"],
  ["floor:", "room"],
  ["ceiling:", "room"],
];

/**
 * Element of the home an object of the scene belongs to (the object or one of its parents
 * is named `piece:<id>`, `wall:<id>`, `floor:<id>` ...), or null for the ground, the sky and
 * annotations. For furniture the ID is the one of the piece itself, see {@link topIds}.
 */
export function elementOf(object: THREE.Object3D | null): SceneElement | null {
  for (let o = object; o; o = o.parent) {
    for (const [prefix, kind] of PREFIXES) {
      if (!o.name.startsWith(prefix)) continue;
      const id = o.name.slice(prefix.length).split(":")[0];
      return id ? { id, kind } : null;
    }
  }
  return null;
}

/** Whether an object is the ground (a click on it selects nothing and ends the search). */
export function isGround(object: THREE.Object3D): boolean {
  return object.name === "ground";
}

/**
 * Top-level element and level of every visible piece by piece ID: a piece of a group is
 * selected and moved with its group.
 */
export function topIds(home: Home): Map<string, { top: string; level: string | null }> {
  const map = new Map<string, { top: string; level: string | null }>();
  for (const { piece, topId, level } of piecesWithTop(home.furniture)) {
    if (piece.attrs.id && topId) map.set(piece.attrs.id, { top: topId, level });
  }
  return map;
}

/** Level of a wall or room of the home (undefined if there is no such element). */
export function levelOfElement(home: Home, e: SceneElement): string | null | undefined {
  if (e.kind === "wall") return home.walls.find((w) => w.attrs.id === e.id)?.attrs.level;
  if (e.kind === "room") return home.rooms.find((r) => r.attrs.id === e.id)?.attrs.level;
  return undefined;
}

/** Selection after a click on `id`: alone, or added / removed with Ctrl or Shift. */
export function clickSelection(selection: string[], id: string | null, extend: boolean): string[] {
  if (!id) return extend ? selection : [];
  if (!extend) return [id];
  return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
}

// ------------------------------------------------------------------ Outline

const OUTLINE_COLOR = 0x2f8cff;

/** Outline of the selected elements, drawn over everything so it shows through walls. */
export class SelectionOutline {
  readonly group = new THREE.Group();
  private readonly line = new THREE.LineBasicMaterial({
    color: OUTLINE_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  private readonly fill = new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.12,
  });
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly boxEdges = new THREE.EdgesGeometry(this.box);

  constructor() {
    this.group.name = "selection";
    this.group.visible = false;
  }

  /** Removes all outlines. */
  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const geometry = (child as THREE.Mesh).geometry;
      if (geometry !== this.box && geometry !== this.boxEdges) geometry.dispose();
    }
  }

  get empty(): boolean {
    return this.group.children.length === 0;
  }

  /** A box of the given size at the place of `object` (a piece of furniture). */
  addBox(object: THREE.Object3D, width: number, height: number, depth: number): void {
    object.updateWorldMatrix(true, false);
    const matrix = object.matrixWorld
      .clone()
      .multiply(new THREE.Matrix4().makeScale(width, height, depth));
    for (const o of [
      new THREE.LineSegments(this.boxEdges, this.line),
      new THREE.Mesh(this.box, this.fill),
    ]) {
      o.matrixAutoUpdate = false;
      o.matrix.copy(matrix);
      o.renderOrder = 999;
      this.group.add(o);
    }
  }

  /** The edges of a mesh (a wall, the floor of a room). */
  addEdges(mesh: THREE.Mesh): void {
    if (!mesh.geometry) return;
    mesh.updateWorldMatrix(true, false);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 25), this.line);
    edges.matrixAutoUpdate = false;
    edges.matrix.copy(mesh.matrixWorld);
    edges.renderOrder = 999;
    this.group.add(edges);
  }

  /** Bounds of everything outlined (empty if nothing is). */
  bounds(): THREE.Box3 {
    const box = new THREE.Box3();
    this.group.updateMatrixWorld(true);
    for (const child of this.group.children) {
      const geometry = (child as THREE.LineSegments).geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        box.union(geometry.boundingBox.clone().applyMatrix4(child.matrixWorld));
      }
    }
    return box;
  }

  dispose(): void {
    this.clear();
    this.box.dispose();
    this.boxEdges.dispose();
    this.line.dispose();
    this.fill.dispose();
  }
}

// ------------------------------------------------------------------ Section planes

/** Side of the plan a vertical section cuts away from. */
export type SectionSide = "front" | "left" | "back" | "right";

export type Section = {
  /** Everything above this height (cm above the ground) is cut away; null: no cut */
  horizontal: number | null;
  /** Vertical cut: the share (0..1) of the home cut away, counted from `side` */
  vertical: { side: SectionSide; position: number } | null;
};

export const NO_SECTION: Section = { horizontal: null, vertical: null };

/** Direction towards the side of the plan in the scene (front is the bottom of the plan). */
const SIDE_DIRECTION: Record<SectionSide, [number, number]> = {
  front: [0, 1],
  left: [-1, 0],
  back: [0, -1],
  right: [1, 0],
};

/** A plane that cuts nothing (the number of planes of a material must not change). */
const FAR = 1e9;

/**
 * Sets the two clipping planes of a section (horizontal, vertical) for a home with the
 * bounds `box`: points with a positive distance are kept. Returns whether anything is cut.
 */
export function setSectionPlanes(
  planes: [THREE.Plane, THREE.Plane],
  section: Section,
  box: THREE.Box3,
): boolean {
  const [horizontal, vertical] = planes;
  if (section.horizontal === null) horizontal.set(new THREE.Vector3(0, -1, 0), FAR);
  else horizontal.set(new THREE.Vector3(0, -1, 0), section.horizontal);
  if (!section.vertical || box.isEmpty()) {
    vertical.set(new THREE.Vector3(0, 0, -1), FAR);
  } else {
    const [dx, dz] = SIDE_DIRECTION[section.vertical.side];
    const a = dx * box.min.x + dz * box.min.z;
    const b = dx * box.max.x + dz * box.max.z;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const position = THREE.MathUtils.clamp(section.vertical.position, 0, 1);
    // Kept: the points whose coordinate towards the side is below the cut
    vertical.set(new THREE.Vector3(-dx, 0, -dz), high - position * (high - low));
  }
  return section.horizontal !== null || section.vertical !== null;
}

/** Whether a point is on the kept side of all planes. */
export function keptBy(planes: readonly THREE.Plane[], point: THREE.Vector3): boolean {
  return planes.every((p) => p.distanceToPoint(point) >= 0);
}

/**
 * Gives the materials below `root` the clipping planes (or takes them away with null).
 * Materials whose planes change are compiled again by three.js.
 */
export function clipMaterials(root: THREE.Object3D, planes: THREE.Plane[] | null): void {
  root.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      if (m.clippingPlanes === planes) continue;
      m.clippingPlanes = planes;
      m.clipShadows = planes !== null;
      m.needsUpdate = true;
    }
  });
}
