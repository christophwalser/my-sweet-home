// Virtual visit: game-like controls for the observer camera.
//
// WASD (or the arrow keys) walk, Q / E move down / up, Shift is faster; dragging with
// the mouse looks around and the mouse wheel changes the field of view. Walls stop the
// visitor, doors and windows reaching the floor can be walked through.

import * as THREE from "three";
import { forEachPiece, type Home, type Pt, type WallShape } from "../model";
import { usePreferences } from "../preferences";
import { applyPose, type CameraPose } from "./camera";
import { cutOutOutlines } from "./staircase";

/** Radius of the visitor's body in the plan (cm). */
export const VISITOR_RADIUS = 20;
/** Default eye elevation above the floor (cm). */
export const EYE_HEIGHT = 170;
/** Walking speed in cm/s from the preference in km/h; Shift: three times faster. */
const walkSpeed = () => (usePreferences.getState().walkingSpeed * 100000) / 3600;
const RUN_FACTOR = 3;
/** Turning speed of the arrow keys in rad/s. */
const TURN_SPEED = Math.PI / 2;
/** Radians per pixel of mouse movement. */
const LOOK_SENSITIVITY = 0.004;
const MAX_PITCH = THREE.MathUtils.degToRad(85);
export const MIN_FOV = THREE.MathUtils.degToRad(20);
export const MAX_FOV = THREE.MathUtils.degToRad(120);
/** Height that can be stepped over (cm), e.g. low walls or a threshold. */
const STEP = 30;
/** Half the size of the feet on the steps (cm). */
const FOOT = 8;

/** An obstacle in the plan: a wall polygon with its vertical extent. */
type Obstacle = { poly: Pt[]; bottom: number; top: number };
/** A passage through walls: a door or window reaching the floor. */
type Passage = {
  center: Pt;
  cos: number;
  sin: number;
  halfW: number;
  halfD: number;
  bottom: number;
  top: number;
};

/**
 * A staircase as a ramp: its floor rises from the front of the piece (bottom) to its
 * back, up to the level it leads to.
 */
type Ramp = {
  center: Pt;
  cos: number;
  sin: number;
  halfW: number;
  halfD: number;
  bottom: number;
  top: number;
  /** Outlines of the hole the staircase cuts in the floor above (plan coordinates) */
  holes: Pt[][];
};

export type Colliders = {
  obstacles: Obstacle[];
  passages: Passage[];
  /** Elevations of the floors (levels), ascending */
  floors: number[];
  ramps: Ramp[];
  /**
   * Elevations of the upward faces of the staircase models at a plan point (their steps),
   * or null while the models are not loaded (the ramps stand in for them then)
   */
  stepSurfaces?: (p: Pt) => number[] | null;
};

/** Lowest eye height above the floor the visitor stands on (cm). */
const MIN_EYE_ABOVE_FLOOR = 60;

/** Level the visitor stands on: the highest one sufficiently below the eyes. */
export function levelOfEye(home: Home, eye: number): string | null {
  const levels = [...home.levels].sort((a, b) => a.attrs.elevation - b.attrs.elevation);
  if (levels.length === 0) return null;
  const below = levels.filter((l) => l.attrs.elevation <= eye - MIN_EYE_ABOVE_FLOOR);
  return (below[below.length - 1] ?? levels[0]).attrs.id;
}

/** Elevation of the floor of the level the visitor is on. */
function floorUnder(c: Colliders, eye: number): number {
  let floor = c.floors[0] ?? 0;
  for (const f of c.floors) if (f <= eye - MIN_EYE_ABOVE_FLOOR) floor = f;
  return floor;
}

/** Height of a ramp's floor at `p`, or null outside the staircase. */
function rampHeight(r: Ramp, p: Pt): number | null {
  const dx = p[0] - r.center[0];
  const dy = p[1] - r.center[1];
  const along = dx * r.cos + dy * r.sin;
  const across = -dx * r.sin + dy * r.cos;
  if (Math.abs(along) > r.halfW || Math.abs(across) > r.halfD) return null;
  // Front (+depth) at the bottom, back at the top
  const t = (r.halfD - across) / (2 * r.halfD);
  return r.bottom + t * (r.top - r.bottom);
}

/**
 * Floor under the visitor at `p`: the steps of a staircase it stands on (within a step of
 * where it was, the nearest of several), else the floor of its level. Above a stairwell
 * whose steps are far below, the visitor stays on its floor.
 */
