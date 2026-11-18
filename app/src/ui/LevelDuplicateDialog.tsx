// Duplicating the shown level: the walls are always copied, exactly above their originals;
// rooms, doors and windows, furniture and annotations on request (Levels menu, level tabs).

import { type FormEvent, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { useStore } from "../store";

type Part = "rooms" | "openings" | "furniture" | "annotations";

const PARTS: [Part, string][] = [
  ["rooms", t("Rooms")],
  ["openings", t("Doors and windows")],
  ["furniture", t("Furniture")],
  ["annotations", t("Texts, dimensions and lines")],
];

export default function LevelDuplicateDialog({ onClose }: { onClose: () => void }) {
  const opened = useStore((s) => s.opened);
  const levelId = useStore((s) => s.selectedLevel);
  const level = opened?.home.levels.find((l) => l.attrs.id === levelId) ?? null;
  const first = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(() => t("Level {n}", { n: opened?.home.levels.length ?? 1 }));
  const [parts, setParts] = useState<Record<Part, boolean>>({
    rooms: false,
    openings: false,
    furniture: false,
    annotations: false,
  });

  useEffect(() => {
    first.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!level) return null;

  const apply = (e: FormEvent) => {
    e.preventDefault();
    void useStore.getState().run("level_duplicate", {
      id: level.attrs.id,
      name: name.trim() || undefined,
      ...parts,
    });
    onClose();
  };

  const title = t('Duplicate the level "{name}"', { name: level.attrs.name });
  return (
    <div className="dialog-backdrop">
      <form
        className="dialog transform-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={apply}
      >
        <header className="dialog-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            {"✕"}
          </button>
        </header>
        <label className="prop-row">
          <span className="prop-label">{t("Name")}</span>
          <input
            ref={first}
            type="text"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <fieldset className="check-list">
          <legend>{t("Copy to the new level")}</legend>
          <label>
            <input type="checkbox" checked disabled />
            {t("Walls")}
          </label>
          {PARTS.map(([part, label]) => (
            <label key={part}>
              <input
                type="checkbox"
                checked={parts[part]}
                onChange={(e) => setParts({ ...parts, [part]: e.currentTarget.checked })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="muted small">
          {t(
            "The new level lies on top of the highest one; the copies are exactly above their originals.",
          )}
        </p>
        <div className="dialog-actions">
          <button type="submit" className="primary">
            {t("Duplicate")}
          </button>
          <button type="button" onClick={onClose}>
            {t("Cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
