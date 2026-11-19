// 3D view: WebGL renderer that only redraws when something changes.

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  api,
  CAPTURE_EVENT,
  EXPORT_OBJ_EVENT,
  RENDER_PHOTO_EVENT,
  RENDER_VIDEO_EVENT,
} from "../api";
import { t } from "../i18n";
import { VIEW3D_PREFIX } from "../layout/view3dWindow";
import { forEachPiece, type Home, type Piece } from "../model";
import { perfMark, perfOn, perfScene } from "../perfMarks";
import { usePreferences } from "../preferences";
import { poseParams, useStore, type ViewMode } from "../store";
import Icon from "../ui/Icon";
import { useUi } from "../ui/uiStore";
import { buildAnnotations } from "./annotations";
import {
  buildGround,
  buildRooms,
  buildSky,
  buildWalls,
  levelInfos,
  lightColor,
  skyColor,
  visibleLevels,
  WallGeometryCache,
} from "./buildScene";
import { applyPose, type CameraPose, cameraDirection, cameraPose, verticalFov } from "./camera";
import type { Lens } from "./lens";
import {
  buildCeilingLights,
  buildLampLights,
  LAMP_SHADOWS,
  lampLights,
  MAX_LAMP_LIGHTS,
  MAX_PHOTO_LIGHTS,
  refreshLampShadows,
  visitLampLevels,
} from "./lights";
import { clearModelCache, createPieceObject, disposeObject, waitForModels } from "./models";
import { buildObj } from "./objExport";
import PhotoDialog from "./PhotoDialog";
import { type PhotoJob, type PhotoQuality, type PhotoSource, renderPhoto } from "./photo";
import { buildPivotMarker, drawn, fittedView, homeBox, orbitDistance, pickPoint } from "./pivot";
import {
  clickSelection,
  clipMaterials,
  elementOf,
  isGround,
  keptBy,
  levelOfElement,
  type SceneElement,
  SelectionOutline,
  setSectionPlanes,
  topIds,
} from "./select3d";
import {
  northOnScreen,
  parallelHalfHeight,
  perspectiveDistance,
  type StandardView,
  viewDirection,
} from "./standardViews";
import { stepSurfaces } from "./stepSurfaces";
import VideoDialog from "./VideoDialog";
import View3DSettings from "./View3DSettings";
import ViewpointsMenu from "./ViewpointsMenu";
import {
  type CameraPathInfo,
  type CameraPoint,
  even,
  fromDegrees,
  renderVideo,
  type VideoJob,
  type VideoQuality,
} from "./video";
import { registerView3D, runViewAction } from "./view3dBridge";
import { buildColliders, EYE_HEIGHT, levelOfEye, VisitorControls } from "./visitor";

/**
 * Highest pitch used for the aerial view. A camera looking straight down sits on
 * the pole of OrbitControls, where the yaw is lost and tilting feels stuck.
 */
const MAX_AERIAL_PITCH = Math.PI / 2 - 0.05;
/** Direction towards the sun until its position is known (`sun_get`). */
const DEFAULT_SUN_DIRECTION = new THREE.Vector3(-1000, 2500, 1500).normalize();
/** Light color of Sweet Home 3D's default homes: 100 % brightness. */
const DEFAULT_LIGHT_GRAY = 0xd0;
/** Intensity of the sun and of the ambient light at 100 % brightness. */
const SUN_INTENSITY = 1.4;
const AMBIENT_INTENSITY = 1.6;
/** Distance of the camera of the parallel projection from the point the view turns around. */
const PARALLEL_DISTANCE = 100000;
/** A press that moves less than this many pixels is a click. */
const CLICK_SLOP = 4;
/** Size of the pictures of the points of view in their menu. */
const THUMBNAIL_WIDTH = 160;
const THUMBNAIL_HEIGHT = 100;

/** Sun of the home as returned by `sun_get`. */
export type SunInfo = {
  latitude: number;
  longitude: number;
  location_set: boolean;
  time_zone: string;
  follow_clock: boolean;
  date: string;
  time: string;
  azimuth: number;
  elevation: number;
  /** Towards the sun in plan coordinates (x right, y down, z up) */
  direction: [number, number, number];
};

/** Brightness factor of the home's light color (1 at Sweet Home 3D's default). */
function brightness(home: Home): number {
  const c = home.environment?.attrs.light_color;
  return c == null ? 1 : ((c >> 8) & 0xff) / DEFAULT_LIGHT_GRAY;
}