export function groundAt(c: Colliders, p: Pt, eye: number, previous: number): number {
  const stairs = c.ramps.filter((r) => rampHeight(r, p) !== null);
  // The feet cover a small area: small gaps between steps or at the edge of a stairwell
  // do not let the visitor fall
  const feet: Pt[] = [
    p,
    ...[
      [FOOT, 0],
      [-FOOT, 0],
      [0, FOOT],
      [0, -FOOT],
    ].map(([dx, dy]) => [p[0] + dx, p[1] + dy] as Pt),
  ];
  let surfaces: number[] | null = null;
  if (stairs.length > 0 && c.stepSurfaces) {
    for (const q of feet) {
      const found = c.stepSurfaces(q);
      if (!found) {
        surfaces = null;
        break;
      }
      surfaces = [...(surfaces ?? []), ...found];
    }
  }
  if (surfaces) {
    // On the real steps (any shape, e.g. spiral staircases): the highest surface at most a
    // step above the feet, a step of the model or a floor where no stairwell is cut into it
    const inHole = (f: number, q: Pt) =>
      stairs.some(
        (r) => f > r.bottom + 1 && f <= r.top + 1 && r.holes.some((h) => pointInPolygon(q, h)),
      );
    const floors = c.floors.filter((f) => feet.some((q) => !inHole(f, q)));
    let top = Number.NEGATIVE_INFINITY;
    for (const h of [...surfaces, ...floors]) if (h <= previous + STEP && h > top) top = h;
    if (top > Number.NEGATIVE_INFINITY) return top;
  }
  let best: number | null = null;
  for (const r of c.ramps) {
    const h = rampHeight(r, p);
    if (h === null || Math.abs(h - previous) > 60) continue;
    if (best === null || Math.abs(h - previous) < Math.abs(best - previous)) best = h;
  }
  return best ?? floorUnder(c, eye);
}

/** Elevation of the level a staircase leads to, if the visitor stands on its steps. */
export function stairTopAt(c: Colliders, p: Pt, ground: number): number | null {
  for (const r of c.ramps) {
    // Above the bottom of the staircase within its outline: on its steps (also when they are
    // not those of a straight ramp)
    if (rampHeight(r, p) !== null && ground > r.bottom + 1 && ground <= r.top + 0.5) return r.top;
  }
  return null;
}

