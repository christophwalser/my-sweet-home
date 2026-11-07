// 3D view: WebGL renderer that only redraws when something changes.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { type Camera, forEachPiece } from "../model";
import { useStore } from "../store";
import {
  buildGround,
  buildRooms,
  buildWalls,
  levelInfos,
  lightColor,
  skyColor,
  visibleLevels,
} from "./buildScene";
import { clearModelCache, createPieceObject, disposeObject } from "./models";

/**
 * View direction of a Sweet Home 3D camera in three.js coordinates.
 * Sweet Home 3D orients the view with rotY(π − yaw) · rotX(−pitch) applied to
 * the default view direction (0, 0, −1); a positive pitch looks down.
 */
function cameraDirection(c: Camera["attrs"]): THREE.Vector3 {
  return new THREE.Vector3(
    -Math.sin(c.yaw) * Math.cos(c.pitch),
    -Math.sin(c.pitch),
    Math.cos(c.yaw) * Math.cos(c.pitch),
  );
}

/** Sweet Home 3D stores the horizontal field of view; three.js expects the vertical one. */
function verticalFov(horizontal: number, aspect: number): number {
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / aspect));
}

export default function View3D() {
  const opened = useStore((s) => s.opened);
  const levelId = useStore((s) => s.selectedLevel);
  const viewMode = useStore((s) => s.viewMode);
  const containerRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    content: THREE.Group;
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
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 5, 200000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    const content = new THREE.Group();
    scene.add(content);

    let frame = 0;
    const render = () => {
      frame = 0;
      renderer.render(scene, camera);
    };
    const requestRender = () => {
      if (!frame) frame = requestAnimationFrame(render);
    };
    controls.addEventListener("change", requestRender);

    const state = { renderer, scene, camera, controls, content, hfov: Math.PI / 3, requestRender };
    ctx.current = state;

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
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(-1000, 2500, 1500);
    c.content.add(ambient, sun);

    c.content.add(buildGround(opened, c.requestRender));
    c.content.add(buildWalls(opened, levels, shown));
    c.content.add(buildRooms(opened, levels, shown, c.requestRender));

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

  // Place the camera from the cameras stored in the home
  useEffect(() => {
    const c = ctx.current;
    if (!c || !opened) return;
    const role = viewMode === "observer" ? "observerCamera" : "topCamera";
    const stored = opened.home.cameras.find((cam) => cam.attrs.role === role);
    if (stored) {
      const a = stored.attrs;
      c.camera.position.set(a.x, a.z, a.y);
      const dir = cameraDirection(a);
      // Orbit around the point where the view hits the ground (or a point in front)
      const distance = dir.y < -0.05 ? Math.min(a.z / -dir.y, 5000) : 300;
      c.controls.target
        .copy(c.camera.position)
        .addScaledVector(dir, viewMode === "observer" ? 100 : distance);
      c.hfov = a.field_of_view;
    } else {
      const box = new THREE.Box3().setFromObject(c.content);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      c.camera.position.set(center.x, center.y + size * 0.6, center.z + size * 0.6);
      c.controls.target.copy(center);
      c.hfov = Math.PI / 3;
    }
    c.camera.fov = verticalFov(c.hfov, c.camera.aspect);
    c.camera.updateProjectionMatrix();
    c.controls.update();
    c.requestRender();
  }, [opened, viewMode]);

  return <div className="view3d-canvas" ref={containerRef} />;
}
