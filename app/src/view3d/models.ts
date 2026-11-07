// Loading and placing 3D models of furniture.
//
// Supports the model formats of Sweet Home 3D: OBJ (+ MTL), 3DS and Collada.
// The model is normalized like Sweet Home 3D's ModelManager: the optional
// model rotation is applied, then the model is scaled to the piece's width,
// height and depth and placed with its bottom at the piece elevation.

import * as THREE from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js";
import { docResourceUrl } from "../api";
import type { Piece } from "../model";
import { DEFAULT_MATERIALS } from "./defaultMaterials";

const cache = new Map<string, Promise<THREE.Object3D>>();

/** Forgets all cached models (call when a home is closed). */
export function clearModelCache(): void {
  for (const p of cache.values()) {
    p.then((obj) => disposeObject(obj)).catch(() => {});
  }
  cache.clear();
}

export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

function loadModel(url: string): Promise<THREE.Object3D> {
  let p = cache.get(url);
  if (!p) {
    p = fetchAndParse(url);
    cache.set(url, p);
  }
  return p;
}

async function fetchAndParse(url: string): Promise<THREE.Object3D> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model not found: ${url}`);
  const buffer = await res.arrayBuffer();
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 512));

  // 3DS files start with the chunk id 0x4D4D
  if (bytes[0] === 0x4d && bytes[1] === 0x4d) {
    const loader = new TDSLoader();
    loader.setResourcePath(base);
    loader.setCrossOrigin("anonymous");
    return loader.parse(buffer, base);
  }
  const text = new TextDecoder().decode(buffer);
  if (text.includes("<COLLADA")) {
    const loader = new ColladaLoader();
    loader.setCrossOrigin("anonymous");
    const result = loader.parse(text, base);
    if (!result) throw new Error(`invalid Collada model: ${url}`);
    return result.scene;
  }
  return parseObj(text, base);
}

/**
 * Removes texture maps whose image does not exist. three.js renders a material
 * with an unloadable map black, while Sweet Home 3D falls back to the diffuse color.
 */
async function withoutMissingTextures(mtl: string, base: string): Promise<string> {
  const mapLine = /^\s*(map_\w+|bump|disp|decal|refl)\s+(?:-\S+\s+\S+\s+)*(.+?)\s*$/gm;
  const files = new Set<string>();
  for (const m of mtl.matchAll(mapLine)) files.add(m[2]);
  const missing = new Set<string>();
  await Promise.all(
    [...files].map(async (file) => {
      const url = base + file.replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/");
      const res = await fetch(url).catch(() => null);
      if (!res?.ok) missing.add(file);
    }),
  );
  if (missing.size === 0) return mtl;
  return mtl.replace(mapLine, (line, _kind, file: string) => (missing.has(file) ? "" : line));
}

async function parseObj(text: string, base: string): Promise<THREE.Object3D> {
  const loader = new OBJLoader();
  const mtllib = /^mtllib\s+(.+)$/m.exec(text)?.[1]?.trim();
  if (mtllib) {
    try {
      const res = await fetch(base + mtllib.split("/").map(encodeURIComponent).join("/"));
      if (!res.ok) throw new Error("MTL file not found");
      const mtlText = await withoutMissingTextures(await res.text(), base);
      const mtlLoader = new MTLLoader();
      mtlLoader.setCrossOrigin("anonymous");
      mtlLoader.setResourcePath(base);
      const materials = mtlLoader.parse(mtlText, base);
      materials.preload();
      loader.setMaterials(materials);
    } catch {
      // Missing MTL file: fall back to the default materials below
    }
  }
  const obj = loader.parse(text);
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = mats.map((m) =>
      applyDefaultMaterial(m as THREE.MeshPhongMaterial, Boolean(mtllib)),
    );
    if (mats.length === 1) mesh.material = (mesh.material as THREE.Material[])[0];
  });
  // After the default materials, which would otherwise replace the transparency
  applyWindowPanes(obj);
  return obj;
}

/** Java 3D default material for `usemtl` names that are not defined in an MTL file. */
function applyDefaultMaterial(m: THREE.MeshPhongMaterial, hasMtl: boolean): THREE.Material {
  const def = DEFAULT_MATERIALS[m.name];
  if (!def || (hasMtl && m.map)) return m;
  if (hasMtl && !(m.name in DEFAULT_MATERIALS)) return m;
  const mat = new THREE.MeshPhongMaterial({
    name: m.name,
    color: new THREE.Color(...def.kd),
    specular: new THREE.Color(...def.ks),
    shininess: Math.min(def.ns, 128),
  });
  if (def.d !== undefined && def.d < 1) {
    mat.transparent = true;
    mat.opacity = def.d;
  }
  return mat;
}

/** Parses Sweet Home 3D's `modelRotation` (3x3 matrix, row-major) into a Matrix4. */
function rotationMatrix(s: string | null): THREE.Matrix4 | null {
  if (!s) return null;
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length !== 9 || v.some(Number.isNaN)) return null;
  const isIdentity = v.every((x, i) => x === (i % 4 === 0 ? 1 : 0));
  if (isIdentity) return null;
  return new THREE.Matrix4().set(
    v[0],
    v[1],
    v[2],
    0,
    v[3],
    v[4],
    v[5],
    0,
    v[6],
    v[7],
    v[8],
    0,
    0,
    0,
    0,
    1,
  );
}

/**
 * Height of a piece's bounding box after pitch and roll. Uses `heightInPlan`
 * when Sweet Home 3D stored it, otherwise computes it from the rotated box.
 */
function heightInPlan(a: Piece["attrs"], pitch: number, roll: number): number {
  if (a.height_in_plan !== null && a.height_in_plan !== undefined) return a.height_in_plan;
  if (pitch === 0 && roll === 0) return a.height;
  // Euler order "ZXY" gives Rz(−roll) · Rx(−pitch), as in Sweet Home 3D
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-pitch, 0, -roll, "ZXY"));
  const box = new THREE.Box3(
    new THREE.Vector3(-a.width / 2, -a.height / 2, -a.depth / 2),
    new THREE.Vector3(a.width / 2, a.height / 2, a.depth / 2),
  ).applyMatrix4(m);
  return box.max.y - box.min.y;
}

/** Number of piece models currently loading. */
let pendingModels = 0;

/** Resolves when all piece models have loaded (or after `timeoutMs`). */
export async function waitForModels(timeoutMs: number): Promise<void> {
  const end = performance.now() + timeoutMs;
  while (pendingModels > 0 && performance.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Creates the 3D object of a piece. Returns immediately with an empty group;
 * the model is added when it has been loaded.
 */
export function createPieceObject(
  piece: Piece,
  docId: number,
  baseElevation: number,
  onLoaded: () => void,
): THREE.Group {
  const a = piece.attrs;
  const outer = new THREE.Group();
  outer.name = `piece:${a.id ?? a.name}`;
  // Like Sweet Home 3D (ModelManager): rotY(−angle) · rotZ(−roll) · rotX(−pitch) · scale,
  // with the center at elevation + heightInPlan / 2 (height of the box after pitch/roll)
  const pitch = a.pitch ?? 0;
  const roll = a.roll ?? 0;
  outer.position.set(
    a.x,
    baseElevation + (a.elevation ?? 0) + heightInPlan(a, pitch, roll) / 2,
    a.y,
  );
  outer.rotation.order = "YZX";
  outer.rotation.y = -(a.angle ?? 0);
  outer.rotation.z = -roll;
  outer.rotation.x = -pitch;
  if (!a.model) return outer;

  pendingModels++;
  loadModel(docResourceUrl(docId, a.model))
    .finally(() => {
      pendingModels--;
    })
    .then((model) => {
      const inner = model.clone(true);
      const rotated = new THREE.Group();
      rotated.add(inner);
      const rot = rotationMatrix(a.model_rotation);
      if (rot) inner.applyMatrix4(rot);
      rotated.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rotated);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      inner.position.sub(center);
      const scale = new THREE.Vector3(
        size.x > 0 ? a.width / size.x : 1,
        size.y > 0 ? a.height / size.y : 1,
        size.z > 0 ? a.depth / size.z : 1,
      );
      if (a.model_mirrored) scale.x = -scale.x;
      rotated.scale.copy(scale);
      applyPieceMaterials(inner, piece);
      inner.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.receiveShadow = true;
        // Transparent parts like window panes let the sun through
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mesh.castShadow = !mats.some((m) => m.transparent && m.opacity < 0.9);
      });
      outer.add(rotated);
      onLoaded();
    })
    .catch((e) => console.warn(String(e)));
  return outer;
}

/** Group name prefix of window panes; Sweet Home 3D renders them 50 % transparent. */
const WINDOW_PANE_PREFIX = "sweethome3d_window_pane";
const WINDOW_PANE_OPACITY = 0.5;

/** Makes window panes transparent, like Sweet Home 3D's ModelManager does. */
function applyWindowPanes(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.name.startsWith(WINDOW_PANE_PREFIX)) return;
    const convert = (m: THREE.Material): THREE.Material => {
      const c = m.clone();
      c.transparent = true;
      c.opacity = Math.min(c.opacity, WINDOW_PANE_OPACITY);
      c.depthWrite = false;
      c.side = THREE.DoubleSide;
      return c;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
}

/** Applies color and material overrides of a piece to its (cloned) model. */
function applyPieceMaterials(obj: THREE.Object3D, piece: Piece): void {
  const a = piece.attrs;
  const overrides = new Map((piece.materials ?? []).map((m) => [m.attrs.name, m.attrs]));
  const side = a.back_face_shown ? THREE.DoubleSide : THREE.FrontSide;
  if (a.color === null && overrides.size === 0 && side === THREE.FrontSide && !a.model_mirrored)
    return;
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (m: THREE.Material): THREE.Material => {
      const c = m.clone() as THREE.MeshPhongMaterial;
      // Mirroring flips the winding order; show both sides to stay visible
      c.side = a.model_mirrored ? THREE.DoubleSide : side;
      const o = overrides.get(m.name);
      const color = o?.color ?? a.color;
      if (color !== null && color !== undefined) {
        c.color = new THREE.Color(color & 0xffffff);
        c.map = null;
      }
      if (o?.shininess !== null && o?.shininess !== undefined && "shininess" in c) {
        c.shininess = o.shininess * 128;
      }
      return c;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(convert)
      : convert(mesh.material);
  });
}
