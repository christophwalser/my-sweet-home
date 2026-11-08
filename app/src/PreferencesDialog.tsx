// Preferences dialog: plan, units and magnetism, defaults of new elements, 3D view and general
// settings, on tabs. Changes apply at once and are kept for all windows of the app.

import { type ReactNode, useEffect, useState } from "react";
import { Field, WALL_PATTERNS } from "./panels/fields";
import { type Preferences, usePreferences } from "./preferences";
import { useStore } from "./store";
import { type ThemeChoice, useUi } from "./ui/uiStore";
import { UNITS } from "./units";

type Tab = "plan" | "new" | "view3d" | "general";
const TABS: { id: Tab; label: string }[] = [
  { id: "plan", label: "Plan" },
  { id: "new", label: "New elements" },
  { id: "view3d", label: "3D view" },
  { id: "general", label: "General" },
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
          {value === "" ? "Default" : ""}
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

export default function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const p = usePreferences();
  const [tab, setTab] = useState<Tab>("plan");
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
      <div className="dialog prefs-dialog" role="dialog" aria-modal="true" aria-label="Preferences">
        <header className="dialog-header">
          <h2>Preferences</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            {"✕"}
          </button>
        </header>
        <div className="prefs-layout">
          <div className="prefs-tabs" role="tablist" aria-label="Sections">
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
                <Group title="Units and magnetism">
                  <Choice
                    label="Unit"
                    value={p.unit}
                    options={UNITS.map((u) => [u.unit, u.label])}
                    onChange={(unit) => set({ unit })}
                  />
                  <Check
                    label="Magnetism"
                    hint="Snap points, angles and lengths while drawing and dragging; Alt inverts it"
                    checked={p.magnetism}
                    onChange={(magnetism) => set({ magnetism })}
                  />
                  <Choice
                    label="Angle steps"
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
                <Group title="Display">
                  <Check
                    label="Rulers"
                    hint="Along the top and left edge of the plan"
                    checked={p.rulers}
                    onChange={(rulers) => set({ rulers })}
                  />
                  <Check label="Grid" checked={p.grid} onChange={(grid) => set({ grid })} />
                  <Check
                    label="Furniture seen from above"
                    hint="Rendered from its 3D model; off: the catalog icon"
                    checked={p.furnitureTopView}
                    onChange={(furnitureTopView) => set({ furnitureTopView })}
                  />
                  <Choice
                    label="Rooms"
                    value={p.roomRendering}
                    options={[
                      ["floor", "Floor color or texture"],
                      ["monochrome", "One color"],
                    ]}
                    onChange={(roomRendering) => set({ roomRendering })}
                  />
                  <Color
                    label="Left wall side"
                    value={p.leftSideColor}
                    onChange={(leftSideColor) => set({ leftSideColor })}
                  />
                  <Color
                    label="Right wall side"
                    value={p.rightSideColor}
                    onChange={(rightSideColor) => set({ rightSideColor })}
                  />
                </Group>
              </>
            )}
            {tab === "new" && (
              <>
                <Group title="Walls">
                  {length("Thickness", "newWallThickness", (cm) =>
                    useStore.getState().setWallThickness(cm),
                  )}
                  {length("Height (new homes)", "newWallHeight")}
                  <Choice
                    label="Pattern in plan"
                    value={p.newWallPattern}
                    options={WALL_PATTERNS}
                    onChange={(newWallPattern) => set({ newWallPattern })}
                  />
                  <OptionalColor
                    label="Left side color"
                    value={p.newWallLeftColor}
                    onChange={(newWallLeftColor) => set({ newWallLeftColor })}
                  />
                  <OptionalColor
                    label="Right side color"
                    value={p.newWallRightColor}
                    onChange={(newWallRightColor) => set({ newWallRightColor })}
                  />
                </Group>
                <Group title="Rooms, levels and texts">
                  <OptionalColor
                    label="Floor color"
                    value={p.newRoomFloorColor}
                    onChange={(newRoomFloorColor) => set({ newRoomFloorColor })}
                  />
                  {length("Floor thickness of levels", "newFloorThickness")}
                  {length("Text size", "newTextSize")}
                </Group>
              </>
            )}
            {tab === "view3d" && (
              <Group title="3D view">
                <Choice
                  label="Quality"
                  value={p.quality3d}
                  options={[
                    ["low", "Low (fast)"],
                    ["medium", "Medium"],
                    ["high", "High (sharp, detailed shadows)"],
                  ]}
                  onChange={(quality3d) => set({ quality3d })}
                />
                <label className="prop-row">
                  <span className="prop-label">Walking speed</span>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={0.5}
                    value={p.walkingSpeed}
                    onChange={(e) => set({ walkingSpeed: Number(e.currentTarget.value) })}
                  />
                  <span className="prop-unit">{p.walkingSpeed} km/h</span>
                </label>
              </Group>
            )}
            {tab === "general" && (
              <Group title="General">
                <Choice<ThemeChoice>
                  label="Theme"
                  value={theme}
                  options={[
                    ["system", "Like Windows"],
                    ["light", "Light"],
                    ["dark", "Dark"],
                  ]}
                  onChange={setTheme}
                />
                <Choice
                  label="Autosave"
                  value={p.autosaveMinutes}
                  options={[
                    [0, "Off"],
                    [1, "Every minute"],
                    [5, "Every 5 minutes"],
                    [10, "Every 10 minutes"],
                    [15, "Every 15 minutes"],
                    [30, "Every 30 minutes"],
                  ]}
                  onChange={(autosaveMinutes) => set({ autosaveMinutes })}
                />
                <p className="muted small">
                  Autosave keeps copies of changed homes to recover them after a crash. Window sizes
                  and positions are remembered. The language follows with the German translation.
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
            title="Back to the default values of all preferences"
          >
            Reset all
          </button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
