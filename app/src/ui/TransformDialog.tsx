// Rotating or moving the selection by typed values (Edit menu).

import { type FormEvent, useEffect, useRef, useState } from "react";
import { evalLength, evalNumber } from "../expression";
import { t } from "../i18n";
import { useStore, VISITOR_ID } from "../store";
import { unitSymbol, useUnit } from "../units";

export type TransformMode = "rotate" | "move";

export default function TransformDialog({
  mode,
  onClose,
}: {
  mode: TransformMode;
  onClose: () => void;
}) {
  const unit = useUnit();
  const first = useRef<HTMLInputElement>(null);
  const [a, setA] = useState(mode === "rotate" ? "90" : "0");
  const [b, setB] = useState("0");
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    first.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    const { selection, run } = useStore.getState();
    const ids = selection.filter((id) => id !== VISITOR_ID);
    if (mode === "rotate") {
      const angle = evalNumber(a);
      if (angle === null) return setInvalid(true);
      if (angle !== 0) void run("edit_rotate", { ids, angle_deg: angle });
    } else {
      const dx = evalLength(a, unit);
      const dy = evalLength(b, unit);
      if (dx === null || dy === null) return setInvalid(true);
      if (dx !== 0 || dy !== 0) void run("edit_move", { ids, dx, dy });
    }
    onClose();
  };

  const title = mode === "rotate" ? t("Rotate the selection") : t("Move the selection");
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
        {mode === "rotate" ? (
          <>
            <label className="prop-row">
              <span className="prop-label">{t("Angle")}</span>
              <input
                ref={first}
                type="text"
                value={a}
                aria-invalid={invalid || undefined}
                onChange={(e) => {
                  setA(e.currentTarget.value);
                  setInvalid(false);
                }}
              />
              <span className="prop-unit">°</span>
            </label>
            <p className="muted small">
              {t(
                "Clockwise, around the center of the selection; a negative angle turns the other way.",
              )}
            </p>
          </>
        ) : (
          <>
            <label className="prop-row">
              <span className="prop-label">{t("To the right")}</span>
              <input
                ref={first}
                type="text"
                value={a}
                aria-invalid={invalid || undefined}
                onChange={(e) => {
                  setA(e.currentTarget.value);
                  setInvalid(false);
                }}
              />
              <span className="prop-unit">{unitSymbol(unit)}</span>
            </label>
            <label className="prop-row">
              <span className="prop-label">{t("Down")}</span>
              <input
                type="text"
                value={b}
                aria-invalid={invalid || undefined}
                onChange={(e) => {
                  setB(e.currentTarget.value);
                  setInvalid(false);
                }}
              />
              <span className="prop-unit">{unitSymbol(unit)}</span>
            </label>
            <p className="muted small">
              {t(
                "Negative values move to the left or up. Units and arithmetic work: 1.2m, 240+11.5.",
              )}
            </p>
          </>
        )}
        <div className="dialog-actions">
          <button type="submit" className="primary">
            {mode === "rotate" ? t("Rotate") : t("Move")}
          </button>
          <button type="button" onClick={onClose}>
            {t("Cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
