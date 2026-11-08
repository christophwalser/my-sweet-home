// "Background image" section of the level (or home) properties: import, modify, show/hide,
// delete. The wizard (opened as dialog of the window) does the import and the adjustment of
// scale and origin.

import { t } from "../i18n";
import { type BackgroundImage, backgroundScale } from "../model";
import { useStore } from "../store";
import { useUi } from "../ui/uiStore";

export default function BackgroundImageSection({
  levelId,
  background,
}: {
  /** Level of the image; null for the home without levels */
  levelId: string | null;
  background: BackgroundImage | null;
}) {
  const run = useStore((s) => s.run);
  const openDialog = useUi((s) => s.openDialog);
  const level = levelId ? { level: levelId } : {};
  const hidden = background?.visible === false;

  return (
    <>
      <h2>{t("Background image")}</h2>
      {background ? (
        <p className="muted small">
          {Math.round(backgroundScale(background) * 1000) / 1000} {t("cm per pixel · origin at")}{" "}
          {Math.round(background.x_origin ?? 0)}, {Math.round(background.y_origin ?? 0)}{" "}
          {t("cm on the image")}
          {hidden ? " · hidden" : ""}
        </p>
      ) : (
        <p className="muted small">
          {t("A floor plan (image or PDF) to draw walls and rooms on, scaled to real size.")}
        </p>
      )}
      <div className="prop-actions">
        <button
          type="button"
          onClick={() => openDialog("backgroundImport")}
          title={t("Choose an image or PDF page, set its scale and origin")}
        >
          {background ? t("Replace…") : t("Import…")}
        </button>
        {background && (
          <>
            <button
              type="button"
              onClick={() => openDialog("backgroundModify")}
              title={t("Change the scale marker and the origin")}
            >
              {t("Modify…")}
            </button>
            <button
              type="button"
              onClick={() => void run("background_image_update", { ...level, visible: hidden })}
              title={hidden ? t("Show the image in the plan") : t("Hide the image in the plan")}
            >
              {hidden ? t("Show") : t("Hide")}
            </button>
            <button
              type="button"
              onClick={() => void run("background_image_remove", level)}
              title={t("Remove the background image (Ctrl+Z restores it)")}
            >
              {t("Delete")}
            </button>
          </>
        )}
      </div>
    </>
  );
}
