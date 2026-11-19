// List of the reference objects of the home (terrain, scans, neighbor houses): each can be
// shown or hidden in the plan and in 3D on its own, made fainter, and selected to change it.
// Used in the home details and in the list under the plan (status bar).

import { useEffect, useState } from "react";
import { t } from "../i18n";
import type { Home, Piece } from "../model";
import { useStore } from "../store";
import { referenceObjects, shownIn, shownOpacity, showParams } from "./referenceObjects";

type Run = (command: string, params: Record<string, unknown>) => Promise<unknown>;

/** Opacity of one object: follows the slider and is saved when it is let go. */
function OpacitySlider({ piece, run }: { piece: Piece; run: Run }) {
  const saved = shownOpacity(piece);
  const [value, setValue] = useState(saved);
  useEffect(() => setValue(saved), [saved]);
  const commit = () => {
    if (value !== saved) {
      void run("furniture_update", { id: piece.attrs.id, plan_opacity: value / 100 });
    }
  };
  return (
    <input
      type="range"
      className="reference-opacity"
      min={5}
      max={100}
      step={5}
      value={value}
      title={t("Opacity in the plan: {percent} %", { percent: value })}
      aria-label={t("Opacity of {name} in the plan", { name: piece.attrs.name })}
      onChange={(e) => setValue(Number(e.currentTarget.value))}
      onPointerUp={commit}
      onKeyUp={commit}
      onBlur={commit}
    />
  );
}

export default function ReferenceList({
  home,
  run,
  onSelect,
}: {
  home: Home;
  run: Run;
  /** Called after an object was selected (e.g. to close the list) */
  onSelect?: () => void;
}) {
  const setSelection = useStore((s) => s.setSelection);
  const references = referenceObjects(home);
  if (references.length === 0) {
    return (
      <p className="muted small">
        {t(
          'None yet: choose "As reference object" when importing a model, or mark a piece of furniture as reference object in its properties.',
        )}
      </p>
    );
  }
  return (
    <div className="reference-list">
      {references.map((p) => {
        const shown = shownIn(p);
        const show = (where: "plan" | "view3d") => (e: React.ChangeEvent<HTMLInputElement>) =>
          void run("furniture_update", {
            id: p.attrs.id,
            ...showParams(p, where, e.currentTarget.checked),
          });
        return (
          <div key={p.attrs.id} className="reference-row">
            <label title={t("Show {name} in the plan", { name: p.attrs.name })}>
              <input type="checkbox" checked={shown.plan} onChange={show("plan")} />
              {t("Plan")}
            </label>
            <label title={t("Show {name} in 3D", { name: p.attrs.name })}>
              <input type="checkbox" checked={shown.view3d} onChange={show("view3d")} />
              3D
            </label>
            <button
              type="button"
              className="link-button"
              title={t("Select it to change it")}
              onClick={() => {
                if (p.attrs.id) setSelection([p.attrs.id]);
                onSelect?.();
              }}
            >
              {p.attrs.name}
            </button>
            <OpacitySlider piece={p} run={run} />
          </div>
        );
      })}
    </div>
  );
}
