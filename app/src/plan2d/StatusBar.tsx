// Status bar under the plan: the switches of the magnetism (all, angles, objects, rulers), the
// grid, the snap settings (radius and angle step, also by a right click), the level shown as
// an underlay and the position of the mouse.

import { memo, useState } from "react";
import { create } from "zustand";
import { formatDateTime, t } from "../i18n";
import type { Pt } from "../model";
import { type Preferences, type Underlay, usePreferences } from "../preferences";
import { useStore } from "../store";
import Icon, { type IconName } from "../ui/Icon";
import { useMessages } from "../ui/messages";
import { formatLength, formatPrecise } from "../units";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { gridStep } from "./drawPlan";

/** Position of the mouse in the plan (cm), null outside of it. */
export const usePointer = create<{ pt: Pt | null; scale: number }>(() => ({
  pt: null,
  scale: 1,
}));

/** CSS pixels per centimeter of a screen at 96 dpi: the plan at 1:1. */
const CSS_PX_PER_CM = 96 / 2.54;

/** Scale of the plan on the screen as the N of "1:N" (nominal, for a screen at 96 dpi). */
export function planScaleRatio(scale: number, pixelRatio: number): number {
  const ratio = CSS_PX_PER_CM / (scale / pixelRatio);
  // Two significant digits are enough for "about 1:50"
  const digits = 10 ** Math.max(0, Math.floor(Math.log10(ratio)) - 1);
  return Math.max(1, Math.round(ratio / digits) * digits);
}

type Switch = {
  key: "magnetism" | "snapAngles" | "snapObjects" | "snapToRulers" | "grid";
  icon: IconName;
  label: string;
  title: string;
};

const SWITCHES: Switch[] = [
  {
    key: "magnetism",
    icon: "magnet",
    label: t("Magnetism"),
    title: t("Snap while drawing and moving (F9); Alt inverts it for a moment"),
  },
  {
    key: "snapAngles",
    icon: "angle",
    label: t("Angles"),
    title: t("Snap to multiples of 45°, the angle step and right angles to walls"),
  },
  {
    key: "snapObjects",
    icon: "snapobject",
    label: t("Objects"),
    title: t("Snap to the ends, middles, faces and corners of walls, rooms and furniture (F3)"),
  },
  {
    key: "snapToRulers",
    icon: "guide",
    label: t("Guide lines"),
    title: t("Snap to the ends, middles, lines and crossings of the guide lines"),
  },
  { key: "grid", icon: "grid", label: t("Grid"), title: t("Show the grid") },
];

/** Levels offered as the underlay of the plan. */
const UNDERLAYS: [Underlay, string][] = [
  ["below", t("Level below")],
  ["above", t("Level above")],
  ["off", t("No underlay")],
];

/** Snap radii (screen pixels) and angle steps offered by the right click. */
const RADII = [5, 10, 15, 20];
const ANGLE_STEPS = [1, 5, 15, 22.5, 30, 45];
/** Distances of the grid lines offered by the grid menu, in cm (0: by the zoom). */
const GRID_SPACINGS = [0, 10, 25, 50, 100];

function StatusBar() {
  const prefs = usePreferences();
  const pointer = usePointer((s) => s.pt);
  const scale = usePointer((s) => s.scale);
  const [gridMenu, setGridMenu] = useState<{ x: number; y: number } | null>(null);
  const levelCount = useStore((s) => s.opened?.home.levels.length ?? 0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [underlayMenu, setUnderlayMenu] = useState<{ x: number; y: number } | null>(null);
  const underlayItems: MenuItem[] = UNDERLAYS.map(([value, label]) => ({
    label,
    note: prefs.underlay === value ? "✓" : undefined,
    action: () => prefs.update({ underlay: value }),
  }));
  const gridItems: MenuItem[] = [
    { heading: t("Distance of the grid lines") },
    ...GRID_SPACINGS.map(
      (cm): MenuItem => ({
        label: cm === 0 ? t("Automatic, by the zoom") : formatLength(cm),
        note: prefs.gridSpacing === cm ? "✓" : undefined,
        action: () => prefs.update({ gridSpacing: cm, grid: true }),
      }),
    ),
  ];
  const messages = useMessages((s) => s.log);
  const [messageMenu, setMessageMenu] = useState<{ x: number; y: number } | null>(null);
  const messageItems: MenuItem[] = [
    { heading: t("Messages (a click copies the text)") },
    ...messages.map(
      (m): MenuItem => ({
        label: m.text.length > 90 ? `${m.text.slice(0, 90)}…` : m.text,
        note: formatDateTime(m.at),
        danger: m.kind === "error",
        action: () => void navigator.clipboard.writeText(m.text).catch(() => {}),
      }),
    ),
    { separator: true },
    { label: t("Clear the list"), action: () => useMessages.getState().clear() },
  ];
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
          title={`${s.label}: ${s.title}`}
          aria-label={s.label}
          disabled={s.key !== "magnetism" && s.key !== "grid" && !prefs.magnetism}
          onClick={() => toggle(s.key)}
        >
          <Icon name={s.icon} size={16} />
        </button>
      ))}
      <button
        type="button"
        className="plan-status-settings"
        title={t("Snap radius and angle step")}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu({ x: r.left, y: r.top });
        }}
      >
        <Icon name="settings" size={14} />
        {`${prefs.snapRadius} px · ${prefs.angleStep}°`}
        <Icon name="chevdown" size={12} />
      </button>
      {levelCount > 1 && (
        <button
          type="button"
          className="plan-status-settings"
          title={t(
            "Level shown faded under the plan; its wall ends and corners attract the pointer",
          )}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setUnderlayMenu({ x: r.left, y: r.top });
          }}
        >
          <Icon name="alllevels" size={14} />
          {UNDERLAYS.find(([value]) => value === prefs.underlay)?.[1]}
          <Icon name="chevdown" size={12} />
        </button>
      )}
      <button
        type="button"
        className="plan-status-settings"
        title={t("Zoom of the plan and distance of the grid lines; click to set the grid")}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setGridMenu({ x: r.left, y: r.top });
        }}
      >
        {`1:${planScaleRatio(scale, devicePixelRatio)}`}
        {prefs.grid && ` · ${t("Grid")} ${formatLength(gridStep(scale, prefs.gridSpacing))}`}
        <Icon name="chevdown" size={12} />
      </button>
      {messages.length > 0 && (
        <button
          type="button"
          className="plan-status-settings"
          title={t("Messages of this window")}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMessageMenu({ x: r.left, y: r.top });
          }}
        >
          <Icon name="info" size={14} />
          {messages.length}
        </button>
      )}
      <span className="plan-status-position">
        {pointer ? `X ${formatPrecise(pointer[0])}   Y ${formatPrecise(pointer[1])}` : ""}
      </span>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} fixed />
      )}
      {messageMenu && (
        <ContextMenu
          x={messageMenu.x}
          y={messageMenu.y}
          items={messageItems}
          onClose={() => setMessageMenu(null)}
          fixed
        />
      )}
      {gridMenu && (
        <ContextMenu
          x={gridMenu.x}
          y={gridMenu.y}
          items={gridItems}
          onClose={() => setGridMenu(null)}
          fixed
        />
      )}
      {underlayMenu && (
        <ContextMenu
          x={underlayMenu.x}
          y={underlayMenu.y}
          items={underlayItems}
          onClose={() => setUnderlayMenu(null)}
          fixed
        />
      )}
    </div>
  );
}

// Rendered again only for what it shows, not with every change of the window around it
export default memo(StatusBar);
