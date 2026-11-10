import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildPivotMarker, fittedView, homeBox, orbitDistance, pickPoint } from "./pivot";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A group named like the walls of the scene with one box mesh from `min` to `max`. */
function walls(min: THREE.Vector3, max: THREE.Vector3): THREE.Group {
  const size = max.clone().sub(min);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z));
  mesh.position.copy(min.clone().add(max).multiplyScalar(0.5));
  const group = new THREE.Group();
  group.name = "walls";
  group.add(mesh);
  return group;
}

describe("homeBox", () => {
  it("counts walls and rooms but not the ground", () => {
    const content = new THREE.Group();
    content.add(walls(v(0, 0, 0), v(1000, 250, 800)));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(100000, 100000));
    ground.name = "ground";
    content.add(ground);
    content.updateMatrixWorld(true);
    const box = homeBox(content);
    expect(box.min.toArray()).toEqual([0, 0, 0]);
    expect(box.max.toArray()).toEqual([1000, 250, 800]);
  });

  it("is empty without walls and rooms", () => {
    expect(homeBox(new THREE.Group()).isEmpty()).toBe(true);
  });
});

describe("orbitDistance", () => {
  const box = new THREE.Box3(v(0, 0, 0), v(1000, 250, 1000));

  it("turns around the point of the view line nearest to the middle of the home", () => {
    // Looking along -z from in front of the home, at the height of its middle
    const eye = v(500, 125, 3000);
    expect(orbitDistance(eye, v(0, 0, -1), box)).toBeCloseTo(2500);
  });

  it("projects the middle onto a view line that passes beside it", () => {
    const eye = v(0, 1000, 3000);
    const dir = v(0, -0.6, -0.8);
    const toCenter = v(500, 125, 500).sub(eye).dot(dir);
    expect(orbitDistance(eye, dir, box)).toBeCloseTo(toCenter);
  });

  it("uses the ground when the home is behind the camera", () => {
    const eye = v(500, 1000, -3000);
    const dir = v(0, -0.6, -0.8);
    expect(orbitDistance(eye, dir, box)).toBeCloseTo(1000 / 0.6);
  });

  it("uses the ground without home and at most 5000 cm", () => {
    const empty = new THREE.Box3();
    expect(orbitDistance(v(0, 600, 0), v(0, -0.6, -0.8), empty)).toBeCloseTo(1000);
    expect(orbitDistance(v(0, 6000, 0), v(0, -0.6, -0.8), empty)).toBe(5000);
  });

  it("takes a point in front when the view does not reach the ground", () => {
    expect(orbitDistance(v(0, 170, 0), v(0, 0, -1), new THREE.Box3())).toBe(300);
  });
});

describe("fittedView", () => {
  it("looks at the middle of the home from the front and above by default", () => {
    const { position, target } = fittedView(new THREE.Box3(v(0, 0, 0), v(1000, 250, 800)));
    expect(target.toArray()).toEqual([500, 125, 400]);
    expect(position.x).toBeCloseTo(500);
    expect(position.y).toBeGreaterThan(target.y);
    expect(position.z).toBeGreaterThan(target.z);
  });

  it("keeps the given direction", () => {
    const dir = v(1, -1, 0).normalize();
    const { position, target } = fittedView(new THREE.Box3(v(0, 0, 0), v(1000, 250, 800)), dir);
    const looking = target.clone().sub(position).normalize();
    expect(looking.distanceTo(dir)).toBeLessThan(1e-6);
  });

  it("moves farther away from larger homes", () => {
    const small = fittedView(new THREE.Box3(v(0, 0, 0), v(600, 250, 600)));
    const large = fittedView(new THREE.Box3(v(0, 0, 0), v(3000, 250, 3000)));
    expect(large.position.distanceTo(large.target)).toBeGreaterThan(
      small.position.distanceTo(small.target),
    );
  });

  it("shows a default area without home", () => {
    const { target } = fittedView(new THREE.Box3());
    expect(target.toArray()).toEqual([250, 125, 250]);
  });
});

describe("buildPivotMarker", () => {
  const parts = (group: THREE.Group) => ({
    foot: group.children.find((o) => o instanceof THREE.Mesh) as THREE.Mesh,
    line: group.children.find((o) => o instanceof THREE.Line) as THREE.Line,
  });

  it("draws a line down to the ground and a ring there for a pivot in the air", () => {
    const m = buildPivotMarker();
    m.place(v(100, 80, -50), 1);
    const { foot, line } = parts(m.group);
    expect(line.visible && foot.visible).toBe(true);
    expect(foot.position.toArray()).toEqual([100, 0, -50]);
    const pos = line.geometry.attributes.position;
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([100, 80, -50]);
    expect([pos.getX(1), pos.getY(1), pos.getZ(1)]).toEqual([100, 0, -50]);
  });

  it("draws nothing extra for a pivot on the ground", () => {
    const m = buildPivotMarker();
    m.place(v(100, 3, -50), 1);
    const { foot, line } = parts(m.group);
    expect(line.visible || foot.visible).toBe(false);
  });

  it("stays hidden until the view shows it and keeps out of the shadows", () => {
    const m = buildPivotMarker();
    expect(m.group.visible).toBe(false);
    m.group.traverse((o) => {
      expect(o.castShadow).toBe(false);
    });
  });
});

describe("pickPoint", () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 100000);
  camera.position.set(0, 1000, 1000);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  it("returns the surface under the pointer", () => {
    const content = new THREE.Group();
    content.add(walls(v(-100, 0, -100), v(100, 200, 100)));
    content.updateMatrixWorld(true);
    const p = pickPoint(camera, new THREE.Vector2(0, 0), content, null, 0);
    expect(p).not.toBeNull();
    // The view line at 45° down hits the front face of the box, not the ground behind it
    expect(p?.z).toBeCloseTo(100);
    expect(p?.y).toBeCloseTo(100);
  });

  it("ignores the sky and hidden objects", () => {
    const content = new THREE.Group();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide }),
    );
    sky.position.copy(camera.position);
    const hidden = walls(v(-100, 0, -100), v(100, 200, 100));
    hidden.visible = false;
    content.add(sky, hidden);
    content.updateMatrixWorld(true);
    const p = pickPoint(camera, new THREE.Vector2(0, 0), content, sky, 0);
    // Falls back to the plane at height 0 in the middle of the view
    expect(p?.x).toBeCloseTo(0);
    expect(p?.y).toBeCloseTo(0);
    expect(p?.z).toBeCloseTo(0);
  });

  it("returns null above the horizon when nothing is hit", () => {
    const up = new THREE.PerspectiveCamera(60, 1, 1, 100000);
    up.position.set(0, 100, 0);
    up.lookAt(0, 200, -100);
    up.updateMatrixWorld(true);
    expect(pickPoint(up, new THREE.Vector2(0, 0), new THREE.Group(), null, 0)).toBeNull();
  });
});
