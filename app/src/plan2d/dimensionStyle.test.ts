import { describe, expect, it } from "vitest";
import type { DimensionLine, Home, Label } from "../model";
import {
  type CalcSide,
  CHAIN_PROPERTY,
  chainDims,
  chainIds,
  chainOf,
  DEFAULT_STYLE,
  DIMENSION_STYLE_PROPERTY,
  type DimensionStyle,
  dimensionStyle,
  ELEVATION_MARK_PROPERTY,
  elevationMarkOf,
  formatDimension,
  hasDimensionStyle,
  selectedChain,
} from "./dimensionStyle";

function line(id: string, chain?: object): DimensionLine {
  return {
    attrs: { id },
    ...(chain && { properties: [{ name: CHAIN_PROPERTY, value: JSON.stringify(chain) }] }),
  } as unknown as DimensionLine;
}

// The same cases as in crates/msh-export/src/dimension.rs
describe("lengths of dimensions", () => {
  const style = (s: Partial<DimensionStyle>) => ({ ...DEFAULT_STYLE, ...s });

  it("writes every unit", () => {
    expect(formatDimension(88.5, style({ unit: "mm" }))).toBe("885 mm");
    expect(formatDimension(88.55, style({ unit: "cm" }))).toBe("88.6 cm");
    expect(formatDimension(201, style({ unit: "m" }))).toBe("2.01 m");
    expect(
      formatDimension(201.25, style({ unit: "m", decimals: 3, comma: true, showUnit: false })),
    ).toBe("2,013");
  });

  it("raises the millimeters for DIN 1356", () => {
    const din = style({ unit: "din", comma: true });
    expect(formatDimension(88.5, din)).toBe("88⁵");
    expect(formatDimension(11.5, din)).toBe("11⁵");
    expect(formatDimension(24, din)).toBe("24");
    expect(formatDimension(99.96, din)).toBe("1,00");
    expect(formatDimension(201, din)).toBe("2,01");
    expect(formatDimension(1036.5, din)).toBe("10,36⁵");
  });
});

describe("the dimension style of a home", () => {
  it("is read from its property, else the default", () => {
    const home = (value?: string) =>
      ({
        properties: value ? [{ name: DIMENSION_STYLE_PROPERTY, value }] : [],
      }) as unknown as Home;
    expect(dimensionStyle(home())).toEqual(DEFAULT_STYLE);
    expect(hasDimensionStyle(home())).toBe(false);
    const own = home('{"unit":"din","comma":true}');
    expect(dimensionStyle(own)).toEqual({ ...DEFAULT_STYLE, unit: "din", comma: true });
    expect(hasDimensionStyle(own)).toBe(true);
    expect(dimensionStyle(home("{"))).toEqual(DEFAULT_STYLE);
  });
});

describe("dimension chains", () => {
  const chain = { id: "c1", wall: "w", side: "left", distance: 60, spacing: 45 };
  const home = {
    dimension_lines: [
      line("a", chain),
      line("b", chain),
      line("c"),
      line("d", { ...chain, id: "c2" }),
    ],
  } as unknown as Home;

  it("finds the lines of a chain", () => {
    expect(chainOf(home.dimension_lines[0])?.wall).toBe("w");
    expect(chainOf(home.dimension_lines[2])).toBeNull();
    expect(chainIds(home, "c1")).toEqual(["a", "b"]);
    expect(selectedChain(home, ["a", "b"])?.id).toBe("c1");
    expect(selectedChain(home, ["a", "d"])).toBeNull();
    expect(selectedChain(home, ["a", "c"])).toBeNull();
    expect(selectedChain(home, [])).toBeNull();
  });

  it("previews its rows at their distances", () => {
    const side: CalcSide = {
      sign: -1,
      rows: [
        {
          kind: "openings",
          points: [
            [0, 0],
            [100, 0],
            [300, 0],
          ],
        },
        {
          kind: "total",
          points: [
            [0, 0],
            [300, 0],
          ],
        },
      ],
    };
    expect(chainDims(side, 50, 40)).toEqual([
      { start: [0, 0], end: [100, 0], offset: -50 },
      { start: [100, 0], end: [300, 0], offset: -50 },
      { start: [0, 0], end: [300, 0], offset: -90 },
    ]);
  });
});

describe("elevation marks", () => {
  it("are labels with a property", () => {
    const label = (value?: string) =>
      ({
        properties: value ? [{ name: ELEVATION_MARK_PROPERTY, value }] : [],
      }) as unknown as Label;
    expect(elevationMarkOf(label('{"height":-12,"kind":"raw"}'))).toEqual({
      height: -12,
      kind: "raw",
    });
    expect(elevationMarkOf(label('{"height":5}'))?.kind).toBe("finished");
    expect(elevationMarkOf(label())).toBeNull();
    expect(elevationMarkOf(label("[]"))).toBeNull();
  });
});
