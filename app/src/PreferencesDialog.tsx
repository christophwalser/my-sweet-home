// Preferences dialog: plan, units and magnetism, defaults of new elements, 3D view and general
// settings, on tabs. Changes apply at once and are kept for all windows of the app.

import { type ReactNode, useEffect, useState } from "react";
import CatalogFeedsPage from "./CatalogFeedsPage";
import { LANGUAGES, type LanguageChoice, languageChoice, setLanguage, t } from "./i18n";
import { DASH_STYLES, Field, WALL_PATTERNS } from "./panels/fields";
import { type Preferences, usePreferences } from "./preferences";
import { useStore } from "./store";
import { type ThemeChoice, useUi } from "./ui/uiStore";
import { UNITS } from "./units";

type Tab = "plan" | "tools" | "new" | "view3d" | "general" | "catalogs";
/** Currencies offered for furniture prices (ISO 4217), as in Sweet Home 3D's list. */
const CURRENCIES = [
  "CHF",
  "EUR",
  "USD",
  "GBP",
  "CAD",
  "AUD",
  "JPY",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
];
const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: t("General") },
  { id: "plan", label: t("Plan") },
  { id: "tools", label: t("Tools") },
  { id: "new", label: t("New elements") },
  { id: "view3d", label: t("3D view") },
  { id: "catalogs", label: t("Catalogs") },
];

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="prefs-option">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span>
        {label}
        {hint && <span className="muted small"> {hint}</span>}
      </span>
    </label>
  );
}

function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          const found = options.find(([v]) => String(v) === raw);
          if (found) onChange(found[0]);
        }}
      >
        {options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Color that may also be "none" (empty string). */
function OptionalColor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <span className="prefs-color">
        <label className="prefs-option">
          <input
            type="checkbox"
            checked={value !== ""}
            onChange={(e) => onChange(e.currentTarget.checked ? "#d0d0d0" : "")}
          />
          {value === "" ? t("Default") : ""}
        </label>
        {value !== "" && (
          <input
            type="color"
            value={value}
            aria-label={label}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        )}
      </span>
    </div>
  );
}

