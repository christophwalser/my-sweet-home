// Buttons over the 3D view: the standard views and the projection, the stored points of
// view (store the current view under a name, go back to it, rename it, set it to the
// current view or delete it), the levels shown in 3D and the settings.

import { type ReactNode, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { Camera } from "../model";
import { poseParams, useStore, type ViewMode } from "../store";
import { useUi } from "../ui/uiStore";
import type { CameraPose } from "./camera";
import { LEVELS_3D_OPTIONS, levels3dMode } from "./levels3d";
import { STANDARD_VIEWS, standardViewLabel } from "./standardViews";
import { runViewAction } from "./view3dBridge";

type Props = {
  /** Camera of the 3D view right now */
  currentPose: () => { mode: ViewMode; pose: CameraPose };
  /** Opens the settings of the 3D view */
  onSettings: () => void;
  /** Small pictures of the scene seen from the given cameras (data URLs, "" if none) */
  thumbnails: (poses: CameraPose[]) => string[];
  /** Buttons shown before the ones of this menu */
  leading?: ReactNode;
};

/** A name for a new point of view that is not in use: "View 1", "View 2", ... */
export function freeViewName(used: string[]): string {
  for (let n = 1; ; n++) {
    const name = t("View {n}", { n });
    if (!used.includes(name)) return name;
  }
}

function poseOf(c: Camera): CameraPose {
  const a = c.attrs;
  return { x: a.x, y: a.y, z: a.z, yaw: a.yaw, pitch: a.pitch, fov: a.field_of_view };
}

export default function ViewpointsMenu({ currentPose, onSettings, thumbnails, leading }: Props) {
  const opened = useStore((s) => s.opened);
  const selectedLevel = useStore((s) => s.selectedLevel);
  const viewMode = useStore((s) => s.viewMode);
  const hasSelection = useStore((s) => s.selection.length > 0);
  const run = useStore((s) => s.run);
  const parallel = useUi((s) => s.parallel);
  const [open, setOpen] = useState<"standard" | "views" | "levels" | null>(null);
  const [name, setName] = useState("");
  /** Point of view whose name is edited, and the one about to be deleted */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);

  // Close when clicking elsewhere and with Escape
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // In the name field of a point of view Escape only ends the renaming
      if ((e.target as HTMLElement).closest?.(".viewpoints-text input")) return;
      e.stopPropagation();
      setOpen(null);
      ref.current?.querySelector<HTMLElement>("[aria-expanded='true']")?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const cameras = opened?.home.cameras;
  // Pictures of the points of view, drawn when the menu opens and when one changes. They
  // are not stored in the file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `thumbnails` renders the scene of the moment
  useEffect(() => {
    if (open !== "views" || !cameras) return;
    const stored = cameras.filter((c) => c.attrs.role === "storedCamera");
    const urls = thumbnails(stored.map(poseOf));
    const next: Record<string, string> = {};
    stored.forEach((c, i) => {
      if (urls[i]) next[c.attrs.name ?? ""] = urls[i];
    });
    setPictures(next);
  }, [open, cameras]);

  useEffect(() => {
    if (open === "views") return;
    setRenaming(null);
    setDeleting(null);
  }, [open]);

  if (!opened) return null;
  const stored = opened.home.cameras.filter((c) => c.attrs.role === "storedCamera");
  const names = stored.map((c) => c.attrs.name ?? "");
  const mode = levels3dMode(opened.home);
  const hasLevels = opened.home.levels.length > 1;
  // Highest level first, like the storeys of the house
  const levels = [...opened.home.levels].sort(
    (a, b) =>
      b.attrs.elevation - a.attrs.elevation ||
      (b.attrs.elevation_index ?? 0) - (a.attrs.elevation_index ?? 0),
  );

  const storeAs = (n: string) => {
    const { mode: m, pose } = currentPose();
    return run("viewpoint_store", { name: n, mode: m, ...poseParams(pose) });
  };
  const store = () => {
    void storeAs(name.trim() || freeViewName(names));
    setName("");
  };
  const rename = (from: string, to: string) => {
    setRenaming(null);
    const n = to.trim();
    if (n && n !== from) void run("viewpoint_rename", { name: from, new_name: n });
  };
  const toggle = (menu: NonNullable<typeof open>) => setOpen(open === menu ? null : menu);
  const view = (action: Parameters<typeof runViewAction>[0]) => {
    runViewAction(action);
    setOpen(null);
  };

  return (
    <div className="viewpoints" ref={ref}>
      {leading}
      {viewMode !== "observer" && (
        <button
          type="button"
          className="view3d-button"
          aria-expanded={open === "standard"}
          onClick={() => toggle("standard")}
          title={t("Top view, views from the sides, isometric views and the projection")}
        >
          {t("Views ▾")}
        </button>
      )}
      <button
        type="button"
        className="view3d-button"
        aria-expanded={open === "views"}
        onClick={() => toggle("views")}
        title={t("Store the current view or go to a stored point of view")}
      >
        {t("Points of view ▾")}
      </button>
      {hasLevels && (
        <button
          type="button"
          className="view3d-button"
          aria-expanded={open === "levels"}
          onClick={() => toggle("levels")}
          title={t("Levels shown in the 3D view")}
        >
          {t("Levels ▾")}
        </button>
      )}
      <button
        type="button"
        className="view3d-button"
        onClick={onSettings}
        title={t("Ground, sky, light, section, location of the home and the sun")}
      >
        {t("3D settings…")}
      </button>
      {open === "standard" && (
        <div className="viewpoints-menu standard-views" role="menu">
          {STANDARD_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              role="menuitem"
              className="viewpoints-go"
              onClick={() => view(`view:${v}`)}
            >
              {standardViewLabel(v)}
            </button>
          ))}
          <hr />
          <button
            type="button"
            role="menuitem"
            className="viewpoints-go"
            onClick={() => view("fit")}
          >
            {t("Fit the home in the view")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="viewpoints-go"
            disabled={!hasSelection}
            onClick={() => view("zoomSelection")}
          >
            {t("Zoom to the selection")}
          </button>
          <hr />
          <label className="levels3d-row">
            <input type="checkbox" checked={parallel} onChange={() => runViewAction("parallel")} />
            {t("Parallel projection")}
          </label>
        </div>
      )}
      {open === "levels" && (
        <div className="viewpoints-menu levels3d-menu">
          {LEVELS_3D_OPTIONS.map(([value, label]) => (
            <label key={value} className="levels3d-row">
              <input
                type="radio"
                name="levels3d"
                checked={mode === value}
                onChange={() => void run("view3d_update", { levels: value })}
              />
              {label}
            </label>
          ))}
          <hr />
          {levels.map((l) => (
            <label
              key={l.attrs.id}
              className={`levels3d-row${l.attrs.id === selectedLevel ? " current" : ""}`}
            >
              <input
                type="checkbox"
                checked={l.attrs.viewable !== false}
                onChange={(e) =>
                  void run("level_update", { id: l.attrs.id, viewable: e.currentTarget.checked })
                }
              />
              {l.attrs.name}
            </label>
          ))}
          <p className="muted small">{t("A level without a tick is never shown in 3D.")}</p>
        </div>
      )}
      {open === "views" && (
        <div className="viewpoints-menu viewpoints-list">
          <form
            className="viewpoints-store"
            onSubmit={(e) => {
              e.preventDefault();
              store();
            }}
          >
            <input
              value={name}
              placeholder={freeViewName(names)}
              aria-label={t("Name of the current view")}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") e.stopPropagation();
              }}
            />
            <button type="submit" title={t("Store the current view under this name")}>
              {t("Store")}
            </button>
          </form>
          {stored.length === 0 && <p className="muted">{t("No stored points of view")}</p>}
          {stored.map((c) => {
            const n = c.attrs.name ?? "";
            const picture = pictures[n];
            return (
              <div key={`${c.observer}:${n}`} className="viewpoints-item">
                <button
                  type="button"
                  className="viewpoints-go"
                  onClick={() => {
                    void run("viewpoint_go", { name: n });
                    setOpen(null);
                  }}
                  title={t("Go to this point of view")}
                >
                  {picture ? (
                    <img className="viewpoints-picture" src={picture} alt="" />
                  ) : (
                    <span className="viewpoints-picture" />
                  )}
                </button>
                <div className="viewpoints-text">
                  {renaming === n ? (
                    <input
                      // biome-ignore lint/a11y/noAutofocus: the field appears on the user's request
                      autoFocus
                      defaultValue={n}
                      aria-label={t("Name of the point of view")}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => rename(n, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") rename(n, e.currentTarget.value);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="viewpoints-name"
                      onClick={() => {
                        void run("viewpoint_go", { name: n });
                        setOpen(null);
                      }}
                      onDoubleClick={() => setRenaming(n)}
                      onKeyDown={(e) => {
                        if (e.key === "F2") setRenaming(n);
                      }}
                    >
                      {n}
                    </button>
                  )}
                  <span className="viewpoints-mode">
                    {c.observer ? t("Virtual visit") : t("Aerial view")}
                  </span>
                  {deleting === n ? (
                    <span className="viewpoints-actions">
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          setDeleting(null);
                          void run("viewpoint_delete", { name: n });
                        }}
                      >
                        {t("Delete")}
                      </button>
                      <button type="button" onClick={() => setDeleting(null)}>
                        {t("Keep")}
                      </button>
                    </span>
                  ) : (
                    <span className="viewpoints-actions">
                      <button
                        type="button"
                        onClick={() => setRenaming(n)}
                        title={t("Rename this point of view (F2)")}
                      >
                        {t("Rename")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void storeAs(n)}
                        title={t("Set this point of view to the current view")}
                      >
                        {t("Update")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleting(n)}
                        title={t("Delete this point of view")}
                      >
                        {t("Delete")}
                      </button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
