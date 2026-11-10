// Pure helpers of the 3D view: levels, cameras, lenses and baseboards.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { Wall } from "../model";
import { makeHome, makeLevel, makeWall, roundPt, straightShape } from "../testFixtures";
import { colorOf, levelInfos, visibleLevels } from "./buildScene";
import { applyPose, cameraDirection, cameraPose, verticalFov } from "./camera";
import { isWideLens, panoramaSize } from "./lens";
import { baseboardOf, baseboardPolygon } from "./wallSides";

describe("levelInfos", () => {
  it("describes a home without levels under the null key", () => {
    const infos = levelInfos(makeHome({ attrs: { ...makeHome().attrs, wall_height: null } }));
    expect(infos.get(null)).toEqual({ elevation: 0, height: 250, floorThickness: 12 });
  });

  it("describes every level", () => {
    const infos = levelInfos(makeHome({ levels: [makeLevel("up", 300, { floor_thickness: 20 })] }));
    expect(infos.get("up")).toEqual({ elevation: 300, height: 250, floorThickness: 20 });
    expect(infos.size).toBe(2);
  });
});

describe("visibleLevels", () => {
  const levels = [makeLevel("ground", 0), makeLevel("first", 250), makeLevel("roof", 500)];

  it("shows the home itself without levels", () => {
    expect([...visibleLevels(makeHome(), null)]).toEqual([null]);
  });

  it("shows the selected level and the levels below it", () => {
    expect([...visibleLevels(makeHome({ levels }), "first")]).toEqual(["ground", "first"]);
  });

  it("shows all levels for an unknown selection or with all levels visible", () => {
    expect(visibleLevels(makeHome({ levels }), "nope").size).toBe(3);
    const environment = {
      attrs: {
        ground_color: null,
        sky_color: null,
        light_color: null,
        walls_alpha: null,
        all_levels_visible: true,
        ceiling_light_color: null,
      },
      textures: [],
    };
    expect(visibleLevels(makeHome({ levels, environment }), "ground").size).toBe(3);
  });

  it("hides levels the user made unviewable", () => {
    const hidden = [...levels.slice(0, 2), makeLevel("roof", 500, { viewable: false })];
    expect(visibleLevels(makeHome({ levels: hidden }), "roof").has("roof")).toBe(false);
  });
});

describe("colorOf", () => {
  it("reads the RGB part of an ARGB color", () => {
    expect(colorOf(0xff00ff00, 0).getHex()).toBe(0x00ff00);
  });

  it("uses the fallback without a color", () => {
    expect(colorOf(null, 0x123456).getHex()).toBe(0x123456);
  });
});

describe("cameras", () => {
  it("looks along +z (plan +y) at yaw 0 and down with a positive pitch", () => {
    const ahead = cameraDirection(0, 0);
    expect([ahead.x + 0, ahead.y + 0, ahead.z]).toEqual([0, 0, 1]);
    const down = cameraDirection(0, Math.PI / 2);
    expect(down.y).toBeCloseTo(-1);
  });

  it("turns with the yaw", () => {
    const d = cameraDirection(Math.PI / 2, 0);
    expect(d.x).toBeCloseTo(-1);
    expect(d.z).toBeCloseTo(0);
  });

  it("converts the horizontal field of view to the vertical one", () => {
    expect(verticalFov(Math.PI / 2, 1)).toBeCloseTo(90);
    expect(verticalFov(Math.PI / 2, 2)).toBeCloseTo((2 * Math.atan(0.5) * 180) / Math.PI);
  });

  it("gets back the pose it applied", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9);
    const pose = { x: 120, y: -40, z: 170, yaw: 0.7, pitch: 0.2, fov: 1.1 };
    applyPose(camera, pose);
    const back = cameraPose(camera, pose.fov);
    expect(back.x).toBeCloseTo(pose.x);
    expect(back.y).toBeCloseTo(pose.y);
    expect(back.z).toBeCloseTo(pose.z);
    expect(back.yaw).toBeCloseTo(pose.yaw);
    expect(back.pitch).toBeCloseTo(pose.pitch);
    expect(camera.fov).toBeCloseTo(verticalFov(pose.fov, 16 / 9));
  });
});

describe("lenses", () => {
  it("needs a panorama only for fisheye and spherical lenses", () => {
    expect(isWideLens("fisheye")).toBe(true);
    expect(isWideLens("spherical")).toBe(true);
    expect(isWideLens("normal")).toBe(false);
    expect(isWideLens(undefined)).toBe(false);
  });

  it("sizes the panorama 2:1 within limits", () => {
    expect(panoramaSize("spherical", 1600, 800)).toEqual({ width: 1600, height: 800 });
    expect(panoramaSize("fisheye", 1000, 800)).toEqual({ width: 2000, height: 1000 });
    expect(panoramaSize("spherical", 100, 50)).toEqual({ width: 512, height: 256 });
    expect(panoramaSize("fisheye", 10000, 100)).toEqual({ width: 8192, height: 4096 });
  });
});

describe("baseboards", () => {
  const wall: Wall = {
    ...makeWall("w", [0, 0], [100, 0]),
    baseboards: [
      {
        attrs: { role: "rightSideBaseboard", thickness: 1, height: 10, color: null },
        texture: null,
      },
    ],
  };

  it("finds the baseboard of a side", () => {
    expect(baseboardOf(wall, "right")?.attrs.height).toBe(10);
    expect(baseboardOf(wall, "left")).toBeUndefined();
    expect(baseboardOf(makeWall("x", [0, 0], [1, 0]), "left")).toBeUndefined();
  });

  it("offsets a straight side outward by the thickness", () => {
    const result = baseboardPolygon(straightShape(wall), "left", 2);
    expect(result?.outer.map((p) => roundPt(p))).toEqual([
      [0, -7],
      [100, -7],
    ]);
    expect(result?.poly).toHaveLength(4);
    const right = baseboardPolygon(straightShape(wall), "right", 2);
    expect(right?.outer.map((p) => roundPt(p))).toEqual([
      [0, 7],
      [100, 7],
    ]);
  });

  it("has no polygon for degenerate sides", () => {
    expect(baseboardPolygon({ id: "w", left: [[0, 0]], right: [[0, 1]] }, "left", 2)).toBeNull();
    const zero = {
      id: "w",
      left: [[0, 0] as [number, number], [0, 0] as [number, number]],
      right: [[0, 1] as [number, number], [0, 1] as [number, number]],
    };
    expect(baseboardPolygon(zero, "left", 2)).toBeNull();
  });
});
