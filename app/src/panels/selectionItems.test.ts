import { describe, expect, it } from "vitest";
import { makeHome, makePiece, makeRoom, makeWall } from "../testFixtures";
import { selectionItems } from "./selectionItems";

describe("selectionItems", () => {
  it("names the selected elements in selection order", () => {
    const home = makeHome({
      walls: [makeWall("w1", [0, 0], [300, 0])],
      rooms: [
        makeRoom(
          [
            [0, 0],
            [100, 0],
            [100, 100],
          ],
          { id: "r1", name: "Kitchen" },
        ),
      ],
      furniture: [
        makePiece({ id: "p1", name: "Sofa" }),
        makePiece({ id: "d1", name: "Door" }, { kind: "DoorOrWindow" }),
      ],
    });
    const items = selectionItems(home, ["d1", "w1", "r1", "p1", "observer", "x"], "observer");
    expect(items.map((i) => [i.id, i.kind, i.name])).toEqual([
      ["d1", "Door or window", "Door"],
      ["w1", "Wall", "300 cm"],
      ["r1", "Room", "Kitchen"],
      ["p1", "Furniture", "Sofa"],
      ["observer", "Visitor", ""],
      ["x", "Element", "x"],
    ]);
  });
});
