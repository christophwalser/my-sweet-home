import { describe, expect, it } from "vitest";
import { makePiece } from "../testFixtures";
import {
  climbAngle,
  isOpening,
  OPENING_PROPERTY,
  type OpeningData,
  openingOf,
  openingOutline,
  placedFootprint,
  STAIR_PROPERTY,
  type StairData,
  stairOf,
  stairStart,
  stairSymbol,
  warningText,
} from "./stair";

const stair: StairData = {
  shape: "straight",
  turn: "right",
  style: "solid",
  rails: "both",
  width: 100,
  rise: 270,
  risers: 15,
  tread: 27,
  gap: 10,
  diameter: 200,
  column: 10,
  thickness: 5,
  color: "#C8A27A",
  frameColor: "#4A4A4A",
  start: [0, 189],
  flights: [14],
  size: [100, 378],
  lines: [[-50, 189, 50, 189]],
  walk: [
    [0, 189],
    [0, -189],
  ],
  warnings: [],
};

function stairPiece(attrs: Record<string, unknown> = {}) {
  return makePiece(
    { x: 500, y: 300, width: 100, depth: 378, ...attrs },
    { properties: [{ name: STAIR_PROPERTY, value: JSON.stringify(stair) }] },
  );
}

function close(a: number[], b: number[]): void {
  a.forEach((v, i) => {
    expect(v).toBeCloseTo(b[i], 6);
  });
}

describe("stairs in the plan", () => {
  it("reads the stair data of a piece", () => {
    const p = stairPiece();
    expect(stairOf(p)?.risers).toBe(15);
    expect(stairOf(makePiece({}))).toBeNull();
    const broken = makePiece({}, { properties: [{ name: STAIR_PROPERTY, value: "{" }] });
    expect(stairOf(broken)).toBeNull();
  });

  it("places the lines and the start with the piece", () => {
    const p = stairPiece({ angle: Math.PI / 2 });
    const { lines, walk } = stairSymbol(p, stair);
    // Turned by a quarter: the front edge runs up and down, at the left of the middle
    close(lines[0][0], [500 - 189, 300 - 50]);
    close(lines[0][1], [500 - 189, 300 + 50]);
    close(walk[1], [500 + 189, 300]);
    close(stairStart(p, stair), [500 - 189, 300]);
  });

  it("works out the angle and the preview of a stair from two clicks", () => {
    expect(climbAngle([0, 0], [0, -10])).toBeCloseTo(0, 6);
    expect(climbAngle([0, 0], [10, 0])).toBeCloseTo(90, 6);
    expect(Math.abs(climbAngle([0, 0], [0, 10]))).toBeCloseTo(180, 6);
    const footprint: [number, number][] = [
      [-50, 0],
      [50, 0],
      [50, -300],
      [-50, -300],
    ];
    // Climbing to the right from (100, 100)
    const placed = placedFootprint(footprint, [100, 100], [200, 100]);
    close(placed[0], [100, 50]);
    close(placed[2], [400, 150]);
  });

  it("says which check a stair fails", () => {
    expect(warningText({ kind: "step_rule", value: 55.29 })).toBe(
      "Step rule 2 × riser + tread = 55.3 cm: outside 59–65 cm",
    );
    expect(warningText({ kind: "headroom", value: 160 })).toContain("160 cm");
  });
});

describe("floor openings in the plan", () => {
  const data: OpeningData = {
    outline: [
      [-100, -50],
      [100, -50],
      [100, 50],
      [-100, 50],
    ],
  };
  const opening = (attrs: Record<string, unknown> = {}) =>
    makePiece(
      { x: 300, y: 200, width: 200, depth: 100, ...attrs },
      { properties: [{ name: OPENING_PROPERTY, value: JSON.stringify(data) }] },
    );

  it("reads the outline and follows the piece", () => {
    const p = opening();
    expect(isOpening(p)).toBe(true);
    expect(isOpening(stairPiece())).toBe(false);
    const outline = openingOutline(p, openingOf(p) ?? data);
    close(outline[0], [200, 150]);
    close(outline[2], [400, 250]);
    // Stretched by another program: the outline follows the size of the piece
    const wide = opening({ width: 400 });
    close(openingOutline(wide, data)[1], [500, 150]);
  });
});
