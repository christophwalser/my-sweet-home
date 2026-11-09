// Distances of a door or window to its neighbors in the wall (wall corners or other openings),
// shown and edited in the properties panel.

import { t } from "../i18n";
import type { Piece } from "../model";
import { centerInWall, shiftInWall, wallSlot } from "../plan2d/moving";
import { useStore } from "../store";
import { Field } from "./fields";

export default function OpeningDistances({ piece }: { piece: Piece }) {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  if (!opened) return null;
  const a = piece.attrs;
  const levelId = opened.home.levels.length ? a.level : null;
  const slot = wallSlot(opened.home, opened.wallShapes, levelId, piece, [a.x, a.y], 0.5);
  if (!slot) return null;
  const w = a.width;
  const before = slot.t - w / 2 - slot.prev;
  const after = slot.next - (slot.t + w / 2);
  // Name the sides as they appear in the plan
  const horizontal = Math.abs(slot.u[0]) >= Math.abs(slot.u[1]);
  const forward = horizontal ? slot.u[0] > 0 : slot.u[1] > 0;
  const [first, second] = horizontal ? ["left", "right"] : ["top", "bottom"];
  const beforeName = forward ? first : second;
  const afterName = forward ? second : first;
  const move = (t: number) => {
    // Keeps the position across the wall (centered or flush with a wall side)
    const [x, y] = centerInWall(slot, piece, t, a.depth, shiftInWall(slot, piece));
    void run("furniture_update", {
      id: a.id,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
    });
  };
  const fields = [
    {
      name: beforeName,
      value: before,
      set: (d: number) => move(slot.prev + d + w / 2),
    },
    {
      name: afterName,
      value: after,
      set: (d: number) => move(slot.next - d - w / 2),
    },
  ].sort((x, y) => (x.name === first ? -1 : y.name === first ? 1 : 0));
  return (
    <>
      {fields.map((f) => (
        <Field
          key={f.name}
          label={t("Space {name}", { name: f.name })}
          type="number"
          unit="cm"
          value={Math.round(f.value * 10) / 10}
          onCommit={(v) => {
            const d = Number(v);
            if (Number.isFinite(d)) f.set(d);
          }}
        />
      ))}
    </>
  );
}
