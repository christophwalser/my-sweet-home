// Photo rendering of the 3D view, like Sweet Home 3D's "Create photo":
// - "draft": rasterized at the photo size with sun shadows (seconds),
// - "good" / "best": path traced on the GPU with three-gpu-pathtracer (soft shadows,
//   indirect light, glass), with more samples for "best".
// The photo uses its own renderer and canvas, so the 3D view stays usable.

import * as THREE from "three";
import { GradientEquirectTexture, WebGLPathTracer } from "three-gpu-pathtracer";

export type PhotoQuality = "draft" | "good" | "best";

/** Path tracing samples per pixel of each quality. */
export const PHOTO_SAMPLES: Record<Exclude<PhotoQuality, "draft">, number> = {
  good: 256,
  best: 1024,
};

export interface PhotoSource {
  scene: THREE.Scene;
  /** Groups of the scene: rendered content and lamps */
  content: THREE.Object3D;
  lamps: THREE.Object3D;
  sun: THREE.DirectionalLight;
  sky: THREE.Object3D | null;
  camera: THREE.PerspectiveCamera;
  /** Horizontal field of view in radians (kept for any photo aspect ratio) */
  hfov: number;
  /** Ground color for the light from below in path tracing */
  groundColor: THREE.Color;
}

export interface PhotoOptions {
  width: number;
  height: number;
  quality: PhotoQuality;
  /** Called with the progress (0..1) after each pass */
  onProgress?: (progress: number) => void;
}

export interface PhotoJob {
  /** Canvas the photo is rendered on (shown as preview while it renders) */
  canvas: HTMLCanvasElement;
  /** PNG data URL of the finished photo */
  done: Promise<string>;
  /** Stops path tracing; `done` then resolves with the samples rendered so far */
  finish: () => void;
  /** Stops rendering; `done` rejects */
  cancel: () => void;
}

/** Groups of the 3D view's content that do not belong in a photo. */
const LEFT_OUT = new Set(["annotations"]);

/** WebGL renderer on its own canvas; the drawing buffer is kept so it can be read. */
export function offscreenRenderer(width: number, height: number): THREE.WebGLRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/** Copy of the view's camera for an image of the given size (same horizontal field of view). */
export function photoCamera(
  src: PhotoSource,
  width: number,
  height: number,
): THREE.PerspectiveCamera {
  const camera = src.camera.clone();
  camera.aspect = width / height;
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(src.hfov / 2) / camera.aspect));
  camera.updateProjectionMatrix();
  return camera;
}

/** Path tracer that renders straight to the renderer's canvas, in tiles for large images. */
export function createPathTracer(
  renderer: THREE.WebGLRenderer,
  width: number,
  height: number,
  bounces: number,
): WebGLPathTracer {
  const tracer = new WebGLPathTracer(renderer);
  tracer.renderToCanvas = true;
  tracer.minSamples = 0;
  tracer.renderDelay = 0;
  tracer.fadeDuration = 0;
  tracer.dynamicLowRes = false;
  tracer.bounces = bounces;
  tracer.filterGlossyFactor = 0.5;
  tracer.multipleImportanceSampling = true;
  // Tiles keep each GPU pass short, so the window stays responsive
  const tiles = Math.max(1, Math.ceil((width * height) / (1024 * 768)));
  tracer.tiles.set(tiles, tiles);
  return tracer;
}