/** Walls and doors of the home as obstacles and passages for the visitor. */
export function buildColliders(
  home: Home,
  wallShapes: WallShape[],
  levelElevation: (level: string | null) => number,
): Colliders {
  const obstacles: Obstacle[] = [];
  home.walls.forEach((w, i) => {
    const shape = wallShapes[i];
    if (!shape || shape.left.length < 2 || shape.right.length < 2) return;
    const bottom = levelElevation(w.attrs.level);
    const height = Math.max(
      w.attrs.height ?? home.attrs.wall_height ?? 250,
      w.attrs.height_at_end ?? 0,
    );
    obstacles.push({
      poly: [...shape.left, ...[...shape.right].reverse()],
      bottom,
      top: bottom + height,
    });
  });
  const passages: Passage[] = [];
  forEachPiece(home.furniture, (p) => {
    const a = p.attrs;
    if (p.kind !== "DoorOrWindow" || a.visible === false) return;
    const bottom = levelElevation(a.level) + (a.elevation ?? 0);
    // Only openings starting near the floor and high enough to walk through
    if ((a.elevation ?? 0) > STEP || a.height < 150) return;
    const angle = a.angle ?? 0;
    passages.push({
      center: [a.x, a.y],
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      // A little narrower than the opening, deep enough to cross the whole wall
      halfW: Math.max(0, a.width / 2 - VISITOR_RADIUS * 0.6),
      halfD: a.depth / 2 + VISITOR_RADIUS * 2 + 20,
      bottom,
      top: bottom + a.height,
    });
  });
  const floors = [...new Set([0, ...home.levels.map((l) => levelElevation(l.attrs.id))])].sort(
    (a, b) => a - b,
  );
  const ramps: Ramp[] = [];
  forEachPiece(home.furniture, (p) => {
    const a = p.attrs;
    if (!a.staircase_cut_out_shape || a.visible === false) return;
    const bottom = levelElevation(a.level) + (a.elevation ?? 0);
    const height = a.height_in_plan ?? a.height;
    // Up to the level the staircase leads to (its model also has a handrail above it)
    const top = floors.find((f) => f > bottom + 50 && f <= bottom + height + 1) ?? bottom + height;
    const angle = a.angle ?? 0;
    ramps.push({
      center: [a.x, a.y],
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      halfW: (a.width_in_plan ?? a.width) / 2,
      halfD: (a.depth_in_plan ?? a.depth) / 2,
      bottom,
      top,
      holes: cutOutOutlines(p),
    });
  });
  return { obstacles, passages, floors, ramps };
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Distance from `p` to the nearest wall the visitor can touch with the eyes at `eye`
 * (negative inside a wall, infinite in a door opening or without walls).
 */
export function clearance(c: Colliders, p: Pt, eye: number, ground?: number): number {
  // The feet are on the floor of the level the visitor is on (the eye height of points
  // of view differs from home to home), or on the steps; lower than a step does not stop it
  const feet = (ground ?? floorUnder(c, eye)) + STEP;
  for (const pa of c.passages) {
    if (pa.bottom > feet || pa.top < Math.min(eye, feet + 150)) continue;
    const dx = p[0] - pa.center[0];
    const dy = p[1] - pa.center[1];
    const along = dx * pa.cos + dy * pa.sin;
    const across = -dx * pa.sin + dy * pa.cos;
    if (Math.abs(along) <= pa.halfW && Math.abs(across) <= pa.halfD) {
      return Number.POSITIVE_INFINITY;
    }
  }
  let nearest = Number.POSITIVE_INFINITY;
  for (const o of c.obstacles) {
    // Walls below the knees or above the head do not stop the visitor
    if (o.top <= feet || o.bottom >= eye) continue;
    let d = Number.POSITIVE_INFINITY;
    for (let i = 0; i < o.poly.length; i++) {
      d = Math.min(d, distanceToSegment(p, o.poly[i], o.poly[(i + 1) % o.poly.length]));
    }
    nearest = Math.min(nearest, pointInPolygon(p, o.poly) ? -d : d);
  }
  return nearest;
}

/** True if a visitor standing at `p` with the eyes at `eye` touches a wall. */
export function blocked(c: Colliders, p: Pt, eye: number): boolean {
  return clearance(c, p, eye) < VISITOR_RADIUS;
}

/**
 * Moves from `from` towards `to`, sliding along walls instead of stopping at them.
 * A visitor already touching a wall (e.g. a stored point of view close to it) may
 * move along it or away from it, but not closer.
 */
export function collide(c: Colliders, from: Pt, to: Pt, eye: number, ground?: number): Pt {
  // Long moves are checked in steps so that thin walls are not skipped
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / (VISITOR_RADIUS / 2)),
  );
  let p: Pt = from;
  let here = clearance(c, p, eye, ground);
  const sx = (to[0] - from[0]) / steps;
  const sy = (to[1] - from[1]) / steps;
  for (let i = 0; i < steps; i++) {
    let next: Pt | null = null;
    for (const q of [
      [p[0] + sx, p[1] + sy],
      [p[0] + sx, p[1]],
      [p[0], p[1] + sy],
    ] as Pt[]) {
      const d = clearance(c, q, eye, ground);
      if (d >= VISITOR_RADIUS || d >= here - 1e-3) {
        next = q;
        here = d;
        break;
      }
    }
    if (!next) break;
    p = next;
  }
  return p;
}

/** Keyboard and mouse controls of the observer camera. */
export class VisitorControls {
  pose: CameraPose;
  enabled = false;
  colliders: Colliders = { obstacles: [], passages: [], floors: [0], ramps: [] };
  /** Called after each change of the pose (for rendering and the plan) */
  onChange: (pose: CameraPose) => void = () => {};
  /** Called when the visitor stopped moving (for storing the camera) */
  onStop: (pose: CameraPose) => void = () => {};

