// Input fields of the properties panel. Fields commit on Enter or blur (one
// command and undo step per change) and can show "mixed" values when several
// elements with different values are selected.

import { type ReactNode, useRef } from "react";
import { evalLength, evalNumber } from "../expression";
import { formatNumber, t } from "../i18n";
import type { Texture } from "../model";
import { useStore } from "../store";
import { formatFieldValue, fromUnit, type LengthUnit, toUnit, unitSymbol, useUnit } from "../units";

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

/** Step of the arrow keys and the mouse wheel in a length field, in the unit (Shift: x10). */
const LENGTH_STEP: Record<LengthUnit, number> = { cm: 1, mm: 1, m: 0.01, inch: 1 };

/**
 * Input that commits on Enter or blur, not on every keystroke. Number fields calculate
 * ("240+11.5") and change the value relatively ("+5", "+-5", "*2", "/2"); the arrow keys and the
 * mouse wheel step the typed value before it is committed.
 */
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
      const cm = evalLength(raw, lengthUnit, typeof value === "number" && !mixed ? value : null);
      if (cm !== null && toUnit(cm, lengthUnit) !== shown) onCommit(cm);
    } else if (type === "number" || type === "angle") {
      const n = evalNumber(raw, shown);
      if (n !== null && n !== shown) onCommit(n);
    } else if (raw !== display) {
      onCommit(raw);
    }
  };
  const numeric = type === "number" || type === "angle";
  // Steps the typed value (not committed yet) by `steps`
  const step = (input: HTMLInputElement, steps: number) => {
    if (isLength) {
      const cm = evalLength(input.value, lengthUnit) ?? (typeof value === "number" ? value : 0);
      const next = cm + fromUnit(LENGTH_STEP[lengthUnit] * steps, lengthUnit);
      input.value = formatFieldValue(toUnit(next, lengthUnit), lengthUnit);
    } else {
      const n = evalNumber(input.value) ?? shown ?? 0;
      input.value = formatNumber(Math.round((n + steps) * 10) / 10, 1);
    }
    changed.current = true;
  };
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <input
        ref={(el) => {
          if (!el || !numeric) return;
          // A property handler, so that the wheel does not scroll the panel meanwhile
          el.onwheel = (e) => {
            if (document.activeElement !== el) return;
            e.preventDefault();
            step(el, (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
          };
        }}
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
          else if (numeric && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            step(e.currentTarget, (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1));
          }
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
