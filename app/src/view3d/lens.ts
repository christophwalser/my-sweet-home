// Lenses of photos besides the normal one: fisheye (180°, circular, equidistant) and
// spherical (360° × 180° panorama, view direction in the middle).
//
// Both start from a panorama in the convention of three-gpu-pathtracer's EquirectCamera
// (camera space: the middle of the image looks along +x, the top row up). Path tracing
// renders it directly; drafts render a cube map and convert it. A last pass turns the
// panorama into the photo of the lens.

import * as THREE from "three";

export type Lens = "normal" | "pinhole" | "fisheye" | "spherical";

/** True for the lenses that need a panorama first. */
export function isWideLens(lens: Lens | undefined): lens is "fisheye" | "spherical" {
  return lens === "fisheye" || lens === "spherical";
}

/** Size of the panorama for a photo of `width` × `height` pixels. */
export function panoramaSize(lens: "fisheye" | "spherical", width: number, height: number) {
  const h = lens === "spherical" ? height : Math.max(width, height);
  const he = Math.min(4096, Math.max(256, Math.round(h)));
  return { width: he * 2, height: he };
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** GLSL: direction of a panorama pixel in camera space (EquirectCamera convention). */
const PANORAMA_DIRECTION = /* glsl */ `
  const float PI = 3.141592653589793;
  vec3 panoramaDirection(vec2 uv) {
    float theta = (uv.x - 0.5) * 2.0 * PI;
    float phi = (1.0 - uv.y) * PI;
    return vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
  }
  vec2 panoramaUv(vec3 d) {
    return vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, 1.0 - acos(clamp(d.y, -1.0, 1.0)) / PI);
  }
`;

function fullScreenPass(material: THREE.ShaderMaterial): {
  scene: THREE.Scene;
  camera: THREE.Camera;
} {
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  return { scene, camera: new THREE.Camera() };
}

/**
 * Renders the panorama of a draft photo onto the renderer's canvas: a cube map taken at
 * the camera position, looked up for each pixel in the camera's orientation.
 */
export function renderDraftPanorama(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  size: { width: number; height: number },
): void {
  const faceSize = Math.min(2048, THREE.MathUtils.ceilPowerOfTwo(Math.round(size.height)));
  const target = new THREE.WebGLCubeRenderTarget(faceSize, { type: THREE.HalfFloatType });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  const cubeCamera = new THREE.CubeCamera(camera.near, camera.far, target);
  cubeCamera.position.copy(camera.position);
  cubeCamera.updateMatrixWorld(true);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      uniform samplerCube cube;
      uniform mat3 orientation;
      varying vec2 vUv;
      ${PANORAMA_DIRECTION}
      void main() {
        vec3 d = orientation * panoramaDirection(vUv);
        gl_FragColor = textureCube(cube, d);
        #include <colorspace_fragment>
      }
    `,
    uniforms: {
      cube: { value: target.texture },
      orientation: { value: new THREE.Matrix3().setFromMatrix4(camera.matrixWorld) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const pass = fullScreenPass(material);
  try {
    // The cube faces keep linear colors; the output pass converts to sRGB
    const outputColorSpace = renderer.outputColorSpace;
    cubeCamera.update(renderer, scene);
    renderer.outputColorSpace = outputColorSpace;
    renderer.setRenderTarget(null);
    renderer.render(pass.scene, pass.camera);
  } finally {
    target.dispose();
    material.dispose();
  }
}

/** Turns a panorama (canvas) into the photo of the lens; returns a PNG data URL. */
export function panoramaToLens(
  panorama: HTMLCanvasElement,
  lens: "fisheye" | "spherical",
  width: number,
  height: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  // The panorama already holds display colors: copy them unchanged
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const texture = new THREE.CanvasTexture(panorama);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: /* glsl */ `
      uniform sampler2D panorama;
      uniform int fisheye;
      uniform float aspect;
      varying vec2 vUv;
      ${PANORAMA_DIRECTION}
      void main() {
        vec3 d;
        if (fisheye == 1) {
          // Equidistant: the distance from the middle is the angle to the view direction
          vec2 p = (vUv - 0.5) * 2.0;
          if (aspect > 1.0) p.x *= aspect; else p.y /= aspect;
          float r = length(p);
          if (r > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
          float angle = r * PI / 2.0;
          vec2 dir = r > 0.0 ? p / r : vec2(0.0);
          // Camera space: right +x, up +y, forward -z
          d = vec3(sin(angle) * dir.x, sin(angle) * dir.y, -cos(angle));
        } else {
          // View direction in the middle, the full turn across the width
          float lon = (vUv.x - 0.5) * 2.0 * PI;
          float lat = (vUv.y - 0.5) * PI;
          d = vec3(sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat));
        }
        gl_FragColor = texture2D(panorama, panoramaUv(d));
      }
    `,
    uniforms: {
      panorama: { value: texture },
      fisheye: { value: lens === "fisheye" ? 1 : 0 },
      aspect: { value: width / height },
    },
    depthTest: false,
    depthWrite: false,
  });
  const pass = fullScreenPass(material);
  try {
    renderer.render(pass.scene, pass.camera);
    return canvas.toDataURL("image/png");
  } finally {
    texture.dispose();
    material.dispose();
    renderer.dispose();
  }
}