  private keys = new Set<string>();
  /** Floor or step height under the visitor while walking */
  private ground: number | null = null;
  /** Elevation of the level ahead while the visitor is on a staircase, else null */
  stairTop: number | null = null;
  private frame = 0;
  private last = 0;
  private drag: { x: number; y: number } | null = null;
  private stopTimer = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    this.pose = { x: 0, y: 0, z: EYE_HEIGHT, yaw: 0, pitch: 0, fov: 1.1 };
    dom.tabIndex = 0;
    dom.addEventListener("keydown", this.keyDown);
    dom.addEventListener("keyup", this.keyUp);
    dom.addEventListener("blur", this.blur);
    dom.addEventListener("pointerdown", this.pointerDown);
    dom.addEventListener("pointermove", this.pointerMove);
    dom.addEventListener("pointerup", this.pointerUp);
    dom.addEventListener("pointercancel", this.pointerUp);
    dom.addEventListener("wheel", this.wheel, { passive: false });
  }

  dispose(): void {
    const d = this.dom;
    d.removeEventListener("keydown", this.keyDown);
    d.removeEventListener("keyup", this.keyUp);
    d.removeEventListener("blur", this.blur);
    d.removeEventListener("pointerdown", this.pointerDown);
    d.removeEventListener("pointermove", this.pointerMove);
    d.removeEventListener("pointerup", this.pointerUp);
    d.removeEventListener("pointercancel", this.pointerUp);
    d.removeEventListener("wheel", this.wheel);
    cancelAnimationFrame(this.frame);
    clearTimeout(this.stopTimer);
  }

  /** Places the visitor (e.g. from the camera stored in the home). */
  setPose(pose: CameraPose): void {
    this.ground = null;
    this.stairTop = null;
    this.pose = { ...pose, pitch: THREE.MathUtils.clamp(pose.pitch, -MAX_PITCH, MAX_PITCH) };
    applyPose(this.camera, this.pose);
  }

  private changed(): void {
    applyPose(this.camera, this.pose);
    this.onChange(this.pose);
    clearTimeout(this.stopTimer);
    this.stopTimer = window.setTimeout(() => this.onStop(this.pose), 400);
  }

  private keyDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!MOVE_KEYS.has(k)) return;
    e.preventDefault();
    this.keys.add(k);
    if (e.shiftKey) this.keys.add("Shift");
    if (!this.frame) {
      this.last = performance.now();
      this.frame = requestAnimationFrame(this.tick);
    }
  };

  private keyUp = (e: KeyboardEvent) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.keys.delete(k);
    if (k === "Shift") this.keys.delete("Shift");
  };

  private blur = () => {
    this.keys.clear();
  };

  private tick = (now: number) => {
    this.frame = 0;
    if (!this.enabled || this.keys.size === 0) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const k = this.keys;
    const speed = walkSpeed() * (k.has("Shift") ? RUN_FACTOR : 1) * dt;
    let forward = 0;
    let side = 0;
    let up = 0;
    let turn = 0;
    if (k.has("w") || k.has("ArrowUp")) forward += 1;
    if (k.has("s") || k.has("ArrowDown")) forward -= 1;
    if (k.has("d")) side += 1;
    if (k.has("a")) side -= 1;
    if (k.has("ArrowRight")) turn += 1;
    if (k.has("ArrowLeft")) turn -= 1;
    if (k.has("e") || k.has("PageUp")) up += 1;
    if (k.has("q") || k.has("PageDown")) up -= 1;
    const p = this.pose;
    p.yaw += turn * TURN_SPEED * dt * (k.has("Shift") ? 2 : 1);
    if (forward || side) {
      // Plan direction of the view: (-sin yaw, cos yaw); right of it: (-cos yaw, -sin yaw)
      const len = Math.hypot(forward, side);
      const fx = -Math.sin(p.yaw);
      const fy = Math.cos(p.yaw);
      const dx = ((forward * fx - side * fy) / len) * speed;
      const dy = ((forward * fy + side * fx) / len) * speed;
      // The eyes keep their height above the floor or the steps the visitor stands on
      const ground = groundAt(
        this.colliders,
        [p.x, p.y],
        p.z,
        this.ground ?? floorUnder(this.colliders, p.z),
      );
      const eyeHeight = p.z - ground;
      const [x, y] = collide(this.colliders, [p.x, p.y], [p.x + dx, p.y + dy], p.z, ground);
      p.x = x;
      p.y = y;
      const next = groundAt(this.colliders, [x, y], p.z, ground);
      p.z = next + eyeHeight;
      this.ground = next;
      this.stairTop = stairTopAt(this.colliders, [x, y], next);
    }
    if (up) p.z = Math.max(10, p.z + up * speed);
    this.changed();
    this.frame = requestAnimationFrame(this.tick);
  };

  private pointerDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;
    this.dom.focus();
    this.dom.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY };
  };

  private pointerMove = (e: PointerEvent) => {
    if (!this.enabled || !this.drag) return;
    const dx = e.clientX - this.drag.x;
    const dy = e.clientY - this.drag.y;
    this.drag = { x: e.clientX, y: e.clientY };
    // Dragging right turns right (clockwise in the plan), moving the mouse up looks up
    this.pose.yaw += dx * LOOK_SENSITIVITY;
    this.pose.pitch = THREE.MathUtils.clamp(
      this.pose.pitch + dy * LOOK_SENSITIVITY,
      -MAX_PITCH,
      MAX_PITCH,
    );
    this.changed();
  };

  private pointerUp = (e: PointerEvent) => {
    if (!this.drag) return;
    this.drag = null;
    if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
  };

  private wheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.pose.fov = THREE.MathUtils.clamp(
      this.pose.fov * Math.exp(e.deltaY * 0.001),
      MIN_FOV,
      MAX_FOV,
    );
    this.changed();
  };
}

const MOVE_KEYS = new Set([
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Shift",
]);
