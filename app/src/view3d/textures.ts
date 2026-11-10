// Textures of the 3D view: images are loaded once and kept while the home is open, so that
// rebuilding the scene (after every change) shows them at once instead of rendering black
// until they are loaded again. Also texture coordinates for models that have none.

import * as THREE from "three";

const loaded = new Map<string, ImageSource>();
const pending = new Map<string, Promise<ImageSource>>();
const imageLoader = new THREE.ImageLoader();
imageLoader.setCrossOrigin("anonymous");

type ImageSource = THREE.Source<unknown>;

let placeholder: HTMLCanvasElement | null = null;

/** White 1×1 image shown until the real image is loaded (the material's own color shows). */
function placeholderImage(): HTMLCanvasElement | null {
  if (placeholder) return placeholder;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 1, 1);
  placeholder = canvas;
  return placeholder;
}

function loadSource(url: string): Promise<ImageSource> {
  let p = pending.get(url);
  if (!p) {
    p = imageLoader.loadAsync(url).then((image) => {
      const source = new THREE.Source(image);
      loaded.set(url, source);
      return source;
    });
    p.catch(() => pending.delete(url));
    pending.set(url, p);
  }
  return p;
}

/**
 * A texture of the image at `url`. An image loaded before is used right away (sharing it
 * with the other textures of that image); otherwise a white placeholder is shown and
 * `onLoad` is called when the image is there. Each call returns its own texture (repeat,
 * rotation).
 */
export function cachedTexture(url: string, onLoad?: () => void): THREE.Texture {
  const known = loaded.get(url);
  if (known) {
    const tex = new THREE.Texture();
    tex.source = known;
    tex.needsUpdate = true;
    return tex;
  }
  // The texture keeps its own source: three.js must not see the source of an uploaded
  // texture change, only its image
  const temp = placeholderImage();
  const tex: THREE.Texture = new THREE.Texture(temp ?? undefined);
  if (temp) tex.needsUpdate = true;
  tex.userData.pending = true;
  loadSource(url)
    .then((source) => {
      // The GPU memory of an uploaded texture keeps the size of its first image (the 1×1
      // placeholder): free it, so that the real image is uploaded at its own size
      tex.dispose();
      tex.image = source.data;
      tex.needsUpdate = true;
      onLoad?.();
    })
    .catch(() => {
      // Missing image: the placeholder stays, like an untextured surface
    })
    .finally(() => {
      tex.userData.pending = false;
    });
  return tex;
}
/** Whether the image of a texture of `cachedTexture` is still loading. */
export function texturePending(tex: THREE.Texture): boolean {
  return tex.userData.pending === true;
}

/** Forgets the loaded images (call when a home is closed). */
export function clearTextureCache(): void {
  loaded.clear();
  pending.clear();
}

/**
 * A copy of `geometry` with texture coordinates in centimeters for a model without them,
 * like a box projection: each triangle takes the two axes across its normal (front and
 * back: x and height, sides: depth and height, top and bottom: x and depth). `matrix`
 * transforms the geometry to the real size of the piece in centimeters.
 */
export function boxProjectedUvs(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = g.getAttribute("position");
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  for (let i = 0; i + 2 < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i).applyMatrix4(matrix);
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(matrix);
    c.fromBufferAttribute(pos, i + 2).applyMatrix4(matrix);
    n.subVectors(b, a).cross(e.subVectors(c, a));
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    [a, b, c].forEach((p, k) => {
      const j = (i + k) * 2;
      if (az >= ax && az >= ay) {
        uv[j] = p.x;
        uv[j + 1] = p.y;
      } else if (ax >= ay) {
        uv[j] = p.z;
        uv[j + 1] = p.y;
      } else {
        uv[j] = p.x;
        uv[j + 1] = p.z;
      }
    });
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return g;
}
