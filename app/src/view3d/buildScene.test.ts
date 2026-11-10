import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Home, OpenedHome } from "../model";
import { makeHome, makePiece, makeWall, straightShape } from "../testFixtures";
import {
  buildWalls,
  levelInfos,
  surfaceMaterial,
  visibleLevels,
  WallGeometryCache,
} from "./buildScene";
import { disposeObject } from "./models";

const door = (x: number) =>
  makePiece({ id: "door", x, y: 0, width: 90, depth: 20, height: 210 }, { kind: "DoorOrWindow" });

/** Two walls at a corner, a door in the first one and a table in the room. */
const home = (doorX = 200, tableX = 100): Home =>
  makeHome({
    walls: [
      makeWall("w1", [0, 0], [400, 0], { thickness: 20 }),
      makeWall("w2", [400, 0], [400, 300], { thickness: 20 }),
    ],
    furniture: [door(doorX), makePiece({ id: "table", x: tableX, y: 150 })],
  });

const opened = (h: Home): OpenedHome => ({
  id: 1,
  path: null,
  home: h,
  wallShapes: h.walls.map(straightShape),
  modified: false,
  canUndo: false,
  canRedo: false,
  cameraMoves: 0,
});

const build = (h: Home, cache?: WallGeometryCache) => {
  const group = buildWalls(opened(h), levelInfos(h), visibleLevels(h, null), () => {}, cache);
  cache?.commit();
  const geometry = (name: string) =>
    (group.getObjectByName(name) as THREE.Mesh).geometry as THREE.BufferGeometry;
  return { group, w1: geometry("wall:w1"), w2: geometry("wall:w2") };
};

const positions = (g: THREE.BufferGeometry) => Array.from(g.getAttribute("position").array);

describe("WallGeometryCache", () => {
  it("builds the same walls as without cache", () => {
    const plain = build(home());
    const cached = build(home(), new WallGeometryCache());
    expect(positions(cached.w1)).toEqual(positions(plain.w1));
    expect(cached.w1.groups).toEqual(plain.w1.groups);
    expect(positions(cached.w2)).toEqual(positions(plain.w2));
    // The door opening is cut: more triangles than the closed second wall
    expect(cached.w1.getAttribute("position").count).toBeGreaterThan(
      cached.w2.getAttribute("position").count,
    );
  });

  it("reuses all walls when only other furniture changed", () => {
    const cache = new WallGeometryCache();
    const first = build(home(200, 100), cache);
    const built = cache.built;
    const second = build(home(200, 180), cache);
    expect(cache.built).toBe(built);
    expect(second.w1).toBe(first.w1);
    expect(second.w2).toBe(first.w2);
  });

  it("cuts again only the wall whose opening moved, and frees its old geometry", () => {
    const cache = new WallGeometryCache();
    const first = build(home(200), cache);
    let freed = false;
    first.w1.addEventListener("dispose", () => {
      freed = true;
    });
    const built = cache.built;
    const second = build(home(250), cache);
    expect(cache.built).toBe(built + 1);
    expect(second.w1).not.toBe(first.w1);
    expect(second.w2).toBe(first.w2);
    expect(freed).toBe(true);
    expect(positions(second.w1)).toEqual(positions(build(home(250)).w1));
  });

  it("owns its geometries: disposing the scene leaves them, clear frees them", () => {
    const cache = new WallGeometryCache();
    const { group, w1 } = build(home(), cache);
    let freed = false;
    w1.addEventListener("dispose", () => {
      freed = true;
    });
    disposeObject(group);
    expect(freed).toBe(false);
    cache.clear();
    expect(freed).toBe(true);
  });
});

describe("surfaceMaterial", () => {
  it("is matt without shininess and has a highlight when shiny", () => {
    expect(surfaceMaterial({ color: 0xff0000 }, null).type).toBe("MeshLambertMaterial");
    expect(surfaceMaterial({ color: 0xff0000 }, 0).type).toBe("MeshLambertMaterial");
    const shiny = surfaceMaterial({ color: 0xff0000 }, 0.25) as THREE.MeshPhongMaterial;
    expect(shiny.type).toBe("MeshPhongMaterial");
    expect(shiny.shininess).toBe(32);
    expect(shiny.color.getHex()).toBe(0xff0000);
  });
});
