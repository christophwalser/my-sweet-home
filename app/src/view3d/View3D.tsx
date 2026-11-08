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
import { forEachPiece, type Home } from "../model";
import { usePreferences } from "../preferences";
import { poseParams, useStore, type ViewMode } from "../store";
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
} from "./buildScene";
import { applyPose, type CameraPose, cameraDirection, cameraPose, verticalFov } from "./camera";
import type { Lens } from "./lens";
import { buildCeilingLights, buildLampLights, lampLights, MAX_PHOTO_LIGHTS } from "./lights";
import { clearModelCache, createPieceObject, disposeObject, waitForModels } from "./models";
import { buildObj } from "./objExport";
import PhotoDialog from "./PhotoDialog";
import { type PhotoJob, type PhotoQuality, type PhotoSource, renderPhoto } from "./photo";
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

/** The view is shown in the separate 3D window (which has no tool bar). */
const IN_OWN_WINDOW = getCurrentWebviewWindow().label.startsWith(VIEW3D_PREFIX);

export default function View3D() {
  const opened = useStore((s) => s.opened);
  const levelId = useStore((s) => s.selectedLevel);
  const viewMode = useStore((s) => s.viewMode);
  const shadows = useUi((s) => s.shadows);
  const quality = usePreferences((s) => s.quality3d);
  const setShadows = useUi((s) => s.setShadows);
  const dialog = useUi((s) => s.dialog);
  const openDialog = useUi((s) => s.openDialog);
  const closeDialog = useUi((s) => s.closeDialog);
  const photoOpen = dialog === "photo";
  const videoOpen = dialog === "video";
  const settingsOpen = dialog === "settings3d";
  const containerRef = useRef<HTMLDivElement>(null);
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
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 5, 200000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
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

    let frame = 0;
    const render = () => {
      frame = 0;
      // The sky dome stays centered on the viewer
      state.sky?.position.copy(camera.position);
      renderer.render(scene, camera);
    };
    const requestRender = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    controls.addEventListener("change", requestRender);
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
      requestRender();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      controls.dispose();
      visitor.dispose();
      disposeObject(content);
      disposeObject(lamps);
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
    if (lastDocId.current !== (opened?.id ?? null)) {
      // Models of the previous home are no longer needed
      clearModelCache();
      lastDocId.current = opened?.id ?? null;
    }
    for (const child of [...c.content.children]) {
      c.content.remove(child);
      disposeObject(child);
    }
    c.sky = null;
    if (!opened) {
      c.scene.background = new THREE.Color(0x202326);
      c.requestRender();
      return;
    }
    const home = opened.home;
    c.scene.background = skyColor(home);

    const levels = levelInfos(home);
    const shown = visibleLevels(home, levelId);

    const ambient = new THREE.HemisphereLight(0xffffff, lightColor(home), AMBIENT_INTENSITY);
    ambient.name = "ambient";
    c.content.add(ambient);

    c.sky = buildSky(opened, c.requestRender);
    if (c.sky) c.content.add(c.sky);
    const ground = buildGround(opened, c.requestRender);
    ground.receiveShadow = true;
    c.content.add(ground);
    const walls = buildWalls(opened, levels, shown, c.requestRender);
    const rooms = buildRooms(opened, levels, shown, c.requestRender);
    for (const g of [walls, rooms]) {
      g.traverse((o) => {
        // Ceilings would darken the whole interior in the aerial view
        o.castShadow = !o.name.startsWith("ceiling:");
        o.receiveShadow = true;
      });
    }
    c.content.add(walls, rooms, buildAnnotations(home, levels, shown));

    const furniture = new THREE.Group();
    furniture.name = "furniture";
    forEachPiece(home.furniture, (p) => {
      if (!shown.has(p.attrs.level)) return;
      const base = (levels.get(p.attrs.level) ?? levels.get(null))?.elevation ?? 0;
      furniture.add(createPieceObject(p, opened.id, base, c.requestRender));
    });
    c.content.add(furniture);
    // Walls and doors for the virtual visitor (all levels: the visitor may change level)
    c.visitor.colliders = buildColliders(
      home,
      opened.wallShapes,
      (level) => (levels.get(level) ?? levels.get(null))?.elevation ?? 0,
    );
    c.requestRender();
  }, [opened, levelId]);

  // Position of the sun from the location, date and time of the home (computed by the
  // core); it follows the clock if the home says so
  const [sun, setSun] = useState<SunInfo | null>(null);
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
          if (alive) setSun(s as SunInfo);
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
  }, [opened]);
  const sunRef = useRef<SunInfo | null>(null);
  sunRef.current = sun;

  // Light of the sun and the sky: direction, daylight and the brightness of the home
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new level rebuilds the scene and its ambient light
  useEffect(() => {
    const c = ctx.current;
    if (!c || !opened) return;
    const light = brightness(opened.home);
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
  }, [sun, opened, levelId]);

  // Sun shadows (optional, they cost a second render pass)
  useEffect(() => {
    const c = ctx.current;
    if (!c || !opened || levelId === undefined) return;
    const sunDirection = sun
      ? new THREE.Vector3(sun.direction[0], sun.direction[2], sun.direction[1]).normalize()
      : DEFAULT_SUN_DIRECTION;
    // Below the horizon there are no shadows (and the light is off)
    const castShadow = shadows && (!sun || sun.elevation > 0);
    c.renderer.shadowMap.enabled = castShadow;
    c.sun.castShadow = castShadow;
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
    // Materials compiled without shadow support must be rebuilt
    c.scene.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) m.needsUpdate = true;
    });
    c.requestRender();
  }, [shadows, opened, levelId, sun]);

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
      const lights = lampLights(home, levelInfos(home), visibleLevels(home, levelId));
      c.lamps.add(buildLampLights(lights, viewer));
    }
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
      // Orbit around the point where the view hits the ground (or a point in front)
      const distance = dir.y < -0.05 ? Math.min(a.z / -dir.y, 5000) : 300;
      c.controls.target.copy(c.camera.position).addScaledVector(dir, distance);
      c.hfov = a.field_of_view;
    } else {
      // Fit to walls and rooms (the ground plane is huge and must not count)
      const box = new THREE.Box3();
      for (const child of c.content.children) {
        if (child.name === "walls" || child.name === "rooms") box.expandByObject(child);
      }
      if (box.isEmpty()) box.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 250, 500));
      const center = box.getCenter(new THREE.Vector3());
      const size = Math.max(box.getSize(new THREE.Vector3()).length(), 500);
      c.camera.position.set(center.x, center.y + size * 0.7, center.z + size * 0.8);
      c.controls.target.copy(center);
      c.hfov = Math.PI / 3;
    }
    c.camera.fov = verticalFov(c.hfov, c.camera.aspect);
    c.camera.updateProjectionMatrix();
    c.controls.update();
    c.requestRender();
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
          c.sky?.position.copy(c.camera.position);
          c.renderer.render(c.scene, c.camera);
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

  return (
    <>
      <div className="view3d-canvas" ref={containerRef} />
      {opened && viewMode === "observer" && (
        <div className="view3d-hint">
          {t(
            "Drag to look around · W A S D: walk · Q / E: down / up · Shift: faster · wheel: zoom",
          )}
        </div>
      )}
      {opened && (
        <ViewpointsMenu
          onSettings={() => (settingsOpen ? closeDialog() : openDialog("settings3d"))}
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
      {opened && (
        <label className="view3d-option">
          <input
            type="checkbox"
            checked={shadows}
            onChange={(e) => setShadows(e.currentTarget.checked)}
          />
          {t("Shadows")}
        </label>
      )}
      {opened && IN_OWN_WINDOW && (
        <button
          type="button"
          className="view3d-photo"
          onClick={() => openDialog("photo")}
          title={t("Create a photo of the current view (draft or path traced)")}
        >
          {t("Photo…")}
        </button>
      )}
      {opened && IN_OWN_WINDOW && (
        <button
          type="button"
          className="view3d-video"
          onClick={() => openDialog("video")}
          title={t("Create a video along a camera path")}
        >
          {t("Video…")}
        </button>
      )}
      {settingsOpen && opened && <View3DSettings sun={sun} onClose={closeDialog} />}
      {videoOpen && opened && (
        <VideoDialog
          baseName={(opened.home.attrs.name ?? "Video").replace(/\.sh3d$/i, "")}
          currentPose={() => {
            const c = ctx.current;
            if (!c) throw new Error("3D view not available");
            return cameraPose(c.camera, c.hfov);
          }}
          start={startVideo}
          onClose={closeDialog}
        />
      )}
      {photoOpen && opened && (
        <PhotoDialog
          viewAspect={ctx.current?.camera.aspect ?? 4 / 3}
          baseName={(opened.home.attrs.name ?? "Photo").replace(/\.sh3d$/i, "")}
          sun={sun}
          lens={homeLens()}
          start={(w, h, q, lens, onProgress) => startPhoto(w, h, q, lens, onProgress)}
          onClose={closeDialog}
        />
      )}
    </>
  );
}
