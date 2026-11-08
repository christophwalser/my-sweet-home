// Preferences dialog (plan display and magnetism; more settings follow in P12).

import { useEffect } from "react";
import { type Preferences, usePreferences } from "./preferences";

const OPTIONS: { key: keyof Preferences; label: string; hint: string }[] = [
  {
    key: "rulers",
    label: "Rulers",
    hint: "Rulers along the top and left edge of the plan, with the position of the mouse",
  },
  { key: "grid", label: "Grid", hint: "Grid lines in the plan" },
  {
    key: "magnetism",
    label: "Magnetism",
    hint: "Snap points, angles and lengths while drawing and dragging. Holding Alt inverts it for the current action.",
  },
];

export default function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const prefs = usePreferences();

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
        <fieldset className="prefs-group">
          <legend>Plan</legend>
          {OPTIONS.map((o) => (
            <label key={o.key} className="prefs-option">
              <input
                type="checkbox"
                checked={prefs[o.key]}
                onChange={(e) => prefs.update({ [o.key]: e.currentTarget.checked })}
              />
              <span>
                {o.label}
                <span className="muted small"> {o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
