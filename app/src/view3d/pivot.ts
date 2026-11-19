// Point the aerial view turns around (the target of OrbitControls): where it starts, how it
// is fitted to the home and how a double-click moves it to a point of the scene.

import * as THREE from "three";

/** Bounds of the walls and rooms (the ground and the sky are huge and must not count). */
export function homeBox(content: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  for (const child of content.children) {
    if (child.name === "walls" || child.name === "rooms") box.expandByObject(child);
  }
  return box;
}

/**
 * Distance along the view direction to the point the view turns around: the point of the
 * view line nearest to the middle of the home, else where the view hits the ground, else a
 * point in front. `dir` is normalized; the eye is at `eye` (y up).
 */
export function orbitDistance(eye: THREE.Vector3, dir: THREE.Vector3, box: THREE.Box3): number {
  if (!box.isEmpty()) {
    const toCenter = box.getCenter(new THREE.Vector3()).sub(eye).dot(dir);
    if (toCenter >= 100) return toCenter;
  }
  return dir.y < -0.05 ? Math.min(eye.y / -dir.y, 5000) : 300;
}

/** Default direction of a fitted view: from the front, looking down at about 41°. */
const FIT_DIRECTION = new THREE.Vector3(0, -0.7, -0.8).normalize();

/**
 * Camera position and target that show the whole home (`box`) and turn around its middle,
 * looking along `dir` (normalized; default from the front and above). A box smaller than
 * `minSize` is shown as if it had that size.
 */
export function fittedView(
  box: THREE.Box3,
  dir: THREE.Vector3 = FIT_DIRECTION,
  minSize = 500,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const b = box.isEmpty()
    ? new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(500, 250, 500))
    : box;
  const target = b.getCenter(new THREE.Vector3());
  const distance = Math.max(b.getSize(new THREE.Vector3()).length(), minSize) * 1.063;
  const position = target.clone().addScaledVector(dir, -distance);
  return { position, target };
}

/**
 * Marker of the pivot in the scene (the crosshair over the view marks the pivot itself):
 * when it is above or below the ground, a dashed line down (or up) to the ground and a ring
 * there. Drawn over everything. `place(target, pixel)` moves it; `pixel` is the size of a
 * screen pixel at the target.
 */
export function buildPivotMarker(): {
  group: THREE.Group;
  place: (target: THREE.Vector3, pixel: number) => void;
} {
  const material = () => ({
    color: 0xffffff,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const ringGeometry = new THREE.RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2);
  const ringMaterial = new THREE.MeshBasicMaterial({ ...material(), side: THREE.DoubleSide });
  const foot = new THREE.Mesh(ringGeometry, ringMaterial);
  const lineGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const line = new THREE.Line(
    lineGeometry,
    new THREE.LineDashedMaterial({ ...material(), dashSize: 1, gapSize: 1 }),
  );
  const group = new THREE.Group();
  group.name = "pivot";
  group.add(foot, line);
  group.visible = false;
  group.traverse((o) => {
    o.renderOrder = 1000;
  });
  const place = (target: THREE.Vector3, pixel: number) => {
    const radius = 6 * pixel;
    const aboveGround = Math.abs(target.y) > 2 * radius;
    foot.visible = aboveGround;
    line.visible = aboveGround;
    if (!aboveGround) return;
    foot.position.set(target.x, 0, target.z);
    foot.scale.setScalar(radius);
    lineGeometry.attributes.position.setXYZ(0, target.x, target.y, target.z);
    lineGeometry.attributes.position.setXYZ(1, target.x, 0, target.z);
    lineGeometry.attributes.position.needsUpdate = true;
    lineGeometry.computeBoundingSphere();
    line.computeLineDistances();
    const dashes = line.material as THREE.LineDashedMaterial;
    dashes.dashSize = 6 * pixel;
    dashes.gapSize = 4 * pixel;
  };
  return { group, place };
}

/** Whether an object is drawn: itself and all its parents visible, and not part of `skip`. */
export function drawn(object: THREE.Object3D, skip: THREE.Object3D | null): boolean {
  for (let o: THREE.Object3D | null = object; o; o = o.parent) {
    if (!o.visible || o === skip) return false;
  }
  return true;
}

/**
 * The point of the scene under the pointer (`ndc`: -1..1, y up): the nearest drawn surface
 * except the sky, else the point on the horizontal plane at `fallbackHeight`. Null when the
 * pointer looks above the horizon at nothing. Surfaces cut away by the section `planes` do
 * not count.
 */
export function pickPoint(
  camera: THREE.Camera,
  ndc: THREE.Vector2,
  content: THREE.Object3D,
  sky: THREE.Object3D | null,
  fallbackHeight: number,
  planes: readonly THREE.Plane[] = [],
): THREE.Vector3 | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster
    .intersectObject(content, true)
    .find((h) => drawn(h.object, sky) && planes.every((p) => p.distanceToPoint(h.point) >= 0));
  if (hit) return hit.point.clone();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -fallbackHeight);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
}
