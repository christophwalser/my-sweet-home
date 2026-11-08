// Input fields of the properties panel. Fields commit on Enter or blur (one
// command and undo step per change) and can show "mixed" values when several
// elements with different values are selected.

import { type ReactNode, useRef } from "react";
import { formatNumber, t } from "../i18n";
import type { Texture } from "../model";
import { useStore } from "../store";
import { formatFieldValue, parseLength, toUnit, unitSymbol, useUnit } from "../units";

/**
 * Properties of one wall side. Its color matches the marking of that side in the
 * plan, and hovering the section emphasizes the side there.
 */
export function SideSection({
  side,
  title,
  children,
}: {
  side: "left" | "right";
  title: string;
  children: ReactNode;
}) {
  const setHighlight = useStore((s) => s.setHighlightSide);
  return (
    <fieldset
      className={`side-section side-${side}`}
      onMouseEnter={() => setHighlight(side)}
      onMouseLeave={() => setHighlight(null)}
    >
      <h3 title={t("Seen when walking along the wall from its start to its end")}>
        <span className="side-swatch" aria-hidden="true" />
        {title}
      </h3>
      {children}
    </fieldset>
  );
}

type FieldType = "number" | "text" | "color" | "checkbox" | "angle";

type FieldProps = {
  label: string;
  type: FieldType;
  value: string | number | boolean | null | undefined;
  unit?: string;
  /** The selected elements have different values: show the field empty ("mixed") */
  mixed?: boolean;
  onCommit: (value: string | number | boolean) => void;
};

export function toHex(argb: number | null | undefined): string {
  if (argb === null || argb === undefined) return "#ffffff";
  return `#${(argb & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** Input that commits on Enter or blur, not on every keystroke. */
export function Field({ label, type, value, unit, mixed, onCommit }: FieldProps) {
  // A mixed color field shows a placeholder color: only a real change may commit it
  const changed = useRef(false);
  // Lengths are given in cm and shown in the unit of the preferences
  const lengthUnit = useUnit();
  const isLength = unit === "cm" && type === "number";
  if (type === "checkbox") {
    return (
      <label className="prop-row prop-check">
        <input
          type="checkbox"
          checked={!mixed && !!value}
          ref={(el) => {
            if (el) el.indeterminate = !!mixed;
          }}
          onChange={(e) => onCommit(e.currentTarget.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }
  // Number shown (in the unit for lengths), null for other values
  const shown =
    mixed || typeof value !== "number"
      ? null
      : type === "angle"
        ? Math.round(((value * 180) / Math.PI) * 10) / 10
        : isLength
          ? toUnit(value, lengthUnit)
          : Math.round(value * 10) / 10;
  const display =
    shown !== null
      ? isLength
        ? formatFieldValue(shown, lengthUnit)
        : formatNumber(shown, 1)
      : mixed
        ? ""
        : String(value ?? "");
  const commit = (raw: string) => {
    if (mixed && (raw === "" || (type === "color" && !changed.current))) return;
    changed.current = false;
    if (isLength) {
      const cm = parseLength(raw, lengthUnit);
      if (cm !== null && toUnit(cm, lengthUnit) !== shown) onCommit(cm);
    } else if (type === "number" || type === "angle") {
      const n = Number.parseFloat(raw.replace(",", "."));
      if (Number.isFinite(n) && n !== shown) onCommit(n);
    } else if (raw !== display) {
      onCommit(raw);
    }
  };
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <input
        // Re-create the input when the value changes from outside (undo, CLI, MCP)
        key={String(display)}
        type={type === "color" ? "color" : "text"}
        inputMode={(type === "number" || type === "angle") && !isLength ? "decimal" : undefined}
        defaultValue={type === "color" && mixed ? "#ffffff" : String(display)}
        placeholder={mixed ? "mixed" : undefined}
        // Also for colors: one command (and undo step) when leaving the field
        onInput={() => {
          changed.current = true;
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        }}
      />
      {(unit || (mixed && type === "color")) && (
        <span className="prop-unit">
          {mixed && type === "color" ? "mixed" : isLength ? unitSymbol(lengthUnit) : unit}
        </span>
      )}
    </label>
  );
}

/** Drop-down field that commits on change. */
export function SelectField({
  label,
  value,
  options,
  mixed,
  onCommit,
}: {
  label: string;
  value: string;
  options: [string, string][];
  mixed?: boolean;
  onCommit: (value: string) => void;
}) {
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <select
        value={mixed ? "" : value}
        onChange={(e) => {
          if (e.currentTarget.value) onCommit(e.currentTarget.value);
        }}
      >
        {mixed && <option value="">{t("mixed")}</option>}
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export const WALL_PATTERNS: [string, string][] = [
  ["hatchUp", t("Hatch up")],
  ["hatchDown", t("Hatch down")],
  ["reversedHatchUp", t("Reversed hatch up")],
  ["reversedHatchDown", t("Reversed hatch down")],
  ["crossHatch", t("Cross hatch")],
  ["background", t("Background")],
  ["foreground", t("Foreground")],
];

export const DASH_STYLES: [string, string][] = [
  ["SOLID", t("Solid")],
  ["DOT", t("Dot")],
  ["DASH", t("Dash")],
  ["DASH_DOT", t("Dash dot")],
  ["DASH_DOT_DOT", t("Dash dot dot")],
];

export const ARROW_STYLES: [string, string][] = [
  ["NONE", t("None")],
  ["DELTA", t("Triangle")],
  ["OPEN", t("Open")],
  ["DISC", t("Disc")],
];

export const byRole = (textures: Texture[] | undefined, role: string) =>
  textures?.find((t) => t.role === role) ?? null;
