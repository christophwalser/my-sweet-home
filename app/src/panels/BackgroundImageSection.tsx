// "Background image" section of the level (or home) properties: import, modify, show/hide,
// delete. The wizard does the import and the adjustment of scale and origin.

import { useState } from "react";
import { docResourceUrl } from "../api";
import { type BackgroundImage, backgroundScale } from "../model";
import { useStore } from "../store";
import BackgroundImageWizard from "./BackgroundImageWizard";

export default function BackgroundImageSection({
  levelId,
  title,
  background,
}: {
  /** Level of the image; null for the home without levels */
  levelId: string | null;
  title: string;
  background: BackgroundImage | null;
}) {
  const opened = useStore((s) => s.opened);
  const run = useStore((s) => s.run);
  const [wizard, setWizard] = useState<"import" | "modify" | null>(null);
  const level = levelId ? { level: levelId } : {};
  const hidden = background?.visible === false;

  return (
    <>
      <h2>Background image</h2>
      {background ? (
        <p className="muted small">
          {Math.round(backgroundScale(background) * 1000) / 1000} cm per pixel · origin at{" "}
          {Math.round(background.x_origin ?? 0)}, {Math.round(background.y_origin ?? 0)} cm on the
          image{hidden ? " · hidden" : ""}
        </p>
      ) : (
        <p className="muted small">
          A floor plan (image or PDF) to draw walls and rooms on, scaled to real size.
        </p>
      )}
      <div className="prop-actions">
        <button
          type="button"
          onClick={() => setWizard("import")}
          title="Choose an image or PDF page, set its scale and origin"
        >
          {background ? "Replace…" : "Import…"}
        </button>
        {background && (
          <>
            <button
              type="button"
              onClick={() => setWizard("modify")}
              title="Change the scale marker and the origin"
            >
              Modify…
            </button>
            <button
              type="button"
              onClick={() => void run("background_image_update", { ...level, visible: hidden })}
              title={hidden ? "Show the image in the plan" : "Hide the image in the plan"}
            >
              {hidden ? "Show" : "Hide"}
            </button>
            <button
              type="button"
              onClick={() => void run("background_image_remove", level)}
              title="Remove the background image (Ctrl+Z restores it)"
            >
              Delete
            </button>
          </>
        )}
      </div>
      {wizard && opened && (
        <BackgroundImageWizard
          levelId={levelId}
          title={title}
          existing={
            wizard === "modify" && background
              ? { bg: background, url: docResourceUrl(opened.id, background.image) }
              : null
          }
          onClose={() => setWizard(null)}
        />
      )}
    </>
  );
}
