// Furniture seen from above for the 2D plan, like Sweet Home 3D's "furniture viewed from top":
// the 3D model of a piece (with its color, materials, mirroring and tilt) rendered with an
// orthographic camera looking down, filling the piece's footprint. Views are rendered one
// after another on a shared offscreen renderer and cached; the plan shows the catalog icon
// until a view is ready.

import * as THREE from "three";
import { forEachPiece, type Home, type Piece } from "../model";
import { createPieceObject } from "../view3d/models";
import { texturePending } from "../view3d/textures";

/** Longest side of a top view in pixels. */
const SIZE = 384;
/** How long to wait for a model, and for its textures after it loaded. */
const MODEL_TIMEOUT_MS = 20000;
const TEXTURE_TIMEOUT_MS = 3000;

type Entry = HTMLCanvasElement | "pending" | "failed";

const cache = new Map<string, Entry>();
let cacheDoc: number | null = null;
const queue: (() => Promise<void>)[] = [];
let running = false;
let renderer: THREE.WebGLRenderer | null = null;

/** Everything that changes how a piece looks from above. */
function key(p: Piece, docId: number): string {
  const a = p.attrs;
  const r = (v: number | null | undefined) =>
    v === null || v === undefined ? null : Math.round(v * 10) / 10;
  return JSON.stringify([
    docId,
    a.model,
    a.model_rotation,
    a.model_mirrored ?? false,
    a.color,
    a.back_face_shown ?? false,
    r(a.width),
    r(a.depth),
    r(a.height),
    r(a.pitch),
    r(a.roll),
    (p.materials ?? []).map((m) => [
      m.attrs.name,
      m.attrs.color,
      m.attrs.shininess,
      m.texture?.image,
    ]),
  ]);
}

/**
 * The top view of a piece, or null while it is rendered (or if the piece has no model).
 * `onReady` is called when a requested view becomes available.
 */
export function topView(p: Piece, docId: number, onReady: () => void): HTMLCanvasElement | null {
  if (!p.attrs.model) return null;
  if (cacheDoc !== docId) {
    // Views of another home are no longer needed
    cache.clear();
    cacheDoc = docId;
  }
  const k = key(p, docId);
  const entry = cache.get(k);
  if (entry instanceof HTMLCanvasElement) return entry;
  if (entry) return null;
  cache.set(k, "pending");
  // Snapshot of the piece: the plan may already show a newer state when it is rendered
  const piece: Piece = JSON.parse(JSON.stringify(p));
  queue.push(async () => {
    try {
      const view = await render(piece, docId);
      if (cacheDoc === docId) cache.set(k, view);
    } catch (e) {
      console.warn(`top view of ${piece.attrs.name}: ${String(e)}`);
      if (cacheDoc === docId) cache.set(k, "failed");
    }
    onReady();
  });
  void work();
  return null;
}

/** The top view of a piece once it is rendered (null: no model, failed or timed out). */
export async function topViewAsync(
  p: Piece,
  docId: number,
  timeoutMs = 30000,
): Promise<HTMLCanvasElement | null> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const view = topView(p, docId, () => {});
    if (view) return view;
    if (!p.attrs.model || cache.get(key(p, docId)) === "failed") return null;
    if (performance.now() > end) return null;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/**
 * Views from above of all visible pieces of a home, for exports: PNG images (base64) by key
 * and the key of each piece. Pieces that look the same share one image.
 */
export async function collectTopViews(
  home: Home,
  docId: number,
): Promise<{ images: Record<string, string>; pieces: Record<string, string> }> {
  const pieces: Piece[] = [];
  forEachPiece(home.furniture, (p) => {
    if (p.attrs.id && p.attrs.model && p.attrs.visible !== false) pieces.push(p);
  });
  const images: Record<string, string> = {};
  const byCanvas = new Map<HTMLCanvasElement, string>();
  const result: Record<string, string> = {};
  for (const p of pieces) {
    const view = await topViewAsync(p, docId);
    if (!view || !p.attrs.id) continue;
    let k = byCanvas.get(view);
    if (!k) {
      k = `v${byCanvas.size}`;
      byCanvas.set(view, k);
      images[k] = view.toDataURL("image/png").split(",")[1] ?? "";
    }
    result[p.attrs.id] = k;
  }
  return { images, pieces: result };
}

async function work(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await job();
      // Let the window handle input between renders
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    running = false;
  }
}

/** Waits until the model of a new piece object is loaded. */
function loadPiece(piece: Piece, docId: number): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    let done = false;
    const obj = createPieceObject(piece, docId, 0, () => {
      if (!done) {
        done = true;
        resolve(obj);
      }
    });
    setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error("the model did not load"));
      }
    }, MODEL_TIMEOUT_MS);
  });
}

/** Whether all texture images of an object have loaded. */
function texturesLoaded(obj: THREE.Object3D): boolean {
  let ready = true;
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const map = (m as THREE.MeshPhongMaterial).map;
      const img = map?.image as HTMLImageElement | undefined;
      if (
        map &&
        (texturePending(map) || !img || (img instanceof HTMLImageElement && !img.complete))
      )
        ready = false;
    }
  });
  return ready;
}

async function render(p: Piece, docId: number): Promise<HTMLCanvasElement> {
  const a = p.attrs;
  // Footprint after pitch and roll, as the plan draws it
  const w = a.width_in_plan ?? a.width;
  const d = a.depth_in_plan ?? a.depth;
  if (!(w > 0 && d > 0)) throw new Error("the piece has no footprint");
  const centered: Piece = { ...p, attrs: { ...a, x: 0, y: 0, angle: 0, elevation: 0 } };
  const obj = await loadPiece(centered, docId);
  const end = performance.now() + TEXTURE_TIMEOUT_MS;
  while (!texturesLoaded(obj) && performance.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const width = Math.max(8, Math.round(w >= d ? SIZE : (SIZE * w) / d));
  const height = Math.max(8, Math.round(d >= w ? SIZE : (SIZE * d) / w));
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
  }
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  scene.add(obj);
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  // Light from above and slightly from the front, so shapes keep some shading
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(0.3, 1, 0.6);
  scene.add(sun);
  // Looking down; the top of the image is the back of the piece (towards −y in the plan)
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, d / 2, -d / 2, 1, 100000);
  camera.position.set(0, 50000, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d")?.drawImage(renderer.domElement, 0, 0);
  // The model's geometry is shared with the model cache: only detach it
  scene.remove(obj);
  return out;
}
