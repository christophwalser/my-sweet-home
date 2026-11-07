// 3D view: WebGL renderer that only redraws when something changes.

import { listen } from "@tauri-apps/api/event";
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
import { forEachPiece } from "../model";
import { useStore, type ViewMode } from "../store";
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
import { cameraDirection, cameraPose, verticalFov } from "./camera";
import { buildLampLights, lampLights } from "./lights";
import { clearModelCache, createPieceObject, disposeObject, waitForModels } from "./models";
import { buildObj } from "./objExport";
import PhotoDialog from "./PhotoDialog";
import { type PhotoJob, type PhotoQuality, type PhotoSource, renderPhoto } from "./photo";
import VideoDialog from "./VideoDialog";
import {
  type CameraPathInfo,
  type CameraPoint,
  even,
  fromDegrees,
  renderVideo,
  type VideoJob,
  type VideoQuality,
} from "./video";

/**
 * Highest pitch used for the aerial view. A camera looking straight down sits on
 * the pole of OrbitControls, where the yaw is lost and tilting feels stuck.
 */
const MAX_AERIAL_PITCH = Math.PI / 2 - 0.05;
/** Direction from the scene towards the sun (fixed for now; no compass-based sun yet). */
const SUN_DIRECTION = new THREE.Vector3(-1000, 2500, 1500).normalize();

export default function View3D() {
  const opened = useStore((s) => s.opened);
  const levelId = useStore((s) => s.selectedLevel);
  const viewMode = useStore((s) => s.viewMode);
  const [shadows, setShadows] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 5, 200000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    const content = new THREE.Group();
    const lamps = new THREE.Group();
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(3000);
    sun.shadow.mapSize.set(4096, 4096);
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
      content,
      lamps,
      sun,
      sky: null,
      hfov: Math.PI / 3,
      requestRender,
    };
    ctx.current = state;
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

    const ambient = new THREE.HemisphereLight(0xffffff, lightColor(home), 1.6);
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
    c.requestRender();
  }, [opened, levelId]);

  // Sun shadows (optional, they cost a second render pass)
  useEffect(() => {
    const c = ctx.current;
    if (!c || !opened || levelId === undefined) return;
    c.renderer.shadowMap.enabled = shadows;
    c.sun.castShadow = shadows;
    // Fit the shadow camera around the walls of the shown levels
    const walls = c.content.getObjectByName("walls");
    const box = walls ? new THREE.Box3().setFromObject(walls) : new THREE.Box3();
    if (box.isEmpty()) {
      box.set(new THREE.Vector3(-1000, 0, -1000), new THREE.Vector3(1000, 300, 1000));
    }
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(500, box.getSize(new THREE.Vector3()).length() / 2 + 200);
    c.sun.target.position.copy(center);
    c.sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius * 2);
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
  }, [shadows, opened, levelId]);

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
      const viewer = observer
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
  const cameraKey = useRef<string | null>(null);
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
    const role = viewMode === "observer" ? "observerCamera" : "topCamera";
    const stored = opened.home.cameras.find((cam) => cam.attrs.role === role);
    const key = `${opened.id}:${viewMode}`;
    const keyChanged = cameraKey.current !== key;
    if (keyChanged) userMoved.current = false;
    if (!keyChanged && (stored || userMoved.current)) return;
    cameraKey.current = key;
    if (stored) {
      const a = stored.attrs;
      c.camera.position.set(a.x, a.z, a.y);
      const pitch = viewMode === "observer" ? a.pitch : Math.min(a.pitch, MAX_AERIAL_PITCH);
      const dir = cameraDirection(a.yaw, pitch);
      // Orbit around the point where the view hits the ground (or a point in front)
      const distance = dir.y < -0.05 ? Math.min(a.z / -dir.y, 5000) : 300;
      c.controls.target
        .copy(c.camera.position)
        .addScaledVector(dir, viewMode === "observer" ? 100 : distance);
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
  }, [opened, viewMode]);

  // 3D screenshots requested by the CLI or MCP server (live control)
  useEffect(() => {
    const unlisten = listen<{ requestId: number; mode: ViewMode | null }>(
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
    return {
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
    onProgress?: (p: number) => void,
  ): PhotoJob => renderPhoto(photoSource(), { width, height, quality, onProgress });
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
    const unlisten = listen<{
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
    const unlisten = listen<{
      requestId: number;
      width: number;
      height: number;
      quality: PhotoQuality;
      path: string | null;
    }>(RENDER_PHOTO_EVENT, async (e) => {
      const { requestId, width, height, quality, path } = e.payload;
      try {
        await waitForModels(60000);
        const url = await startPhotoRef.current(width, height, quality).done;
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
    const unlisten = listen<{ requestId: number; path: string }>(EXPORT_OBJ_EVENT, async (e) => {
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
    });
    return () => {
      void unlisten.then((off) => off());
    };
  }, []);

  return (
    <>
      <div className="view3d-canvas" ref={containerRef} />
      {opened && (
        <label className="view3d-option">
          <input
            type="checkbox"
            checked={shadows}
            onChange={(e) => setShadows(e.currentTarget.checked)}
          />
          Shadows
        </label>
      )}
      {opened && (
        <button
          type="button"
          className="view3d-photo"
          onClick={() => setPhotoOpen(true)}
          title="Create a photo of the current view (draft or path traced)"
        >
          Photo…
        </button>
      )}
      {opened && (
        <button
          type="button"
          className="view3d-video"
          onClick={() => setVideoOpen(true)}
          title="Create a video along a camera path"
        >
          Video…
        </button>
      )}
      {videoOpen && opened && (
        <VideoDialog
          baseName={(opened.home.attrs.name ?? "Video").replace(/\.sh3d$/i, "")}
          currentPose={() => {
            const c = ctx.current;
            if (!c) throw new Error("3D view not available");
            return cameraPose(c.camera, c.hfov);
          }}
          start={startVideo}
          onClose={() => setVideoOpen(false)}
        />
      )}
      {photoOpen && opened && (
        <PhotoDialog
          viewAspect={ctx.current?.camera.aspect ?? 4 / 3}
          baseName={(opened.home.attrs.name ?? "Photo").replace(/\.sh3d$/i, "")}
          start={(w, h, q, onProgress) => startPhoto(w, h, q, onProgress)}
          onClose={() => setPhotoOpen(false)}
        />
      )}
    </>
  );
}
