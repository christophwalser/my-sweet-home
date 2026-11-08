// Text style of a label, room name or area, dimension line or furniture name:
// size, font family, bold, italic. `prefix` selects the command parameters
// ("" → font_size, font_name, bold, italic; "name_" → name_font_size, ...).

import { t } from "../i18n";
import type { TextStyle } from "../model";
import { Field, SelectField } from "./fields";

/** Fonts offered in addition to the default font (common Windows fonts). */
const FONTS: [string, string][] = [
  ["", t("Default")],
  ["Arial", "Arial"],
  ["Calibri", "Calibri"],
  ["Cambria", "Cambria"],
  ["Comic Sans MS", "Comic Sans MS"],
  ["Consolas", "Consolas"],
  ["Courier New", "Courier New"],
  ["Georgia", "Georgia"],
  ["Segoe UI", "Segoe UI"],
  ["Tahoma", "Tahoma"],
  ["Times New Roman", "Times New Roman"],
  ["Trebuchet MS", "Trebuchet MS"],
  ["Verdana", "Verdana"],
];

export default function TextStyleFields({
  title,
  style,
  defaultSize,
  prefix,
  onChange,
}: {
  /** Shown before the field labels, e.g. "Name" (empty for one style per element) */
  title?: string;
  style: TextStyle | null | undefined;
  defaultSize: number;
  prefix: string;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const label = (s: string) => (title ? `${title} ${s.toLowerCase()}` : s);
  const font = style?.font_name ?? "";
  // A font of the file that is not in the list stays selectable
  const fonts: [string, string][] = FONTS.some(([v]) => v === font)
    ? FONTS
    : [...FONTS, [font, font]];
  return (
    <>
      <Field
        label={label(t("Size"))}
        type="number"
        unit="cm"
        value={style?.font_size ?? defaultSize}
        onCommit={(v) => onChange({ [`${prefix}font_size`]: v })}
      />
      <SelectField
        label={label(t("Font"))}
        value={font}
        options={fonts}
        onCommit={(v) => onChange({ [`${prefix}font_name`]: v })}
      />
      <Field
        label={label(t("Bold"))}
        type="checkbox"
        value={style?.bold === true}
        onCommit={(v) => onChange({ [`${prefix}bold`]: v })}
      />
      <Field
        label={label(t("Italic"))}
        type="checkbox"
        value={style?.italic === true}
        onCommit={(v) => onChange({ [`${prefix}italic`]: v })}
      />
    </>
  );
}