/** How much of the sun reaches the ground: 0 below the horizon, 1 from 10° up. */
function daylight(elevation: number): number {
  const t = THREE.MathUtils.clamp((elevation + 1) / 11, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Lens of the active camera of the home (photo settings). */
function homeLens(): Lens {
  const home = useStore.getState().opened?.home;
  const role = home?.attrs.camera === "observerCamera" ? "observerCamera" : "topCamera";
  const lens = home?.cameras.find((c) => c.attrs.role === role)?.attrs.lens?.toLowerCase();
  return lens === "fisheye" || lens === "spherical" || lens === "normal" ? lens : "pinhole";
}

/** Resolution of the 3D view relative to CSS pixels for a quality preference. */
function pixelRatio(quality: "low" | "medium" | "high"): number {
  const dpr = window.devicePixelRatio;
  return quality === "low" ? 1 : quality === "medium" ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
}

/** Anisotropic filtering of textures for a quality preference (up to what the GPU can). */
function anisotropy(quality: "low" | "medium" | "high", max: number): number {
  return Math.max(1, Math.min(max, quality === "low" ? 2 : quality === "medium" ? 8 : 16));
}

/** Size of the sun's shadow map for a quality preference. */
const SHADOW_MAP_SIZE = { low: 1024, medium: 2048, high: 4096 } as const;

/**
 * Shadow maps are drawn for the sun (when its shadows are on) and for the lamps nearest to
 * the visitor. Materials compiled without shadow support are rebuilt when this changes (new
 * materials of a rebuilt scene are compiled for the current state anyway).
 */
function syncShadowMap(c: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  lamps: THREE.Group;
}): void {
  let lampShadows = false;
  c.lamps.traverse((o) => {
    if ((o as THREE.Light).isLight && o.castShadow) lampShadows = true;
  });
  const enabled = c.sun.castShadow || lampShadows;
  if (c.renderer.shadowMap.enabled === enabled) return;
  c.renderer.shadowMap.enabled = enabled;
  c.scene.traverse((o) => {
    const mats = (o as THREE.Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) m.needsUpdate = true;
  });
}

/** The view is shown in the separate 3D window (which has no tool bar). */
const IN_OWN_WINDOW = getCurrentWebviewWindow().label.startsWith(VIEW3D_PREFIX);

export default function View3D() {
  const opened = useStore((s) => s.opened);
  const levelId = useStore((s) => s.selectedLevel);
  const viewMode = useStore((s) => s.viewMode);
  const shadows = useUi((s) => s.shadows);
  const parallel = useUi((s) => s.parallel);
  const section = useUi((s) => s.section);
  const selection = useStore((s) => s.selection);
  const quality = usePreferences((s) => s.quality3d);
  const dialog = useUi((s) => s.dialog);
  const openDialog = useUi((s) => s.openDialog);
  const closeDialog = useUi((s) => s.closeDialog);
  const photoOpen = dialog === "photo";
  const videoOpen = dialog === "video";
  const settingsOpen = dialog === "settings3d";
  const containerRef = useRef<HTMLDivElement>(null);
  const pivotRef = useRef<HTMLDivElement>(null);
  const northRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    visitor: VisitorControls;
    content: THREE.Group;
    lamps: THREE.Group;
    sun: THREE.DirectionalLight;
    sky: THREE.Object3D | null;
    hfov: number;
    requestRender: () => void;
    /** Wall geometries kept from one rebuild to the next */
    walls: WallGeometryCache;
    /** Replaced content, freed after the next frame (see `retire`) */
    trash: THREE.Object3D[];
    /** Objects of the furniture by piece ID, reused while the piece does not change */
    pieces: Map<string, { piece: Piece; base: number; object: THREE.Group }>;
    /** Parts of the scene (walls, rooms, ground, ...) with the inputs they were built from */
    parts: Map<string, { deps: unknown[]; object: THREE.Object3D | null }>;
    /** Inputs the colliders of the virtual visit were built from */
    colliderDeps: unknown[] | null;
    /** The next frame is drawn after the window showed the plan (see `requestRender`) */
    renderLater: boolean;
    /** Camera of the parallel projection (the aerial view only) */
    ortho: THREE.OrthographicCamera;
    /** The view is drawn in parallel projection */
    parallel: boolean;
    /** Camera the view is drawn with */
    view: () => THREE.PerspectiveCamera | THREE.OrthographicCamera;
    /** Places the aerial view: where the camera is and the point it turns around */
    place: (position: THREE.Vector3, target: THREE.Vector3) => void;
    setParallel: (on: boolean) => void;
    /** Outline of the selected elements */
    outline: SelectionOutline;
    /** Draws the outline of the selection anew */
    highlight: () => void;
    /** Small pictures of the scene seen from the given cameras (data URLs) */
    thumbnails: (poses: CameraPose[], width?: number, height?: number) => string[];
    /** Clipping planes of the section (horizontal, vertical) and whether they cut */
    sectionPlanes: [THREE.Plane, THREE.Plane];
    sectionOn: boolean;
    /** Materials carry the section planes */
    sectionApplied: boolean;
    /** New content waits for the section planes (see the render loop) */
    sectionDirty: boolean;
  } | null>(null);

  // Renderer, camera and controls live as long as the component
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(pixelRatio(usePreferences.getState().quality3d));
    // Textures seen at flat angles (floors, walls) stay sharp and do not flicker
    THREE.Texture.DEFAULT_ANISOTROPY = anisotropy(
      usePreferences.getState().quality3d,
      renderer.capabilities.getMaxAnisotropy(),
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Section planes are set on the materials of the home (not on the ground and the sky)
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 5, 200000);
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, PARALLEL_DISTANCE * 4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    // The wheel zooms towards the point under the pointer, and the view stops at the horizon
    controls.zoomToCursor = true;
    controls.maxPolarAngle = Math.PI / 2;
    const view = () => (state.parallel ? ortho : camera);
    const outline = new SelectionOutline();
    scene.add(outline.group);
    const visitor = new VisitorControls(camera, renderer.domElement);
    const content = new THREE.Group();
    const lamps = new THREE.Group();
    const sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
    sun.position.copy(DEFAULT_SUN_DIRECTION).multiplyScalar(3000);
    const shadowSize = SHADOW_MAP_SIZE[usePreferences.getState().quality3d];
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 1;
    scene.add(content, lamps, sun, sun.target);

    // The point the aerial view turns around is marked while the pointer is over the view
    let hover = false;
    let dragging = false;
    const placePivot = () => {
      const el = pivotRef.current;
      if (!el) return;
      let shown = false;
      if (controls.enabled && (hover || dragging)) {
        const p = controls.target.clone().project(view());
        if (p.z > -1 && p.z < 1) {
          const x = ((p.x + 1) / 2) * container.clientWidth;
          const y = ((1 - p.y) / 2) * container.clientHeight;
          el.style.transform = `translate(${x}px, ${y}px)`;
          shown = true;
        }
      }
      el.classList.toggle("shown", shown);
    };

    // In the scene the pivot gets a ring and a dashed line down to the ground, so its depth is
    // seen too. Only drawn by this render loop (photos and captures render without it).
    const pivotMarker = buildPivotMarker();
    scene.add(pivotMarker.group);

    const trash: THREE.Object3D[] = [];
    let frame = 0;
    const render = () => {
      frame = 0;
      const cam = view();
      // The sky dome stays centered on the viewer (a parallel view has no sky dome)
      if (state.sky) {
        state.sky.position.copy(cam.position);
        state.sky.visible = !state.parallel;
      }
      if (state.sectionDirty) {
        // New content (a rebuilt scene, a loaded model) gets the section planes
        state.sectionDirty = false;
        if (state.sectionOn || state.sectionApplied) {
          const planes = state.sectionOn ? state.sectionPlanes : null;
          for (const child of content.children) {
            if (child.name !== "ground" && child.name !== "sky") clipMaterials(child, planes);
          }
          state.sectionApplied = state.sectionOn;
        }
      }
      const marked = controls.enabled && (hover || dragging);
      if (marked) {
        // Size of a pixel of the screen at the pivot
        const pixel = state.parallel
          ? (ortho.top - ortho.bottom) / ortho.zoom / container.clientHeight
          : ((2 * Math.tan((camera.fov * Math.PI) / 360)) / container.clientHeight) *
            camera.position.distanceTo(controls.target);
        pivotMarker.place(controls.target, pixel);
      }
      pivotMarker.group.visible = marked;
      // The outline of the selection is drawn by this loop only (not in photos)
      outline.group.visible = !outline.empty;
      renderer.render(scene, cam);
      outline.group.visible = false;
      placeNorth();
      if (perfOn()) {
        // The graphics card works in the background: a performance run waits for it
        renderer.getContext().finish();
        perfMark("3d-render");
        const { render: r, memory: m } = renderer.info;
        perfScene({
          calls: r.calls,
          triangles: r.triangles,
          geometries: m.geometries,
          textures: m.textures,
        });
      }
      // The new content now uses the shader programs: freeing the replaced content's
      // materials no longer makes three.js compile them again
      for (const o of trash.splice(0)) disposeObject(o);
      pivotMarker.group.visible = false;
      placePivot();
    };
    const requestRender = () => {
      if (frame) return;
      if (state.renderLater) {
        // After a change of the home the plan is shown first: this frame belongs to it, the
        // 3D view (new data for the graphics card, a full render) follows in the next one
        state.renderLater = false;
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(render);
        });
      } else {
        frame = requestAnimationFrame(render);
      }
    };
    // The perspective camera follows the parallel one: points of view, photos and the
    // camera stored in the home use it
    const syncPerspective = () => {
      const dir = controls.target.clone().sub(ortho.position).normalize();
      const half = (ortho.top - ortho.bottom) / 2 / ortho.zoom;
      camera.position
        .copy(controls.target)
        .addScaledVector(dir, -perspectiveDistance(half, camera.fov));
      camera.quaternion.copy(ortho.quaternion);
      camera.updateMatrixWorld();
    };
    // The parallel camera shows what the perspective one shows at the pivot
    const syncParallel = () => {
      const offset = camera.position.clone().sub(controls.target);
      const distance = offset.length() || 1;
      const half = parallelHalfHeight(distance, camera.fov);
      ortho.top = half;
      ortho.bottom = -half;
      ortho.left = -half * camera.aspect;
      ortho.right = half * camera.aspect;
      ortho.zoom = 1;
      ortho.position.copy(controls.target).addScaledVector(offset, PARALLEL_DISTANCE / distance);
      ortho.quaternion.copy(camera.quaternion);
      ortho.updateProjectionMatrix();
    };
    const setParallel = (on: boolean) => {
      if (state.parallel === on) return;
      if (on) syncParallel();
      else syncPerspective();
      state.parallel = on;
      // The controls move whichever camera draws the view
      (controls as { object: THREE.Camera }).object = on ? ortho : camera;
      controls.update();
      requestRender();
    };
    const place = (position: THREE.Vector3, target: THREE.Vector3) => {
      camera.position.copy(position);
      controls.target.copy(target);
      // A stored view may look up from below its pivot: the limit at the horizon gives way
      const polar = new THREE.Spherical().setFromVector3(position.clone().sub(target)).phi;
      controls.maxPolarAngle = Math.max(Math.PI / 2, polar);
      camera.lookAt(target);
      if (state.parallel) syncParallel();
      controls.update();
      requestRender();
    };
    controls.addEventListener("change", () => {
      // The view does not dive below the ground
      if (controls.target.y < 0) {
        controls.object.position.y -= controls.target.y;
        controls.target.y = 0;
      }
      if (state.parallel) syncPerspective();
      requestRender();
    });
    controls.addEventListener("start", () => {
      dragging = true;
      requestRender();
    });
    controls.addEventListener("end", () => {
      dragging = false;
      requestRender();
    });
    const onEnter = () => {
      hover = true;
      requestRender();
    };
    const onLeave = () => {
      hover = false;
      requestRender();
    };
    renderer.domElement.addEventListener("pointerenter", onEnter);
    renderer.domElement.addEventListener("pointerleave", onLeave);

    // Double-click: the view turns around the point under the pointer from now on. The
    // camera moves along, so the view slides until the point is in the middle.
    let pivotAnimation = 0;
    const movePivot = (to: THREE.Vector3) => {
      cancelAnimationFrame(pivotAnimation);
      const from = controls.target.clone();
      const eye = controls.object.position.clone();
      const delta = to.clone().sub(from);
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 250);
        const eased = k * (2 - k);
        controls.target.copy(from).addScaledVector(delta, eased);
        controls.object.position.copy(eye).addScaledVector(delta, eased);
        controls.update();
        requestRender();
        if (k < 1) pivotAnimation = requestAnimationFrame(step);
      };
      pivotAnimation = requestAnimationFrame(step);
    };
    const onDoubleClick = (e: MouseEvent) => {
      if (!controls.enabled) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      const point = pickPoint(
        view(),
        ndc,
        content,
        state.sky,
        controls.target.y,
        state.sectionOn ? state.sectionPlanes : [],
      );
      if (!point) return;
      userMoved.current = true;
      movePivot(point);
    };
    renderer.domElement.addEventListener("dblclick", onDoubleClick);

    // Small pictures of points of view: drawn into a corner of the canvas and copied from
    // there before the view itself is drawn again, so they are never seen on the screen
    const thumbnails = (
      poses: CameraPose[],
      wanted = THUMBNAIL_WIDTH,
      wantedHeight = THUMBNAIL_HEIGHT,
    ): string[] => {
      const canvas = renderer.domElement;
      const ratio = renderer.getPixelRatio();
      // Not larger than the canvas, in the proportions asked for
      const fit = Math.min(1, canvas.width / ratio / wanted, canvas.height / ratio / wantedHeight);
      const width = Math.floor(wanted * fit);
      const height = Math.floor(wantedHeight * fit);
      if (width < 8 || height < 8) return poses.map(() => "");
      const out = document.createElement("canvas");
      out.width = width;
      out.height = height;
      const g = out.getContext("2d");
      if (!g) return poses.map(() => "");
      const eye = new THREE.PerspectiveCamera(45, width / height, 5, 200000);
      const full = renderer.getViewport(new THREE.Vector4());
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, width, height);
      renderer.setViewport(0, 0, width, height);
      const urls = poses.map((pose) => {
        applyPose(eye, pose);
        if (state.sky) {
          state.sky.position.copy(eye.position);
          state.sky.visible = true;
        }
        renderer.render(scene, eye);
        g.drawImage(
          canvas,
          0,
          canvas.height - height * ratio,
          width * ratio,
          height * ratio,
          0,
          0,
          width,
          height,
        );
        return out.toDataURL("image/jpeg", 0.8);
      });
      renderer.setScissorTest(false);
      renderer.setViewport(full);
      cancelAnimationFrame(frame);
      render();
      return urls;
    };

    // The north arrow turns with the view
    const placeNorth = () => {
      const el = northRef.current;
      if (!el) return;
      const m = view().matrixWorld.elements;
      const north = useStore.getState().opened?.home.compass?.attrs.north_direction ?? 0;
      const angle = northOnScreen(
        new THREE.Vector3(m[0], m[1], m[2]),
        new THREE.Vector3(m[4], m[5], m[6]),
        north,
      );
      el.style.transform = `rotate(${angle}rad)`;
    };

    // Outline of the selected elements: a box around furniture, the edges of walls and floors
    const highlight = () => {
      outline.clear();
      const { opened: current, selection: ids } = useStore.getState();
      if (!current || ids.length === 0) return;
      const selected = new Set(ids);
      const tops = topIds(current.home);
      for (const [id, p] of state.pieces) {
        if (!selected.has(tops.get(id)?.top ?? "")) continue;
        const a = p.piece.attrs;
        outline.addBox(p.object, a.width, a.height, a.depth);
      }
      for (const part of content.children) {
        if (part.name !== "walls" && part.name !== "rooms") continue;
        part.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const [kind, id] = mesh.name.split(":");
          if ((kind === "wall" || kind === "floor") && selected.has(id)) outline.addEdges(mesh);
        });
      }
    };

    // A click selects the element under the pointer (Ctrl or Shift adds or removes it), and a
    // selected piece of furniture is moved over the floor by dragging it
    const raycaster = new THREE.Raycaster();
    const pointerRay = (e: { clientX: number; clientY: number }) => {
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        ),
        view(),
      );
      return raycaster;
    };
    /** Nearest element under the pointer; `element` is null on the ground. */
    const hitAt = (e: {
      clientX: number;
      clientY: number;
    }): { element: SceneElement | null; point: THREE.Vector3 } | null => {
      const planes = state.sectionOn ? state.sectionPlanes : [];
      for (const h of pointerRay(e).intersectObject(content, true)) {
        if (!drawn(h.object, state.sky) || !keptBy(planes, h.point)) continue;
        if (isGround(h.object)) return { element: null, point: h.point };
        const element = elementOf(h.object);
        if (element) return { element, point: h.point };
      }
      return null;
    };
    let press: { x: number; y: number } | null = null;
    let drag: {
      ids: string[];
      objects: { object: THREE.Object3D; start: THREE.Vector3 }[];
      plane: THREE.Plane;
      origin: THREE.Vector3;
      delta: THREE.Vector3;
      moved: boolean;
    } | null = null;
    const dropDrag = (back: boolean) => {
      const d = drag;
      drag = null;
      if (!d || !back) return d;
      for (const o of d.objects) o.object.position.copy(o.start);
      highlight();
      requestRender();
      return d;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.target !== renderer.domElement) return;
      press = { x: e.clientX, y: e.clientY };
      const { opened: current, selection: ids } = useStore.getState();
      if (!current || ids.length === 0 || e.ctrlKey || e.shiftKey || e.altKey) return;
      const selected = new Set(ids);
      const tops = topIds(current.home);
      const moving = [...state.pieces].filter(([id]) => selected.has(tops.get(id)?.top ?? ""));
      if (moving.length === 0) return;
      // Only the selected furniture first (cheap), then whether it is what the pointer sees
      const ray = pointerRay(e);
      if (
        ray.intersectObjects(
          moving.map(([, p]) => p.object),
          true,
        ).length === 0
      ) {
        return;
      }
      const hit = hitAt(e);
      const top = hit?.element?.kind === "furniture" ? tops.get(hit.element.id)?.top : undefined;
      if (!hit || !top || !selected.has(top)) return;
      // The view does not turn while furniture is dragged
      e.stopPropagation();
      renderer.domElement.focus();
      drag = {
        ids: [...new Set(moving.map(([id]) => tops.get(id)?.top ?? id))],
        objects: moving.map(([, p]) => ({ object: p.object, start: p.object.position.clone() })),
        plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y),
        origin: hit.point.clone(),
        delta: new THREE.Vector3(),
        moved: false,
      };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || !press) return;
      if (!drag.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < CLICK_SLOP) return;
      const p = pointerRay(e).ray.intersectPlane(drag.plane, new THREE.Vector3());
      // Near the horizon the floor under the pointer is endlessly far away
      if (!p || p.distanceTo(drag.origin) > 20000) return;
      drag.moved = true;
      drag.delta.subVectors(p, drag.origin).setY(0);
      for (const o of drag.objects) o.object.position.copy(o.start).add(drag.delta);
      highlight();
      requestRender();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const pressed = press;
      press = null;
      const d = dropDrag(false);
      if (d?.moved) {
        void useStore
          .getState()
          .run("edit_move", { ids: d.ids, dx: d.delta.x, dy: d.delta.z })
          .then((result) => {
            // Not moved (e.g. the furniture is locked): back to where it was
            if (result !== undefined) return;
            for (const o of d.objects) o.object.position.copy(o.start);
            highlight();
            requestRender();
          });
        return;
      }
      if (!pressed || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) >= CLICK_SLOP) {
        return;
      }
      const store = useStore.getState();
      const current = store.opened;
      if (!current) return;
      const element = hitAt(e)?.element ?? null;
      let id: string | null = null;
      let level: string | null | undefined;
      if (element?.kind === "furniture") {
        const top = topIds(current.home).get(element.id);
        id = top?.top ?? null;
        level = top?.level;
      } else if (element) {
        id = element.id;
        level = levelOfElement(current.home, element);
      }
      // The plan shows the level of the element, so that it is seen selected there too
      if (id && level != null && level !== store.selectedLevel) store.selectLevel(level);
      store.setSelection(clickSelection(store.selection, id, e.ctrlKey || e.shiftKey));
    };
    const onDragKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && drag) {
        e.stopPropagation();
        dropDrag(true);
      }
    };
    // Before the controls of the view see the press
    container.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onDragKey, true);

    // Keys of the aerial view: arrows turn, Shift + arrows move, + and - zoom
    const onKey = (e: KeyboardEvent) => {
      if (!controls.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const cam = controls.object;
      const offset = cam.position.clone().sub(controls.target);
      const turn = (theta: number, phi: number) => {
        const s = new THREE.Spherical().setFromVector3(offset);
        s.theta += theta;
        s.phi = THREE.MathUtils.clamp(s.phi + phi, 0.001, controls.maxPolarAngle);
        cam.position.copy(controls.target).add(offset.setFromSpherical(s));
      };
      // In shares of the height of the view
      const pan = (x: number, y: number) => {
        const height = state.parallel
          ? (ortho.top - ortho.bottom) / ortho.zoom
          : 2 * offset.length() * Math.tan((camera.fov * Math.PI) / 360);
        const m = cam.matrixWorld.elements;
        const move = new THREE.Vector3(m[0], m[1], m[2])
          .multiplyScalar(x * height)
          .add(new THREE.Vector3(m[4], m[5], m[6]).multiplyScalar(y * height));
        cam.position.add(move);
        controls.target.add(move);
      };
      const zoom = (factor: number) => {
        if (state.parallel) {
          ortho.zoom *= factor;
          ortho.updateProjectionMatrix();
        } else {
          cam.position.copy(controls.target).addScaledVector(offset, 1 / factor);
        }
      };
      const step = THREE.MathUtils.degToRad(5);
      if (e.key === "ArrowLeft") e.shiftKey ? pan(-0.1, 0) : turn(-step, 0);
      else if (e.key === "ArrowRight") e.shiftKey ? pan(0.1, 0) : turn(step, 0);
      else if (e.key === "ArrowUp") e.shiftKey ? pan(0, 0.1) : turn(0, -step);
      else if (e.key === "ArrowDown") e.shiftKey ? pan(0, -0.1) : turn(0, step);
      else if (e.key === "+" || e.key === "=") zoom(1.25);
      else if (e.key === "-") zoom(0.8);
      else return;
      e.preventDefault();
      e.stopPropagation();
      userMoved.current = true;
      controls.update();
      requestRender();
    };
    renderer.domElement.addEventListener("keydown", onKey);
    // Textures of model materials (MTL, Collada, 3DS) load after the model: redraw when
    // each of them arrives, otherwise they stay black until the next interaction
    const manager = THREE.DefaultLoadingManager;
    manager.onProgress = requestRender;
    manager.onLoad = requestRender;

    const state: NonNullable<typeof ctx.current> = {
      renderer,
      scene,
      camera,
      controls,
      visitor,
      content,
      lamps,
      sun,
      sky: null,
      hfov: Math.PI / 3,
      requestRender,
      walls: new WallGeometryCache(),
      trash,
      pieces: new Map(),
      parts: new Map(),
      colliderDeps: null,
      renderLater: false,
      ortho,
      parallel: false,
      view,
      place,
      setParallel,
      outline,
      highlight,
      thumbnails,
      sectionPlanes: [new THREE.Plane(), new THREE.Plane()],
      sectionOn: false,
      sectionApplied: false,
      sectionDirty: false,
    };
    ctx.current = state;
    visitor.onChange = (pose) => {
      state.hfov = pose.fov;
      requestRender();
      useStore.setState({ visitorPose: { ...pose } });
      onVisitorMoved.current(pose);
    };
    // Debug handle for inspecting the scene from the WebView devtools
    if (import.meta.env.DEV) (window as unknown as { __msh3d: typeof state }).__msh3d = state;

    const resize = () => {
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = verticalFov(state.hfov, camera.aspect);
      camera.updateProjectionMatrix();
      const half = (ortho.top - ortho.bottom) / 2;
      ortho.left = -half * camera.aspect;
      ortho.right = half * camera.aspect;
      ortho.updateProjectionMatrix();
      requestRender();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(pivotAnimation);
      renderer.domElement.removeEventListener("pointerenter", onEnter);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      renderer.domElement.removeEventListener("dblclick", onDoubleClick);
      renderer.domElement.removeEventListener("keydown", onKey);
      container.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onDragKey, true);
      scene.remove(outline.group);
      outline.dispose();
      controls.dispose();
      disposeObject(pivotMarker.group);
      visitor.dispose();
      disposeObject(content);
      disposeObject(lamps);
      for (const o of trash.splice(0)) disposeObject(o);
      state.walls.clear();
      clearModelCache();
      renderer.dispose();
      renderer.domElement.remove();
      ctx.current = null;
    };
  }, []);

  // Rebuild the scene when the home or the selected level changes
  const lastDocId = useRef<number | null>(null);
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    perfMark("3d-build-start");
    // Rebuilt for a change of the home: its frame is drawn after the plan was shown
    c.renderLater = lastDocId.current === (opened?.id ?? null);
    if (lastDocId.current !== (opened?.id ?? null)) {
      // Models of the previous home are no longer needed
      clearModelCache();
      c.walls.clear();
      c.pieces.clear();
      c.parts.clear();
      c.colliderDeps = null;
      lastDocId.current = opened?.id ?? null;
    }
    // Furniture that did not change keeps its object (the model is not cloned and its data is
    // not sent to the graphics card again). Unchanged pieces are the same objects as before,
    // see applyHome. They leave the old content first, so they are not freed with it.
    const kept = new Map<string, THREE.Group>();
    if (opened) {
      const levelsNow = levelInfos(opened.home);
      const shownNow = visibleLevels(opened.home, levelId);
      forEachPiece(opened.home.furniture, (p) => {
        const id = p.attrs.id;
        const cached = id ? c.pieces.get(id) : undefined;
        if (!id || !cached || cached.piece !== p || !shownNow.has(p.attrs.level)) return;
        const base = (levelsNow.get(p.attrs.level) ?? levelsNow.get(null))?.elevation ?? 0;
        if (cached.base !== base) return;
        cached.object.removeFromParent();
        kept.set(id, cached.object);
      });
    }
    c.pieces.clear();
    // Parts of the scene whose inputs did not change are kept as well: unchanged parts of the
    // home are the same objects as before, so comparing them with === is enough. Kept parts
    // leave the old content before that is freed.
    const parts: typeof c.parts = new Map();
    const reuse = <T extends THREE.Object3D | null>(
      name: string,
      deps: unknown[],
      build: () => T,
    ): T => {
      const cached = c.parts.get(name);
      if (
        cached &&
        cached.deps.length === deps.length &&
        cached.deps.every((d, i) => d === deps[i])
      ) {
        cached.object?.removeFromParent();
        parts.set(name, cached);
        return cached.object as T;
      }
      const object = build();
      parts.set(name, { deps, object });
      return object;
    };
    let built: {
      sky: THREE.Mesh | null;
      ground: THREE.Mesh;
      walls: THREE.Group;
      rooms: THREE.Group;
      annotations: THREE.Object3D;
    } | null = null;
    const doors: Piece[] = [];
    const stairs: Piece[] = [];
    const levels = opened ? levelInfos(opened.home) : null;
    const shown = opened ? visibleLevels(opened.home, levelId) : null;
    if (opened && levels && shown) {
      const h = opened.home;
      // Of the furniture only doors and windows (they cut the walls) and staircases (they
      // cut floors and ceilings) shape the building: moving a chair rebuilds none of it
      forEachPiece(h.furniture, (p) => {
        if (p.kind === "DoorOrWindow") doors.push(p);
        if (p.attrs.staircase_cut_out_shape) stairs.push(p);
      });
      // What decides which levels are shown and how high they are
      const base = [opened.id, levelId, h.levels, h.properties, h.environment, h.attrs];
      built = {
        sky: reuse("sky", [opened.id, h.environment], () => buildSky(opened, c.requestRender)),
        ground: reuse("ground", [opened.id, h.environment], () => {
          const ground = buildGround(opened, c.requestRender);
          ground.receiveShadow = true;
          return ground;
        }),
        walls: reuse("walls", [...base, h.walls, opened.wallShapes, ...doors], () => {
          const walls = buildWalls(opened, levels, shown, c.requestRender, c.walls);
          c.walls.commit();
          return walls;
        }),
        rooms: reuse("rooms", [...base, h.rooms, h.walls, ...stairs], () =>
          buildRooms(opened, levels, shown, c.requestRender),
        ),
        annotations: reuse("annotations", [...base, h.labels, h.dimension_lines, h.polylines], () =>
          buildAnnotations(h, levels, shown),
        ),
      };
    }
    c.parts = parts;
    // The replaced content is freed after the next frame, when the new content has taken
    // over its shader programs. Content that was never drawn (still waiting trash means no
    // frame since the last rebuild) holds no programs and is freed right away, so at most
    // one replaced scene waits.
    const retire = c.trash.length === 0;
    for (const child of [...c.content.children]) {
      c.content.remove(child);
      if (retire) c.trash.push(child);
      else disposeObject(child);
    }
    c.sky = null;
    if (!opened || !built || !levels || !shown) {
      c.scene.background = new THREE.Color(0x202326);
      c.requestRender();
      return;
    }
    const home = opened.home;
    c.scene.background = skyColor(home);

    const ambient = new THREE.HemisphereLight(0xffffff, lightColor(home), AMBIENT_INTENSITY);
    ambient.name = "ambient";
    c.content.add(ambient);

    c.sky = built.sky;
    if (c.sky) c.content.add(c.sky);
    c.content.add(built.ground);
    const { walls, rooms } = built;
    for (const g of [walls, rooms]) {
      g.traverse((o) => {
        // Ceilings would darken the whole interior in the aerial view
        o.castShadow = !o.name.startsWith("ceiling:");
        o.receiveShadow = true;
      });
    }
    c.content.add(walls, rooms, built.annotations);

    const furniture = new THREE.Group();
    furniture.name = "furniture";
    const stairObjects: THREE.Object3D[] = [];
    forEachPiece(home.furniture, (p) => {
      if (!shown.has(p.attrs.level)) return;
      const base = (levels.get(p.attrs.level) ?? levels.get(null))?.elevation ?? 0;
      const object =
        (p.attrs.id ? kept.get(p.attrs.id) : undefined) ??
        createPieceObject(p, opened.id, base, () => {
          // Loaded furniture also stops the light of lamps
          refreshLampShadows(c.lamps);
          c.sectionDirty = true;
          c.requestRender();
        });
      if (p.attrs.id) c.pieces.set(p.attrs.id, { piece: p, base, object });
      if (p.attrs.staircase_cut_out_shape && p.attrs.visible !== false) stairObjects.push(object);
      furniture.add(object);
    });
    c.content.add(furniture);
    // Walls and doors for the virtual visitor (all levels: the visitor may change level)
    const colliderDeps = [
      opened.id,
      home.walls,
      opened.wallShapes,
      home.levels,
      home.attrs,
      ...doors,
      ...stairs,
    ];
    const sameColliders =
      c.colliderDeps?.length === colliderDeps.length &&
      c.colliderDeps.every((d, i) => d === colliderDeps[i]);
    if (!sameColliders || !c.visitor.colliders) {
      c.visitor.colliders = buildColliders(
        home,
        opened.wallShapes,
        (level) => (levels.get(level) ?? levels.get(null))?.elevation ?? 0,
      );
      c.colliderDeps = colliderDeps;
    }
    c.visitor.colliders.stepSurfaces = (p) => stepSurfaces(stairObjects, p);
    c.sectionDirty = true;
    c.requestRender();
    perfMark("3d-build-end");
  }, [opened, levelId]);

  // The selection of the plan is outlined. Only the outline is drawn anew: selecting
  // rebuilds nothing of the scene.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the outline follows the rebuilt scene and the selection
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.highlight();
    c.requestRender();
  }, [selection, opened, levelId]);

  // Section planes: the home is cut open at a height and along a vertical plane
  // biome-ignore lint/correctness/useExhaustiveDependencies: the planes follow the bounds of the rebuilt scene
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.sectionOn = setSectionPlanes(c.sectionPlanes, section, homeBox(c.content));
    c.sectionDirty = true;
    c.requestRender();
  }, [section, opened, levelId]);

  // Parallel projection (the aerial view only). Before the camera is placed below: that
  // places the camera of the projection in use.
  useEffect(() => {
    ctx.current?.setParallel(parallel && viewMode !== "observer");
  }, [parallel, viewMode]);

  // Position of the sun from the location, date and time of the home (computed by the
  // core); it follows the clock if the home says so
  const [sun, setSun] = useState<SunInfo | null>(null);
  const homeId = opened?.id;
  const compass = opened?.home.compass;
  const homeProperties = opened?.home.properties;
  const cameras = opened?.home.cameras;
  const homeAttrs = opened?.home.attrs;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the sun depends on these parts of the home only
  useEffect(() => {
    if (!opened) {
      setSun(null);
      return;
    }
    let alive = true;
    const load = () => {
      api
        .execute("sun_get", {})
        .then((s) => {
          // The same position as before changes nothing (and draws nothing again)
          if (alive) {
            setSun((before) =>
              JSON.stringify(before) === JSON.stringify(s) ? before : (s as SunInfo),
            );
          }
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(() => {
      if (sunRef.current?.follow_clock) load();
    }, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // Asked again only when what the sun depends on changed (location and north of the
    // compass, date and time of the cameras, "follow the clock"): these parts of the home
    // keep their identity through all other changes (see applyHome)
  }, [homeId, compass, homeProperties, cameras, homeAttrs]);
  const sunRef = useRef<SunInfo | null>(null);
  sunRef.current = sun;

  // Sun study: while a slider of the settings is dragged the sun of that moment is shown
  // without changing the home; the stored sun takes over when it arrives
  const [sunPreview, setSunPreview] = useState<SunInfo | null>(null);
  const previewSeq = useRef(0);
  const previewSun = (at: string | null) => {
    const seq = ++previewSeq.current;
    if (!at) {
      setSunPreview(null);
      return;
    }
    api
      .execute("sun_get", { at })
      .then((s) => {
        if (previewSeq.current === seq) setSunPreview(s as SunInfo);
      })
      .catch(() => {});
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new sun of the home ends the preview
  useEffect(() => {
    previewSeq.current++;
    setSunPreview(null);
  }, [sun]);
  const shownSun = sunPreview ?? sun;

  // Light and transparency of the walls are shown while their sliders are dragged as well
  const [envPreview, setEnvPreview] = useState<{ light?: number; wallsAlpha?: number } | null>(
    null,
  );
  const environment = opened?.home.environment;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed environment of the home ends the preview
  useEffect(() => setEnvPreview(null), [environment]);
  const previewAlpha = envPreview?.wallsAlpha;
  useEffect(() => {
    const c = ctx.current;
    if (!c || previewAlpha === undefined) return;
    c.content.getObjectByName("walls")?.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        const transparent = previewAlpha > 0;
        if (m.transparent !== transparent) m.needsUpdate = true;
        m.transparent = transparent;
        m.opacity = 1 - previewAlpha;
      }
    });
    c.requestRender();
  }, [previewAlpha]);
  const previewLight = envPreview?.light;

  // Light of the sun and the sky: direction, daylight and the brightness of the home
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new level rebuilds the scene and its ambient light
  useEffect(() => {
    const c = ctx.current;
    if (!c || !opened) return;
    const sun = shownSun;
    const light = previewLight ?? brightness(opened.home);
    const day = sun ? daylight(sun.elevation) : 1;
    c.sun.intensity = SUN_INTENSITY * light * day;
    // Warmer light when the sun is low
    const warm = sun ? THREE.MathUtils.clamp(1 - (sun.elevation - 2) / 20, 0, 1) : 0;
    c.sun.color.setRGB(1, 1 - 0.22 * warm, 1 - 0.45 * warm);
    const ambient = c.content.getObjectByName("ambient") as THREE.HemisphereLight | undefined;
    // At night the interior stays visible, only darker
    if (ambient) ambient.intensity = AMBIENT_INTENSITY * light * (0.45 + 0.55 * day);
    // The sky darkens at night (also seen through windows and in photos)
    const skyLight = 0.12 + 0.88 * day;
    if (c.scene.background instanceof THREE.Color) {
      c.scene.background.copy(skyColor(opened.home)).multiplyScalar(skyLight);
    }
    const dome = c.sky as THREE.Mesh | null;
    const domeMaterial = dome?.material as THREE.MeshBasicMaterial | undefined;
    domeMaterial?.color.setScalar(skyLight);
    c.requestRender();
  }, [shownSun, previewLight, opened, levelId]);

  // Sun shadows (optional, they cost a second render pass)
  useEffect(() => {
    const c = ctx.current;
    if (!c || !opened || levelId === undefined) return;
    const sun = shownSun;
    const sunDirection = sun
      ? new THREE.Vector3(sun.direction[0], sun.direction[2], sun.direction[1]).normalize()
      : DEFAULT_SUN_DIRECTION;
    // Below the horizon there are no shadows (and the light is off)
    const castShadow = shadows && (!sun || sun.elevation > 0);
    c.sun.castShadow = castShadow;
    syncShadowMap(c);
    // Fit the shadow camera around the walls of the shown levels
    const walls = c.content.getObjectByName("walls");
    const box = walls ? new THREE.Box3().setFromObject(walls) : new THREE.Box3();
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-1000, 0, -1000), new THREE.Vector3(1000, 300, 1000));
    }
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(500, box.getSize(new THREE.Vector3()).length() / 2 + 200);
    c.sun.target.position.copy(center);
    c.sun.position.copy(center).addScaledVector(sunDirection, radius * 2);
    const cam = c.sun.shadow.camera;
    cam.left = -radius;
    cam.right = radius;
    cam.top = radius;
    cam.bottom = -radius;
    cam.near = radius * 0.5;
    cam.far = radius * 3.5;
    cam.updateProjectionMatrix();
    c.requestRender();
  }, [shadows, opened, levelId, shownSun]);

  // Quality of the preferences: resolution and shadow detail
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    c.renderer.setPixelRatio(pixelRatio(quality));
    // New textures get the filtering of the quality; the loaded ones are updated
    const level = anisotropy(quality, c.renderer.capabilities.getMaxAnisotropy());
    THREE.Texture.DEFAULT_ANISOTROPY = level;
    c.scene.traverse((o) => {
      const materials = (o as THREE.Mesh).material;
      for (const m of Array.isArray(materials) ? materials : materials ? [materials] : []) {
        const map = (m as THREE.MeshLambertMaterial).map;
        if (map && map.anisotropy !== level) {
          map.anisotropy = level;
          map.needsUpdate = true;
        }
      }
    });
    const size = SHADOW_MAP_SIZE[quality];
    if (c.sun.shadow.mapSize.x !== size) {
      c.sun.shadow.mapSize.set(size, size);
      c.sun.shadow.map?.dispose();
      c.sun.shadow.map = null;
    }
    const canvas = c.renderer.domElement;
    c.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    c.requestRender();
  }, [quality]);

  // Lamps light the virtual visit; only the ones nearest to the visitor are used
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    for (const child of [...c.lamps.children]) {
      c.lamps.remove(child);
      disposeObject(child);
    }
    if (opened && viewMode === "observer") {
      const home = opened.home;
      const observer = home.cameras.find((cam) => cam.attrs.role === "observerCamera");
      const pose = poses.current.observer ?? useStore.getState().visitorPose;
      const viewer = pose
        ? new THREE.Vector3(pose.x, pose.z, pose.y)
        : observer
          ? new THREE.Vector3(observer.attrs.x, observer.attrs.z, observer.attrs.y)
          : c.camera.position.clone();
      const lights = lampLights(
        home,
        levelInfos(home),
        visitLampLevels(home, levelId ?? null, visibleLevels(home, levelId)),
      );
      c.lamps.add(buildLampLights(lights, viewer, MAX_LAMP_LIGHTS, LAMP_SHADOWS));
    }
    syncShadowMap(c);
    c.requestRender();
  }, [opened, levelId, viewMode]);

  // Place the camera from the cameras stored in the home. This only happens when
  // another home is opened or the view mode changes, so live edits keep the view.
  // Homes without stored camera (e.g. built by an AI agent) are re-fitted after each
  // change until the user moves the camera.
  const userMoved = useRef(false);
  /** Views of both modes kept while the home is open, and the stored cameras last seen */
  const poses = useRef<{
    home: number | null;
    observer: CameraPose | null;
    aerial: { pose: CameraPose; target: THREE.Vector3 } | null;
    seen: Record<string, string>;
    moves: number;
  }>({ home: null, observer: null, aerial: null, seen: {}, moves: 0 });
  const modeRef = useRef<ViewMode | null>(null);
  /** Level the visitor was on, to move it along when another level is selected */
  const lastLevel = useRef<string | null | undefined>(undefined);
  /** Selects the level the visitor reached by stairs (without moving it again) */
  const onVisitorMoved = useRef<(pose: CameraPose) => void>(() => {});
  onVisitorMoved.current = (pose) => {
    const { opened: current, selectedLevel } = useStore.getState();
    if (!current || current.home.levels.length < 2) return;
    // On a staircase the level it leads to is shown already (not the sky through the hole)
    const stairTop = ctx.current?.visitor.stairTop ?? null;
    const ahead =
      stairTop === null
        ? null
        : current.home.levels.find((l) => Math.abs(l.attrs.elevation - stairTop) < 1)?.attrs.id;
    const level = ahead ?? levelOfEye(current.home, pose.z);
    if (level && level !== selectedLevel) {
      lastLevel.current = level;
      useStore.getState().selectLevel(level);
    }
  };
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const onStart = () => {
      userMoved.current = true;
    };
    c.controls.addEventListener("start", onStart);
    return () => c.controls.removeEventListener("start", onStart);
  }, []);
  useEffect(() => {
    const c = ctx.current;
    if (!c || !opened) return;
    const P = poses.current;
    const observer = viewMode === "observer";
    let modeChanged = modeRef.current !== viewMode;
    if (P.home !== opened.id) {
      P.home = opened.id;
      P.observer = null;
      P.aerial = null;
      P.seen = {};
      P.moves = opened.cameraMoves;
      userMoved.current = false;
      modeChanged = true;
    } else if (modeChanged && modeRef.current) {
      // Keep the view of the mode that is left, to come back to it
      if (modeRef.current === "observer") P.observer = { ...c.visitor.pose };
      else P.aerial = { pose: cameraPose(c.camera, c.hfov), target: c.controls.target.clone() };
    }
    modeRef.current = viewMode;
    c.controls.enabled = !observer;
    c.visitor.enabled = observer;
    if (!observer) useStore.setState({ visitorPose: null });

    const role = observer ? "observerCamera" : "topCamera";
    const stored = opened.home.cameras.find((cam) => cam.attrs.role === role);
    // Only the pose counts: the time (sun) and the lens (photo) do not move the view
    const storedKey = stored
      ? JSON.stringify([
          stored.attrs.x,
          stored.attrs.y,
          stored.attrs.z,
          stored.attrs.yaw,
          stored.attrs.pitch,
          stored.attrs.field_of_view,
        ])
      : "";
    // The stored camera was moved by a command (point of view, CLI, MCP), maybe to the
    // same place again, or changed when another home state was loaded
    const moved = opened.cameraMoves !== P.moves;
    P.moves = opened.cameraMoves;
    const external = stored !== undefined && (moved || P.seen[role] !== storedKey);
    P.seen[role] = storedKey;
    const local = observer ? P.observer : P.aerial;

    if (observer) {
      let pose: CameraPose | null = null;
      if (external && stored) {
        const a = stored.attrs;
        pose = { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch, fov: a.field_of_view };
      } else if (modeChanged) {
        pose = local as CameraPose | null;
        if (!pose) {
          // No camera stored: stand in the middle of the home on the selected level
          const box = new THREE.Box3();
          const walls = c.content.getObjectByName("walls");
          if (walls) box.expandByObject(walls);
          const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
          const level = opened.home.levels.find((l) => l.attrs.id === levelId);
          pose = {
            x: center.x,
            y: center.z,
            z: (level?.attrs.elevation ?? 0) + EYE_HEIGHT,
            yaw: 0,
            pitch: 0,
            fov: 1.1,
          };
        }
      }
      if (!pose) return;
      if (external && opened.home.levels.length > 1) {
        // Show the level of the point of view in the plan (without moving the visitor)
        const level = levelOfEye(opened.home, pose.z);
        if (level && level !== levelId) {
          lastLevel.current = level;
          useStore.getState().selectLevel(level);
        }
      }
      c.visitor.setPose(pose);
      c.hfov = pose.fov;
      useStore.setState({ visitorPose: { ...c.visitor.pose } });
      c.requestRender();
      return;
    }

    if (!external && !modeChanged && (stored || userMoved.current)) return;
    if (modeChanged && !external && P.aerial) {
      applyPose(c.camera, P.aerial.pose);
      c.controls.target.copy(P.aerial.target);
      c.hfov = P.aerial.pose.fov;
    } else if (stored) {
      const a = stored.attrs;
      c.camera.position.set(a.x, a.z, a.y);
      const pitch = Math.min(a.pitch, MAX_AERIAL_PITCH);
      const dir = cameraDirection(a.yaw, pitch);
      // Turn around the point of the view line nearest to the middle of the home
      const distance = orbitDistance(c.camera.position, dir, homeBox(c.content));
      c.controls.target.copy(c.camera.position).addScaledVector(dir, distance);
      c.hfov = a.field_of_view;
    } else {
      const view = fittedView(homeBox(c.content));
      c.camera.position.copy(view.position);
      c.controls.target.copy(view.target);
      c.hfov = Math.PI / 3;
    }
    c.camera.fov = verticalFov(c.hfov, c.camera.aspect);
    c.camera.updateProjectionMatrix();
    c.place(c.camera.position.clone(), c.controls.target.clone());
  }, [opened, viewMode, levelId]);

  // The visitor goes with the selected level (Sweet Home 3D's "adjust elevation to level")
  useEffect(() => {
    const c = ctx.current;
    const previous = lastLevel.current;
    lastLevel.current = levelId;
    if (
      !c ||
      !opened ||
      viewMode !== "observer" ||
      previous === undefined ||
      previous === levelId
    ) {
      return;
    }
    const elevation = (id: string | null) =>
      opened.home.levels.find((l) => l.attrs.id === id)?.attrs.elevation ?? 0;
    const pose = { ...c.visitor.pose };
    pose.z += elevation(levelId) - elevation(previous);
    c.visitor.setPose(pose);
    useStore.setState({ visitorPose: { ...c.visitor.pose } });
    c.requestRender();
  }, [levelId, opened, viewMode]);

  // Before saving, the cameras of the 3D view are written into the home
  useEffect(() => {
    const sync = async () => {
      const c = ctx.current;
      const { opened: current, viewMode: mode, run } = useStore.getState();
      if (!c || !current) return;
      const P = poses.current;
      const observerPose = mode === "observer" ? c.visitor.pose : P.observer;
      const aerialPose = mode === "aerial" ? cameraPose(c.camera, c.hfov) : P.aerial?.pose;
      if (observerPose) {
        await run("camera_set", {
          mode: "observer",
          ...poseParams(observerPose),
          activate: mode === "observer",
        });
      }
      if (aerialPose) {
        await run("camera_set", {
          mode: "aerial",
          ...poseParams(aerialPose),
          activate: mode === "aerial",
        });
      }
    };
    useStore.setState({ cameraSync: sync });
    return () => useStore.setState({ cameraSync: null });
  }, []);

  // 3D screenshots requested by the CLI or MCP server (live control)
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<{ requestId: number; mode: ViewMode | null }>(
      CAPTURE_EVENT,
      async (e) => {
        const { requestId, mode } = e.payload;
        try {
          if (mode && mode !== useStore.getState().viewMode) {
            useStore.getState().setViewMode(mode);
          }
          // Let React apply the view mode and rebuild, then wait for the models
          await new Promise((r) => setTimeout(r, 100));
          await waitForModels(15000);
          const c = ctx.current;
          if (!c) throw new Error("3D view not available");
          // Same as the render loop: the sky dome stays centered on the viewer
          const cam = c.view();
          if (c.sky) {
            c.sky.position.copy(cam.position);
            c.sky.visible = !c.parallel;
          }
          c.renderer.render(c.scene, cam);
          // Read the canvas right after rendering (no preserveDrawingBuffer needed)
          const data = c.renderer.domElement.toDataURL("image/png");
          await api.captureResult(requestId, data, null);
        } catch (err) {
          await api.captureResult(requestId, null, String(err));
        }
      },
    );
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  /** Scene, lights and camera of the view for photos and videos. */
  const photoSource = (): PhotoSource => {
    const c = ctx.current;
    if (!c) throw new Error("3D view not available");
    const ground = c.content.getObjectByName("ground") as THREE.Mesh | undefined;
    const groundColor =
      (ground?.material as THREE.MeshLambertMaterial | undefined)?.color?.clone() ??
      new THREE.Color(0xa8a8a8);
    // Photos use all lamps of the shown levels (also in the aerial view) and the ceiling
    // lights; the 3D view only the lamps near the visitor
    const photoLights = new THREE.Group();
    const home = useStore.getState().opened?.home;
    if (home) {
      const levels = levelInfos(home);
      const shown = visibleLevels(home, useStore.getState().selectedLevel);
      photoLights.add(
        buildLampLights(lampLights(home, levels, shown), c.camera.position, MAX_PHOTO_LIGHTS),
        buildCeilingLights(home, levels, shown),
      );
    }
    return {
      photoLights,
      scene: c.scene,
      content: c.content,
      lamps: c.lamps,
      sun: c.sun,
      sky: c.sky,
      camera: c.camera,
      hfov: c.hfov,
      groundColor,
    };
  };

  /** Starts a photo of the current view (see photo.ts). */
  const startPhoto = (
    width: number,
    height: number,
    quality: PhotoQuality,
    lens: Lens,
    onProgress?: (p: number) => void,
  ): PhotoJob => renderPhoto(photoSource(), { width, height, quality, lens, onProgress });
  const startPhotoRef = useRef(startPhoto);
  startPhotoRef.current = startPhoto;

  /** Starts a video along the camera path (see video.ts). */
  const startVideo = (
    points: CameraPoint[],
    width: number,
    height: number,
    frameRate: number,
    speed: number,
    quality: VideoQuality,
    onProgress?: (frame: number, frames: number) => void,
  ): VideoJob =>
    renderVideo(photoSource(), { points, width, height, frameRate, speed, quality, onProgress });
  const startVideoRef = useRef(startVideo);
  startVideoRef.current = startVideo;

  // Videos requested by the CLI or the MCP server: path and settings of the home
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<{
      requestId: number;
      width: number | null;
      height: number | null;
      frameRate: number | null;
      quality: VideoQuality;
      path: string;
    }>(RENDER_VIDEO_EVENT, async (e) => {
      const { requestId, quality, path } = e.payload;
      try {
        const info = (await api.execute("camera_path_get")) as CameraPathInfo;
        const width = even(e.payload.width ?? info.video.width);
        const height = even(
          e.payload.height ??
            (e.payload.width
              ? (e.payload.width * info.video.height) / info.video.width
              : info.video.height),
        );
        const frameRate = e.payload.frameRate ?? info.video.frame_rate;
        await waitForModels(60000);
        const job = startVideoRef.current(
          info.points.map(fromDegrees),
          width,
          height,
          frameRate,
          info.video.speed,
          quality,
        );
        const video = await job.done;
        await api.saveFile(path, video.data);
        await api.captureResult(
          requestId,
          JSON.stringify({
            path,
            width,
            height,
            frames: video.frames,
            duration_seconds: Math.round((video.frames / frameRate) * 100) / 100,
            codec: video.codec,
          }),
          null,
        );
      } catch (err) {
        await api.captureResult(requestId, null, String(err));
      }
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // Photos requested by the CLI or the MCP server
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<{
      requestId: number;
      width: number;
      height: number;
      quality: PhotoQuality;
      path: string | null;
    }>(RENDER_PHOTO_EVENT, async (e) => {
      const { requestId, width, height, quality, path } = e.payload;
      try {
        await waitForModels(60000);
        const url = await startPhotoRef.current(width, height, quality, homeLens()).done;
        if (path) {
          await api.saveImage(path, url);
          await api.captureResult(requestId, JSON.stringify({ path }), null);
        } else {
          const base64 = url.split(",")[1] ?? "";
          await api.captureResult(
            requestId,
            JSON.stringify({ mime_type: "image/png", image_base64: base64 }),
            null,
          );
        }
      } catch (err) {
        await api.captureResult(requestId, null, String(err));
      }
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // OBJ export requested by the export dialog, the CLI or the MCP server
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().listen<{ requestId: number; path: string }>(
      EXPORT_OBJ_EVENT,
      async (e) => {
        const { requestId, path } = e.payload;
        try {
          await waitForModels(60000);
          const c = ctx.current;
          if (!c) throw new Error("3D view not available");
          const mtlName = `${(path.split(/[\\/]/).pop() ?? "home").replace(/\.[^.]*$/, "")}.mtl`;
          const files = buildObj(c.content, mtlName);
          const paths = await api.writeObjFiles(path, files.obj, files.mtl, files.textures);
          await api.captureResult(requestId, JSON.stringify({ paths }), null);
        } catch (err) {
          await api.captureResult(requestId, null, String(err));
        }
      },
    );
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  // Actions of the aerial view that menus, the command search and the view's own buttons
  // run: fit, zoom to the selection, the standard views and the projection
  useEffect(
    () =>
      registerView3D((action) => {
        const c = ctx.current;
        const current = useStore.getState().opened;
        if (!c || !current) return;
        if (action === "parallel") {
          useUi.getState().setParallel(!useUi.getState().parallel);
          return;
        }
        if (useStore.getState().viewMode === "observer") return;
        const along = c.controls.target.clone().sub(c.view().position).normalize();
        let fitted: ReturnType<typeof fittedView>;
        if (action === "fit") {
          fitted = fittedView(homeBox(c.content), along);
        } else if (action === "zoomSelection") {
          const box = c.outline.bounds();
          if (box.isEmpty()) return;
          // Not nearer than a room is wide: the camera would stand in the next wall
          fitted = fittedView(box, along, 400);
        } else {
          const north = current.home.compass?.attrs.north_direction ?? 0;
          const standard = action.slice("view:".length) as StandardView;
          fitted = fittedView(homeBox(c.content), viewDirection(standard, north));
        }
        userMoved.current = true;
        c.place(fitted.position, fitted.target);
      }),
    [],
  );

  return (
    <>
      <div className="view3d-canvas" ref={containerRef} />
      <div className="view3d-pivot" ref={pivotRef}>
        <Icon name="zoomfit" size={22} />
      </div>
      {opened && viewMode === "observer" && (
        <div className="view3d-hint">
          {t(
            "Drag to look around · W A S D: walk · Q / E: down / up · Shift: faster · wheel: zoom",
          )}
        </div>
      )}
      {opened && viewMode !== "observer" && (
        <div className="view3d-hint">
          {t("Click: select · drag: turn · right-drag: move · wheel: zoom · double-click: pivot")}
        </div>
      )}
      {opened && (
        <div className="view3d-north" title={t("North")}>
          <div ref={northRef}>
            <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true">
              <path className="north-needle" d="M16 3 L22 20 L16 16.5 L10 20 Z" />
              <text x="16" y="30" textAnchor="middle">
                N
              </text>
            </svg>
          </div>
        </div>
      )}
      {opened && viewMode !== "observer" && (
        <button
          type="button"
          className="overlay-button icon-button"
          onClick={() => runViewAction("fit")}
          title={t("Fit the home in the view and turn around its middle")}
          aria-label={t("Fit the home in the view and turn around its middle")}
        >
          <Icon name="zoomfit" size={18} />
        </button>
      )}
      {opened && (
        <ViewpointsMenu
          onSettings={() => (settingsOpen ? closeDialog() : openDialog("settings3d"))}
          thumbnails={(poses) => ctx.current?.thumbnails(poses) ?? []}
          leading={
            IN_OWN_WINDOW && (
              <>
                <button
                  type="button"
                  className="view3d-button"
                  onClick={() => openDialog("photo")}
                  title={t("Create a photo of the current view (draft or path traced)")}
                >
                  {t("Photo…")}
                </button>
                <button
                  type="button"
                  className="view3d-button"
                  onClick={() => openDialog("video")}
                  title={t("Create a video along a camera path")}
                >
                  {t("Video…")}
                </button>
              </>
            )
          }
          currentPose={() => {
            const c = ctx.current;
            if (!c) throw new Error("3D view not available");
            const mode = useStore.getState().viewMode;
            return {
              mode,
              pose: mode === "observer" ? { ...c.visitor.pose } : cameraPose(c.camera, c.hfov),
            };
          }}
        />
      )}
      {settingsOpen && opened && (
        <View3DSettings
          sun={shownSun}
          onClose={closeDialog}
          onPreviewSun={previewSun}
          onPreview={setEnvPreview}
        />
      )}
      {videoOpen && opened && (
        <VideoDialog
          baseName={(opened.home.attrs.name ?? "Video").replace(/\.sh3d$/i, "")}
          currentPose={() => {
            const c = ctx.current;
            if (!c) throw new Error("3D view not available");
            return cameraPose(c.camera, c.hfov);
          }}
          thumbnails={(poses) => ctx.current?.thumbnails(poses) ?? []}
          start={startVideo}
          onClose={closeDialog}
        />
      )}
      {photoOpen && opened && (
        <PhotoDialog
          viewAspect={ctx.current?.camera.aspect ?? 4 / 3}
          baseName={(opened.home.attrs.name ?? "Photo").replace(/\.sh3d$/i, "")}
          sun={shownSun}
          lens={homeLens()}
          start={(w, h, q, lens, onProgress) => startPhoto(w, h, q, lens, onProgress)}
          snapshot={(w, h) => {
            const c = ctx.current;
            if (!c) return "";
            // As wide as the preview of the panel shows it
            const width = Math.min(w, 800);
            const pose = cameraPose(c.camera, c.hfov);
            return c.thumbnails([pose], width, Math.round((width * h) / w))[0] ?? "";
          }}
          onClose={closeDialog}
        />
      )}
    </>
  );
}
