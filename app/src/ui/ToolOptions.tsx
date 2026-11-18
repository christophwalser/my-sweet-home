// Options of the active plan tool, shown above the plan: what the next wall or text will be
// like. They start from the defaults of the preferences and apply until the window closes.

import { t } from "../i18n";
import { usePreferences } from "../preferences";
import { type Tool, useStore, type WallLine } from "../store";
import { fromUnit, toUnit, unitSymbol, useUnit } from "../units";

/** Lines of a wall the drawn points can describe. */
export const WALL_LINES: [WallLine, string][] = [
  ["axis", t("Axis")],
  ["left", t("Left side")],
  ["right", t("Right side")],
];

function LengthOption({
  label,
  title,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  title: string;
  /** In cm; null shows the placeholder (the default applies) */
  value: number | null;
  placeholder?: number;
  onChange: (cm: number | null) => void;
}) {
  const unit = useUnit();
  return (
    <label className="tool-option" title={title}>
      {label}
      <input
        type="number"
        min={0}
        step="any"
        value={value === null ? "" : toUnit(value, unit)}
        placeholder={placeholder === undefined ? undefined : String(toUnit(placeholder, unit))}
        onChange={(e) => {
          const v = Number.parseFloat(e.currentTarget.value);
          if (Number.isFinite(v) && v > 0) onChange(fromUnit(v, unit));
          else if (e.currentTarget.value === "" && placeholder !== undefined) onChange(null);
        }}
      />
      {unitSymbol(unit)}
    </label>
  );
}

function WallOptions({ round }: { round: boolean }) {
  const thickness = useStore((s) => s.wallThickness);
  const height = useStore((s) => s.wallHeight);
  const line = useStore((s) => s.wallLine);
  const arc = useStore((s) => s.arcExtent);
  const homeHeight = useStore((s) => s.opened?.home.attrs.wall_height ?? 250);
  const set = useStore.setState;
  return (
    <>
      <LengthOption
        label={t("Thickness")}
        title={t("Thickness of new walls (default in the preferences)")}
        value={thickness}
        onChange={(v) => v !== null && set({ wallThickness: v })}
      />
      <LengthOption
        label={t("Height")}
        title={t("Height of new walls; empty: the wall height of the home")}
        value={height}
        placeholder={homeHeight}
        onChange={(v) => set({ wallHeight: v })}
      />
      {round ? (
        <label className="tool-option" title={t("Arc of each new round wall in degrees")}>
          {t("Arc")}
          <input
            type="number"
            min={-340}
            max={340}
            step={5}
            value={arc}
            onChange={(e) => {
              const v = Number.parseFloat(e.currentTarget.value);
              if (Number.isFinite(v) && v !== 0 && Math.abs(v) <= 340) set({ arcExtent: v });
            }}
          />
          °
        </label>
      ) : (
        <label
          className="tool-option"
          title={t(
            "Line of the wall that runs through the clicked points: draw by the axis, or by one side to get inner or outer dimensions (left = left in drawing direction)",
          )}
        >
          {t("Draw by")}
          <select
            value={line}
            onChange={(e) => set({ wallLine: e.currentTarget.value as WallLine })}
          >
            {WALL_LINES.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function TextOptions() {
  const size = usePreferences((s) => s.newTextSize);
  const update = usePreferences((s) => s.update);
  return (
    <LengthOption
      label={t("Text size")}
      title={t("Size of new texts (also in the preferences)")}
      value={size}
      onChange={(v) => v !== null && update({ newTextSize: v })}
    />
  );
}

/** The options of a tool, or nothing for tools without any. */
export default function ToolOptions({ tool }: { tool: Tool }) {
  if (tool === "wall" || tool === "arcwall") return <WallOptions round={tool === "arcwall"} />;
  if (tool === "label") return <TextOptions />;
  return null;
}
