import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { gltfScene } from "./gltfExport";
import { buildObj } from "./objExport";

/** A 3D view content with a wall of 100 cm and a group that is not exported. */
function content(): THREE.Group {
  const root = new THREE.Group();
  const walls = new THREE.Group();
  walls.name = "walls";
  const box = new THREE.Mesh(new THREE.BoxGeometry(100, 250, 10), new THREE.MeshBasicMaterial());
  box.position.set(50, 125, 0);
  walls.add(box);
  const ground = new THREE.Group();
  ground.name = "ground";
  ground.add(new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshBasicMaterial()));
  root.add(walls, ground);
  return root;
}

function xs(obj: string): number[] {
  return obj
    .split("\n")
    .filter((l) => l.startsWith("v "))
    .map((l) => Number(l.split(" ")[1]));
}

describe("3D export", () => {
  it("writes OBJ in the chosen unit", () => {
    const cm = buildObj(content(), "home.mtl");
    expect(cm.obj).toContain("# Units: centimeters");
    expect(Math.max(...xs(cm.obj))).toBe(100);
    const m = buildObj(content(), "home.mtl", "m");
    expect(m.obj).toContain("# Units: meters");
    expect(Math.max(...xs(m.obj))).toBe(1);
    expect(Math.max(...xs(buildObj(content(), "home.mtl", "mm").obj))).toBe(1000);
    expect(Math.max(...xs(buildObj(content(), "home.mtl", "in").obj))).toBeCloseTo(39.37, 2);
  });

  it("puts copies of the exported groups under a root in meters", () => {
    const view = content();
    const root = gltfScene(view);
    expect(root.scale.x).toBe(0.01);
    expect(root.children.map((c) => c.name)).toEqual(["walls"]);
    // The 3D view keeps its groups
    expect(view.getObjectByName("walls")?.children.length).toBe(1);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    expect(box.max.x).toBeCloseTo(1, 6);
    expect(box.max.y).toBeCloseTo(2.5, 6);
  });
});
