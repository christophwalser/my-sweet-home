import { describe, expect, it } from "vitest";
import { makeHome, makePiece, makeRoom, makeWall } from "../testFixtures";
import { homeColors, parseHex } from "./homeColors";

describe("parseHex", () => {
  it("reads colors with and without #, short and long", () => {
    expect(parseHex("#AABBCC")).toBe("#aabbcc");
    expect(parseHex(" 336699 ")).toBe("#336699");
    expect(parseHex("#abc")).toBe("#aabbcc");
  });

  it("refuses anything else", () => {
    expect(parseHex("")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
    expect(parseHex("blue")).toBeNull();
  });
});

describe("homeColors", () => {
  it("lists the colors of walls, rooms and furniture, the most used first", () => {
    const home = makeHome({
      walls: [
        makeWall("a", [0, 0], [100, 0], { left_side_color: 0xff336699 }),
        makeWall("b", [0, 0], [0, 100], { right_side_color: 0xff336699, top_color: 0xff101010 }),
      ],
      rooms: [
        makeRoom(
          [
            [0, 0],
            [100, 0],
            [100, 100],
          ],
          { floor_color: 0xffaabbcc },
        ),
      ],
      furniture: [makePiece({ color: 0xffaabbcc }), makePiece({ id: "q", color: 0xff336699 })],
    });
    expect(homeColors(home)).toEqual(["#336699", "#aabbcc", "#101010"]);
  });

  it("is empty for a home without colors", () => {
    expect(homeColors(makeHome())).toEqual([]);
  });
});
