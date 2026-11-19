import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  clickSelection,
  clipMaterials,
  elementOf,
  isGround,
  keptBy,
  NO_SECTION,
  SelectionOutline,
  setSectionPlanes,
} from "./select3d";

function named(name: string, parent?: THREE.Object3D): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = name;
  parent?.add(o);
  return o;
}

describe("elementOf", () => {
  it("finds the element an object or one of its parents belongs to", () => {
    const piece = named("piece:chair1");
    const part = named("seat", named("model", piece));
    expect(elementOf(part)).toEqual({ id: "chair1", kind: "furniture" });
    expect(elementOf(named("wall:w1"))).toEqual({ id: "w1", kind: "wall" });
    expect(elementOf(named("baseboard:w1:left"))).toEqual({ id: "w1", kind: "wall" });
    expect(elementOf(named("floor:r1"))).toEqual({ id: "r1", kind: "room" });
    expect(elementOf(named("ceiling:r1"))).toEqual({ id: "r1", kind: "room" });
  });

  it("knows no element for the ground, the sky and annotations", () => {
    expect(elementOf(named("ground"))).toBeNull();
    expect(elementOf(named("text", named("annotations")))).toBeNull();
    expect(elementOf(named("floor:"))).toBeNull();
    expect(isGround(named("ground"))).toBe(true);
    expect(isGround(named("sky"))).toBe(false);
  });
});

describe("clickSelection", () => {
  it("selects the clicked element alone", () => {
    expect(clickSelection(["a", "b"], "c", false)).toEqual(["c"]);
  });
  it("clears on a click on nothing", () => {
    expect(clickSelection(["a"], null, false)).toEqual([]);
  });
  it("adds and removes with Ctrl or Shift", () => {
    expect(clickSelection(["a"], "b", true)).toEqual(["a", "b"]);
    expect(clickSelection(["a", "b"], "a", true)).toEqual(["b"]);
    // A click on nothing keeps what is selected
    expect(clickSelection(["a"], null, true)).toEqual(["a"]);
  });
});

describe("section planes", () => {
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 100), new THREE.Vector3(400, 250, 300));
  const planes = (): [THREE.Plane, THREE.Plane] => [new THREE.Plane(), new THREE.Plane()];

  it("cuts nothing without a section", () => {
    const p = planes();
    expect(setSectionPlanes(p, NO_SECTION, box)).toBe(false);
    expect(keptBy(p, new THREE.Vector3(1e6, 1e6, 1e6))).toBe(true);
  });

  it("cuts away what is above the height", () => {
    const p = planes();
    expect(setSectionPlanes(p, { horizontal: 120, vertical: null }, box)).toBe(true);
    expect(keptBy(p, new THREE.Vector3(50, 119, 200))).toBe(true);
    expect(keptBy(p, new THREE.Vector3(50, 121, 200))).toBe(false);
  });

  it("cuts away a share of the home from a side", () => {
    const p = planes();
    // A quarter from the front (bottom of the plan, +z): z from 250 to 300 is gone
    setSectionPlanes(p, { horizontal: null, vertical: { side: "front", position: 0.25 } }, box);
    expect(keptBy(p, new THREE.Vector3(10, 10, 249))).toBe(true);
    expect(keptBy(p, new THREE.Vector3(10, 10, 251))).toBe(false);
    // Half from the left (-x): x below 200 is gone
    setSectionPlanes(p, { horizontal: null, vertical: { side: "left", position: 0.5 } }, box);
    expect(keptBy(p, new THREE.Vector3(199, 10, 200))).toBe(false);
    expect(keptBy(p, new THREE.Vector3(201, 10, 200))).toBe(true);
    // From the back (-z) and the right (+x)
    setSectionPlanes(p, { horizontal: null, vertical: { side: "back", position: 0.5 } }, box);
    expect(keptBy(p, new THREE.Vector3(10, 10, 150))).toBe(false);
    setSectionPlanes(p, { horizontal: null, vertical: { side: "right", position: 0.25 } }, box);
    expect(keptBy(p, new THREE.Vector3(350, 10, 200))).toBe(false);
    expect(keptBy(p, new THREE.Vector3(250, 10, 200))).toBe(true);
  });

  it("gives materials the planes once and takes them away again", () => {
    const material = new THREE.MeshBasicMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
    const p = planes();
    const before = material.version;
    clipMaterials(root, p);
    expect(material.clippingPlanes).toBe(p);
    expect(material.clipShadows).toBe(true);
    expect(material.version).toBe(before + 1);
    // The same planes again: nothing to compile
    clipMaterials(root, p);
    expect(material.version).toBe(before + 1);
    clipMaterials(root, null);
    expect(material.clippingPlanes).toBeNull();
  });
});

describe("SelectionOutline", () => {
  it("outlines a piece with a box of its size at its place", () => {
    const outline = new SelectionOutline();
    expect(outline.empty).toBe(true);
    const piece = new THREE.Group();
    piece.position.set(100, 40, 200);
    outline.addBox(piece, 60, 80, 50);
    expect(outline.empty).toBe(false);
    const box = outline.bounds();
    expect(box.min.toArray()).toEqual([70, 0, 175]);
    expect(box.max.toArray()).toEqual([130, 80, 225]);
    outline.clear();
    expect(outline.empty).toBe(true);
    expect(outline.bounds().isEmpty()).toBe(true);
    outline.dispose();
  });

  it("outlines the edges of a mesh where the mesh is", () => {
    const outline = new SelectionOutline();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 30));
    mesh.position.set(5, 10, 15);
    outline.addEdges(mesh);
    const box = outline.bounds();
    expect(box.min.toArray()).toEqual([0, 0, 0]);
    expect(box.max.toArray()).toEqual([10, 20, 30]);
    outline.dispose();
  });
});