export function renderPhoto(src: PhotoSource, opts: PhotoOptions): PhotoJob {
  const renderer = offscreenRenderer(opts.width, opts.height);
  const canvas = renderer.domElement;
  const camera = photoCamera(src, opts.width, opts.height);

  let stopped = false;
  let finishEarly = false;
  let rejectJob: (e: Error) => void = () => {};
  const cleanups: (() => void)[] = [() => renderer.dispose()];
  const cleanup = () => {
    for (const c of cleanups.splice(0)) c();
  };

  const done = new Promise<string>((resolve, reject) => {
    rejectJob = reject;
    const finishWith = () => {
      const url = canvas.toDataURL("image/png");
      cleanup();
      resolve(url);
    };
    try {
      if (opts.quality === "draft") {
        renderDraft(src, renderer, camera);
        opts.onProgress?.(1);
        finishWith();
        return;
      }
      const target = PHOTO_SAMPLES[opts.quality];
      const { scene, dispose } = pathTracingScene(src, camera);
      cleanups.push(dispose);
      const tracer = createPathTracer(
        renderer,
        opts.width,
        opts.height,
        opts.quality === "best" ? 8 : 5,
      );
      cleanups.unshift(() => tracer.dispose());
      // Builds the BVH of the scene; synchronous (no BVH worker), so let the dialog paint first
      setTimeout(() => {
        try {
          if (stopped) return;
          tracer.setScene(scene, camera);
        } catch (e) {
          cleanup();
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        const step = () => {
          if (stopped) return;
          try {
            tracer.renderSample();
          } catch (e) {
            cleanup();
            reject(e instanceof Error ? e : new Error(String(e)));
            return;
          }
          const progress = Math.min(1, tracer.samples / target);
          opts.onProgress?.(progress);
          if (progress >= 1 || finishEarly) finishWith();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }, 50);
    } catch (e) {
      cleanup();
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });

  return {
    canvas,
    done,
    finish: () => {
      finishEarly = true;
    },
    cancel: () => {
      if (stopped) return;
      stopped = true;
      cleanup();
      rejectJob(new Error("cancelled"));
    },
  };
}

/** Rasterized photo with sun shadows, using the scene of the 3D view. */
export function renderDraft(
  src: PhotoSource,
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const castShadow = src.sun.castShadow;
  const skyPosition = src.sky?.position.clone();
  const hidden = hideLeftOut(src.content);
  src.sun.castShadow = true;
  src.sky?.position.copy(camera.position);
  try {
    renderer.render(src.scene, camera);
  } finally {
    src.sun.castShadow = castShadow;
    if (skyPosition) src.sky?.position.copy(skyPosition);
    for (const o of hidden) o.visible = true;
  }
}

function hideLeftOut(content: THREE.Object3D): THREE.Object3D[] {
  const hidden: THREE.Object3D[] = [];
  for (const child of content.children) {
    if (LEFT_OUT.has(child.name) && child.visible) {
      child.visible = false;
      hidden.push(child);
    }
  }
  return hidden;
}

/**
 * Copy of the scene for path tracing: physical materials instead of the 3D view's
 * Lambert / Phong ones, the sky as environment light instead of the sky dome and the
 * hemisphere light, labels and dimensions left out. Geometry and textures are shared.
 */
export function pathTracingScene(
  src: PhotoSource,
  camera: THREE.PerspectiveCamera,
): { scene: THREE.Scene; dispose: () => void } {
  const scene = new THREE.Scene();
  const sky =
    src.scene.background instanceof THREE.Color
      ? src.scene.background.clone()
      : new THREE.Color(0xcce4fc);
  const environment = new GradientEquirectTexture(64);
  environment.topColor.copy(sky);
  environment.bottomColor.copy(src.groundColor);
  environment.update();
  scene.environment = environment;
  // Same brightness as the hemisphere light of the 3D view
  scene.environmentIntensity = 1.6;
  scene.background = sky;

  const converted = new Map<string, THREE.Material>();
  const splitGeometries: THREE.BufferGeometry[] = [];
  const convert = (m: THREE.Material): THREE.Material => {
    let p = converted.get(m.uuid);
    if (!p) {
      p = physicalMaterial(m);
      converted.set(m.uuid, p);
    }
    return p;
  };

  for (const child of src.content.children) {
    if (LEFT_OUT.has(child.name) || child === src.sky || !child.visible) continue;
    if ((child as THREE.Light).isLight) continue;
    const copy = child.clone();
    // Hidden objects (ceilings in the aerial view, hidden levels) would shift the material
    // indices of the path tracer's merged geometry: leave them out
    const hidden: THREE.Object3D[] = [];
    copy.traverse((o) => {
      if (!o.visible) hidden.push(o);
    });
    for (const o of hidden) o.removeFromParent();
    const meshes: THREE.Mesh[] = [];
    copy.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
        convert,
      );
      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (geometry.groups.length === 0) {
        mesh.material = materials[0];
        continue;
      }
      // The path tracer supports one material per mesh: one mesh per geometry group
      for (const part of splitByGroups(mesh, geometry, materials)) {
        mesh.parent?.add(part);
        splitGeometries.push(part.geometry);
      }
      mesh.removeFromParent();
    }
    scene.add(copy);
  }
  scene.add(src.lamps.clone());
  const sun = src.sun.clone();
  sun.castShadow = false;
  const target = new THREE.Object3D();
  target.position.copy(src.sun.target.position);
  sun.target = target;
  scene.add(sun, target);
  scene.add(camera);
  scene.updateMatrixWorld(true);

  return {
    scene,
    dispose: () => {
      environment.dispose();
      for (const m of converted.values()) m.dispose();
      // Only the index buffers are new: the attributes belong to the 3D view
      for (const g of splitGeometries) g.dispose();
    },
  };
}

/**
 * Meshes for the groups of a geometry, each with its own material. They share the
 * vertex attributes; only the index of each group is new.
 */
function splitByGroups(
  mesh: THREE.Mesh,
  geometry: THREE.BufferGeometry,
  materials: THREE.Material[],
): THREE.Mesh[] {
  const index = geometry.getIndex();
  const total = index ? index.count : geometry.getAttribute("position").count;
  const parts: THREE.Mesh[] = [];
  for (const group of geometry.groups) {
    const start = group.start;
    const end = Math.min(total, start + (Number.isFinite(group.count) ? group.count : total));
    if (end <= start) continue;
    const ids = new Uint32Array(end - start);
    for (let i = start; i < end; i++) ids[i - start] = index ? index.getX(i) : i;
    const part = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(geometry.attributes)) part.setAttribute(name, attr);
    part.setIndex(new THREE.BufferAttribute(ids, 1));
    const material = materials[group.materialIndex ?? 0] ?? materials[materials.length - 1];
    const m = new THREE.Mesh(part, material);
    m.name = mesh.name;
    m.position.copy(mesh.position);
    m.quaternion.copy(mesh.quaternion);
    m.scale.copy(mesh.scale);
    if (!mesh.matrixAutoUpdate) {
      m.matrixAutoUpdate = false;
      m.matrix.copy(mesh.matrix);
    }
    parts.push(m);
  }
  return parts;
}