function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="prop-row">
      <span className="prop-label">{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="prefs-group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export default function PreferencesDialog({
  initialTab,
  onClose,
}: {
  /** Page to open (e.g. "catalogs" from the online catalogs) */
  initialTab?: string;
  onClose: () => void;
}) {
  const p = usePreferences();
  const [tab, setTab] = useState<Tab>(
    TABS.some((x) => x.id === initialTab) ? (initialTab as Tab) : "general",
  );
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const set = (changes: Partial<Preferences>) => p.update(changes);
  /** Length field in cm, shown in the unit of the preferences */
  const length = (label: string, key: keyof Preferences, after?: (v: number) => void) => (
    <Field
      label={label}
      type="number"
      unit="cm"
      value={p[key] as number}
      onCommit={(v) => {
        const cm = Number(v);
        if (!Number.isFinite(cm) || cm <= 0) return;
        set({ [key]: cm });
        after?.(cm);
      }}
    />
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog prefs-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Preferences")}
      >
        <header className="dialog-header">
          <h2>{t("Preferences")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            {"✕"}
          </button>
        </header>
        <div className="prefs-layout">
          <div className="prefs-tabs" role="tablist" aria-label={t("Sections")}>
            {TABS.map((t) => (
              <button
                type="button"
                role="tab"
                key={t.id}
                aria-selected={tab === t.id}
                className={tab === t.id ? "active" : ""}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="prefs-page" role="tabpanel">
            {tab === "plan" && (
              <>
                <Group title={t("Units and magnetism")}>
                  <Choice
                    label={t("Unit")}
                    value={p.unit}
                    options={UNITS.map((u) => [u.unit, u.label])}
                    onChange={(unit) => set({ unit })}
                  />
                  <Check
                    label={t("Magnetism")}
                    hint={t(
                      "Snap points, angles and lengths while drawing and dragging; Alt inverts it",
                    )}
                    checked={p.magnetism}
                    onChange={(magnetism) => set({ magnetism })}
                  />
                  <Choice
                    label={t("Angle steps")}
                    value={p.angleStep}
                    options={[
                      [1, "1°"],
                      [5, "5°"],
                      [15, "15°"],
                      [45, "45°"],
                    ]}
                    onChange={(angleStep) => set({ angleStep })}
                  />
                </Group>
                <Group title={t("Display")}>
                  <Check
                    label={t("Rulers")}
                    hint={t("Along the top and left edge of the plan")}
                    checked={p.rulers}
                    onChange={(rulers) => set({ rulers })}
                  />
                  <Check label={t("Grid")} checked={p.grid} onChange={(grid) => set({ grid })} />
                  <Check
                    label={t("Furniture seen from above")}
                    hint={t("Rendered from its 3D model; off: the catalog icon")}
                    checked={p.furnitureTopView}
                    onChange={(furnitureTopView) => set({ furnitureTopView })}
                  />
                  <Choice
                    label={t("Rooms")}
                    value={p.roomRendering}
                    options={[
                      ["floor", t("Floor color or texture")],
                      ["monochrome", t("One color")],
                    ]}
                    onChange={(roomRendering) => set({ roomRendering })}
                  />
                  <Color
                    label={t("Left wall side")}
                    value={p.leftSideColor}
                    onChange={(leftSideColor) => set({ leftSideColor })}
                  />
                  <Color
                    label={t("Right wall side")}
                    value={p.rightSideColor}
                    onChange={(rightSideColor) => set({ rightSideColor })}
                  />
                </Group>
              </>
            )}
            {tab === "tools" && (
              <>
                <Group title={t("Ruler")}>
                  <OptionalColor
                    label={t("Color")}
                    value={p.rulerColor}
                    onChange={(rulerColor) => set({ rulerColor })}
                  />
                  <Choice
                    label={t("Dashes")}
                    value={p.rulerDashStyle}
                    options={DASH_STYLES}
                    onChange={(rulerDashStyle) => set({ rulerDashStyle })}
                  />
                  <p className="muted small">
                    {t("New rulers get these values; change a ruler in its properties.")}
                  </p>
                </Group>
                <Group title={t("Measure")}>
                  <OptionalColor
                    label={t("Color")}
                    value={p.measureColor}
                    onChange={(measureColor) => set({ measureColor })}
                  />
                </Group>
              </>
            )}
            {tab === "new" && (
              <>
                <Group title={t("Walls")}>
                  {length(t("Thickness"), "newWallThickness", (cm) =>
                    useStore.getState().setWallThickness(cm),
                  )}
                  {length(t("Height (new homes)"), "newWallHeight")}
                  <Choice
                    label={t("Pattern in plan")}
                    value={p.newWallPattern}
                    options={WALL_PATTERNS}
                    onChange={(newWallPattern) => set({ newWallPattern })}
                  />
                  <OptionalColor
                    label={t("Left side color")}
                    value={p.newWallLeftColor}
                    onChange={(newWallLeftColor) => set({ newWallLeftColor })}
                  />
                  <OptionalColor
                    label={t("Right side color")}
                    value={p.newWallRightColor}
                    onChange={(newWallRightColor) => set({ newWallRightColor })}
                  />
                </Group>
                <Group title={t("Rooms, levels and texts")}>
                  <OptionalColor
                    label={t("Floor color")}
                    value={p.newRoomFloorColor}
                    onChange={(newRoomFloorColor) => set({ newRoomFloorColor })}
                  />
                  {length(t("Floor thickness of levels"), "newFloorThickness")}
                  {length(t("Text size"), "newTextSize")}
                </Group>
              </>
            )}
            {tab === "view3d" && (
              <Group title={t("3D view")}>
                <Choice
                  label={t("Quality")}
                  value={p.quality3d}
                  options={[
                    ["low", t("Low (fast)")],
                    ["medium", t("Medium")],
                    ["high", t("High (sharp, detailed shadows)")],
                  ]}
                  onChange={(quality3d) => set({ quality3d })}
                />
                <label className="prop-row">
                  <span className="prop-label">{t("Walking speed")}</span>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={0.5}
                    value={p.walkingSpeed}
                    onChange={(e) => set({ walkingSpeed: Number(e.currentTarget.value) })}
                  />
                  <span className="prop-unit">
                    {p.walkingSpeed} {t("km/h")}
                  </span>
                </label>
              </Group>
            )}
            {tab === "catalogs" && <CatalogFeedsPage />}
            {tab === "general" && (
              <Group title={t("General")}>
                <Choice<ThemeChoice>
                  label={t("Theme")}
                  value={theme}
                  options={[
                    ["system", t("Like Windows")],
                    ["light", t("Light")],
                    ["dark", t("Dark")],
                  ]}
                  onChange={setTheme}
                />
                <Choice<LanguageChoice>
                  label={t("Language")}
                  value={languageChoice()}
                  options={LANGUAGES.map((l) => [l.id, l.id === "system" ? t(l.label) : l.label])}
                  onChange={setLanguage}
                />
                <Check
                  label={t("Online catalogs")}
                  hint={t(
                    "Search and import free libraries, textures and models from the internet",
                  )}
                  checked={p.onlineSources}
                  onChange={(onlineSources) => set({ onlineSources })}
                />
                <Check
                  label={t("Catalog preview")}
                  hint={t("Larger picture and details while pointing at furniture or textures")}
                  checked={p.catalogPreview}
                  onChange={(catalogPreview) => set({ catalogPreview })}
                />
                <Choice
                  label={t("Autosave")}
                  value={p.autosaveMinutes}
                  options={[
                    [0, t("Off")],
                    [1, t("Every minute")],
                    [5, t("Every 5 minutes")],
                    [10, t("Every 10 minutes")],
                    [15, t("Every 15 minutes")],
                    [30, t("Every 30 minutes")],
                  ]}
                  onChange={(autosaveMinutes) => set({ autosaveMinutes })}
                />
                <p className="muted small">
                  {t(
                    "Autosave keeps copies of changed homes to recover them after a crash. Window sizes and positions are remembered.",
                  )}
                </p>
              </Group>
            )}
            {tab === "general" && (
              <Group title={t("Prices")}>
                <Choice<string>
                  label={t("Currency")}
                  value={p.currency}
                  options={[
                    ["", t("None (prices hidden)")],
                    ...CURRENCIES.map((c): [string, string] => [c, c]),
                  ]}
                  onChange={(currency) => set({ currency })}
                />
                {p.currency !== "" && (
                  <>
                    <Check
                      label={t("Value added tax")}
                      hint={t(
                        "VAT in the furniture properties and VAT columns in the furniture list",
                      )}
                      checked={p.vatEnabled}
                      onChange={(vatEnabled) => set({ vatEnabled })}
                    />
                    {p.vatEnabled && (
                      <Field
                        label={t("Default VAT")}
                        type="number"
                        unit="%"
                        value={p.defaultVatPercent}
                        onCommit={(v) => {
                          const n = Number(v);
                          if (Number.isFinite(n) && n >= 0 && n < 100)
                            set({ defaultVatPercent: n });
                        }}
                      />
                    )}
                  </>
                )}
                <p className="muted small">
                  {t(
                    "Like Sweet Home 3D, prices are shown in the furniture properties and the furniture list only when a currency is chosen.",
                  )}
                </p>
              </Group>
            )}
          </div>
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            onClick={() => {
              p.reset();
              setTheme("system");
              useStore.getState().setWallThickness(usePreferences.getState().newWallThickness);
            }}
            title={t("Back to the default values of all preferences")}
          >
            {t("Reset all")}
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {t("Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
