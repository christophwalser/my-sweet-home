// Status bar under the plan: the switches of the magnetism (all, angles, objects, rulers), the
// grid, and the position of the mouse. A right click chooses the snap radius and angle step.

import { useState } from "react";
import { create } from "zustand";
import { t } from "../i18n";
import type { Pt } from "../model";
import { type Preferences, usePreferences } from "../preferences";
import { formatPrecise } from "../units";
import ContextMenu, { type MenuItem } from "./ContextMenu";

/** Position of the mouse in the plan (cm), null outside of it. */
export const usePointer = create<{ pt: Pt | null }>(() => ({ pt: null }));

type Switch = {
  key: "magnetism" | "snapAngles" | "snapObjects" | "snapToRulers" | "grid";
  label: string;
  title: string;
};

const SWITCHES: Switch[] = [
  {
    key: "magnetism",
    label: t("Magnetism"),
    title: t("Snap while drawing and moving (F9); Alt inverts it for a moment"),
  },
  {
    key: "snapAngles",
    label: t("Angles"),
    title: t("Snap to multiples of 45°, the angle step and right angles to walls"),
  },
  {
    key: "snapObjects",
    label: t("Objects"),
    title: t("Snap to the ends, middles, faces and corners of walls, rooms and furniture (F3)"),
  },
  {
    key: "snapToRulers",
    label: t("Rulers"),
    title: t("Snap to the ends, middles, lines and crossings of the rulers"),
  },
  { key: "grid", label: t("Grid"), title: t("Show the grid") },
];

/** Snap radii (screen pixels) and angle steps offered by the right click. */
const RADII = [5, 10, 15, 20];
const ANGLE_STEPS = [1, 5, 15, 45];

export default function StatusBar() {
  const prefs = usePreferences();
  const pointer = usePointer((s) => s.pt);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const toggle = (key: Switch["key"]) =>
    prefs.update({ [key]: !prefs[key] } as Partial<Preferences>);
  const items: MenuItem[] = [
    { heading: t("Snap radius") },
    ...RADII.map(
      (r): MenuItem => ({
        label: t("{px} pixels", { px: r }),
        note: prefs.snapRadius === r ? "✓" : undefined,
        action: () => prefs.update({ snapRadius: r }),
      }),
    ),
    { separator: true },
    { heading: t("Angle step") },
    ...ANGLE_STEPS.map(
      (s): MenuItem => ({
        label: `${s}°`,
        note: prefs.angleStep === s ? "✓" : undefined,
        action: () => prefs.update({ angleStep: s }),
      }),
    ),
  ];
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the right click is a shortcut to settings also found in the preferences
    <div
      className="plan-status"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {SWITCHES.map((s) => (
        <button
          key={s.key}
          type="button"
          className={`plan-status-switch${prefs[s.key] ? " on" : ""}`}
          aria-pressed={!!prefs[s.key]}
          title={s.title}
          disabled={s.key !== "magnetism" && s.key !== "grid" && !prefs.magnetism}
          onClick={() => toggle(s.key)}
        >
          {s.label}
        </button>
      ))}
      <span className="plan-status-position">
        {pointer ? `X ${formatPrecise(pointer[0])}   Y ${formatPrecise(pointer[1])}` : ""}
      </span>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} fixed />
      )}
    </div>
  );
}