/** Physical material that looks like a material of the 3D view under path tracing. */
function physicalMaterial(m: THREE.Material): THREE.Material {
  const src = m as THREE.MeshPhongMaterial & THREE.MeshLambertMaterial;
  const p = new THREE.MeshPhysicalMaterial({
    color: src.color ? src.color.clone() : new THREE.Color(1, 1, 1),
    map: src.map ?? null,
    side: m.side,
    metalness: 0,
  });
  if (src.emissive) p.emissive.copy(src.emissive);
  if (src.emissiveMap) p.emissiveMap = src.emissiveMap;
  // Phong shininess (0..~128) becomes roughness; Lambert surfaces are matt
  const shininess = typeof src.shininess === "number" ? src.shininess : 0;
  p.roughness = 1 - Math.sqrt(Math.min(1, shininess / 128)) * 0.85;
  if (m.transparent && m.opacity < 0.95 && !src.map) {
    // Window glass and other see-through materials: transmissive instead of faded
    p.transmission = Math.min(1, 1 - m.opacity + 0.3);
    p.roughness = 0.03;
    p.ior = 1.5;
    p.thickness = 0;
  } else if (m.transparent) {
    // Cut-out textures (plants, curtains): keep the alpha channel
    p.transparent = true;
    p.opacity = m.opacity;
    p.alphaTest = m.alphaTest;
  }
  return p;
}
