import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  northOnScreen,
  parallelHalfHeight,
  perspectiveDistance,
  STANDARD_VIEWS,
  viewDirection,
} from "./standardViews";

const close = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 3);
  expect(v.y).toBeCloseTo(y, 3);
  expect(v.z).toBeCloseTo(z, 3);
};

describe("viewDirection", () => {
  it("looks from the named side towards the home", () => {
    // North is up in the plan (-z in the scene): from the north the view looks south (+z)
    close(viewDirection("north", 0), 0, 0, 1);
    close(viewDirection("south", 0), 0, 0, -1);
    close(viewDirection("east", 0), -1, 0, 0);
    close(viewDirection("west", 0), 1, 0, 0);
  });

  it("looks down in the top view, with north up on the screen", () => {
    const d = viewDirection("top", 0);
    expect(d.y).toBeLessThan(-0.999);
    // A hair towards the north, so the camera is south of the vertical
    expect(d.z).toBeLessThan(0);
    expect(Math.abs(d.x)).toBeLessThan(1e-9);
  });

  it("gives isometric views the same angle to all three axes", () => {
    const d = viewDirection("isoNE", 0);
    expect(Math.abs(d.x)).toBeCloseTo(Math.abs(d.y), 6);
    expect(Math.abs(d.y)).toBeCloseTo(Math.abs(d.z), 6);
    // From the northeast and above: towards the west, the south and down
    expect(d.x).toBeLessThan(0);
    expect(d.z).toBeGreaterThan(0);
    expect(d.y).toBeLessThan(0);
  });

  it("follows the north direction of the compass", () => {
    // North points to the right of the plan: from the north the view looks to the left
    close(viewDirection("north", Math.PI / 2), -1, 0, 0);
  });

  it("is normalized for every view", () => {
    for (const view of STANDARD_VIEWS) {
      expect(viewDirection(view, 0.4).length()).toBeCloseTo(1, 9);
    }
  });
});

describe("parallel projection", () => {
  it("shows the same height at the pivot as the perspective view", () => {
    const half = parallelHalfHeight(1000, 60);
    expect(half).toBeCloseTo(1000 * Math.tan(Math.PI / 6), 6);
    expect(perspectiveDistance(half, 60)).toBeCloseTo(1000, 6);
  });
});

describe("northOnScreen", () => {
  const right = new THREE.Vector3(1, 0, 0);
  it("points up when the view looks down with north up", () => {
    // Top view: the up axis of the screen is north (-z)
    expect(northOnScreen(right, new THREE.Vector3(0, 0, -1), 0)).toBeCloseTo(0, 9);
  });

  it("turns with the compass", () => {
    // North to the right of the plan: the arrow points right (90° clockwise)
    expect(northOnScreen(right, new THREE.Vector3(0, 0, -1), Math.PI / 2)).toBeCloseTo(
      Math.PI / 2,
      9,
    );
  });

  it("turns against the view", () => {
    // The view was turned so that east is up: north is to the left
    const angle = northOnScreen(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), 0);
    expect(angle).toBeCloseTo(-Math.PI / 2, 9);
  });
});
