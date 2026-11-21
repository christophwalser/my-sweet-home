import { describe, expect, it } from "vitest";
import type { Pt } from "../model";
import { makePiece } from "../testFixtures";
import {
  coveredSize,
  isRoof,
  ROOF_PROPERTY,
  type RoofData,
  roofBase,
  roofHit,
  roofLines,
  roofOf,
  roofRectangle,
  roofTexture,
} from "./roof";

const GABLE: RoofData = {
  shape: "gable",
  turn: 0,
  outline: [
    [-500, -400],
    [500, -400],
    [500, 400],
    [-500, 400],
  ],
  edges: ["eave", "gable", "eave", "gable"],
  pitch: 45,
  overhang: 50,
  thickness: 20,
  color: "#8C4A3C",
  gableColor: "#F2F0EB",
  lowest: -78.28,
  size: [1100, 900],
  lines: [
    [-550, -450, 550, -450, "eave"],
    [550, 0, -550, 0, "ridge"],
  ],
};

function roofPiece(attrs: Record<string, unknown> = {}, data: RoofData = GABLE) {
  return makePiece(
    { id: "roof", x: 600, y: 500, width: 1100, depth: 900, height: 478.28, ...attrs },
    { properties: [{ name: ROOF_PROPERTY, value: JSON.stringify(data) }] },
  );
}

const rounded = (p: Pt): Pt => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

describe("roofOf", () => {
  it("reads the roof data of a piece", () => {
    const piece = roofPiece();
    expect(roofOf(piece)?.shape).toBe("gable");
    expect(isRoof(piece)).toBe(true);
  });

  it("takes other pieces and unreadable data as ordinary furniture", () => {
    expect(isRoof(makePiece({ id: "table" }))).toBe(false);
    const broken = makePiece(
      { id: "broken" },
      { properties: [{ name: ROOF_PROPERTY, value: "{not json" }] },
    );
    expect(roofOf(broken)).toBeNull();
    const partial = makePiece(
      { id: "partial" },
      { properties: [{ name: ROOF_PROPERTY, value: '{"shape":"hip"}' }] },
    );
    expect(roofOf(partial)).toBeNull();
  });
});

describe("roofLines", () => {
  it("moves the lines to the place of the piece", () => {
    const lines = roofLines(roofPiece(), GABLE);
    expect(lines[0]).toEqual({ a: [50, 50], b: [1150, 50], kind: "eave" });
    expect(lines[1]).toEqual({ a: [1150, 500], b: [50, 500], kind: "ridge" });
  });

  it("turns the lines with the piece", () => {
    const ridge = roofLines(roofPiece({ angle: Math.PI / 2 }), GABLE)[1];
    expect(rounded(ridge.a)).toEqual([600, 1050]);
    expect(rounded(ridge.b)).toEqual([600, -50]);
  });

  it("stretches and mirrors the lines with the piece", () => {
    const eave = roofLines(roofPiece({ width: 2200, model_mirrored: true }), GABLE)[0];
    expect(eave.a).toEqual([1700, 50]);
    expect(eave.b).toEqual([-500, 50]);
  });
});

describe("roofHit", () => {
  it("picks a roof by its lines only", () => {
    const piece = roofPiece();
    expect(roofHit(piece, GABLE, [400, 503], 5)).toBe(true);
    expect(roofHit(piece, GABLE, [400, 52], 5)).toBe(true);
    // Inside the roof, between the eave and the ridge
    expect(roofHit(piece, GABLE, [400, 300], 5)).toBe(false);
  });
});

describe("roof sizes", () => {
  it("gives the covered area without the overhang", () => {
    expect(coveredSize(GABLE)).toEqual([1000, 800]);
  });

  it("gives the height the roof starts at", () => {
    expect(roofBase(roofPiece({ elevation: 171.72 }), GABLE)).toBeCloseTo(250);
  });
});

describe("roofTexture", () => {
  it("finds the image among the files of the model", () => {
    const tiles = { name: "Tiles", catalogId: "tiles#1", file: "cover.jpg", width: 50, height: 25 };
    expect(roofTexture(roofPiece({ model: "7/roof.obj" }), tiles)).toEqual({
      role: null,
      name: "Tiles",
      image: "7/cover.jpg",
      width: 50,
      height: 25,
      angle: null,
      scale: null,
      catalog_id: "tiles#1",
    });
    expect(roofTexture(roofPiece({ model: "7/roof.obj" }), undefined)).toBeNull();
    expect(roofTexture(roofPiece(), tiles)).toBeNull();
  });
});

describe("roofRectangle", () => {
  it("makes a rectangle from two corners and a point on the other side", () => {
    expect(
      roofRectangle([
        [0, 0],
        [1000, 0],
        [300, 600],
      ]),
    ).toEqual([
      [0, 0],
      [1000, 0],
      [1000, 600],
      [0, 600],
    ]);
  });

  it("follows a slanted first side", () => {
    const corners = roofRectangle([
      [0, 0],
      [300, 400],
      [-400, 300],
    ]).map(rounded);
    expect(corners).toEqual([
      [0, 0],
      [300, 400],
      [-100, 700],
      [-400, 300],
    ]);
  });

  it("shows what is known so far", () => {
    expect(roofRectangle([[10, 20]])).toEqual([[10, 20]]);
    expect(
      roofRectangle([
        [0, 0],
        [100, 0],
      ]),
    ).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });
});
