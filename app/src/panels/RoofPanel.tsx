// Properties of a roof: what `roof_update` makes it from, and where its piece lies.

import { t } from "../i18n";
import type { Level, Piece } from "../model";
import { coveredSize, type RoofData, type RoofEdge, roofBase, roofTexture } from "../plan2d/roof";
import { useStore } from "../store";
import { formatLength } from "../units";
import { Field, SelectField } from "./fields";
import TextureField from "./TextureField";

type Run = (command: string, params?: Record<string, unknown>) => Promise<unknown>;

const shapes = (): [string, string][] => [
  ["gable", t("Gable roof")],
  ["hip", t("Hip roof")],
  ["shed", t("Shed roof")],
  ["flat", t("Flat roof")],
];

/**
 * Name of each edge of the roof as the plan shows it: the side of a four-sided roof, else its
 * number around the roof.
 */
export function edgeNames(piece: Piece, roof: RoofData): string[] {
  const n = roof.outline.length;
  const cos = Math.cos(piece.attrs.angle ?? 0);
  const sin = Math.sin(piece.attrs.angle ?? 0);
  return roof.outline.map((p, i) => {
    if (n !== 4) return t("Edge {number}", { number: i + 1 });
    const q = roof.outline[(i + 1) % n];
    // Where the middle of the edge lies from the middle of the roof, in the plan
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    const x = (mx * cos - my * sin) * (piece.attrs.model_mirrored ? -1 : 1);
    const y = mx * sin + my * cos;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? t("Right side") : t("Left side");
    return y > 0 ? t("Bottom side") : t("Top side");
  });
}

export default function RoofPanel({
  piece,
  roof,
  levels,
  run,
}: {
  piece: Piece;
  roof: RoofData;
  levels: Level[];
  run: Run;
}) {
  const a = piece.attrs;
  const id = a.id;
  const update = (field: string) => (v: unknown) => void run("roof_update", { id, [field]: v });
  const place = (field: string) => (v: unknown) => void run("furniture_update", { id, [field]: v });
  const [width, depth] = coveredSize(roof);
  const sloped = roof.shape !== "flat";
  const names = edgeNames(piece, roof);
  const setEdge = (index: number, kind: RoofEdge) =>
    update("edges")(roof.edges.map((e, i) => (i === index ? kind : e)));
  return (
    <div className="props">
      <h2>{t("Roof")}</h2>
      <Field label={t("Name")} type="text" value={a.name} onCommit={place("name")} />
      <SelectField
        label={t("Shape")}
        value={roof.shape}
        options={
          roof.shape === "custom" ? [...shapes(), ["custom", t("Edges chosen below")]] : shapes()
        }
        onCommit={(v) => {
          if (v !== "custom") update("shape")(v);
        }}
      />
      {(roof.shape === "gable" || roof.shape === "shed") && (
        <div className="prop-actions">
          <button
            type="button"
            title={
              roof.shape === "gable"
                ? t("The ridge runs along the other direction")
                : t("The roof is low at the next edge")
            }
            onClick={() =>
              update("turn")((roof.turn + 1) % (roof.shape === "gable" ? 2 : roof.edges.length))
            }
          >
            {roof.shape === "gable" ? t("Turn the ridge") : t("Turn the slope")}
          </button>
        </div>
      )}
      {sloped && (
        <Field
          label={t("Pitch")}
          type="number"
          unit="°"
          value={roof.pitch}
          onCommit={update("pitch")}
        />
      )}
      <Field
        label={t("Overhang")}
        type="number"
        unit="cm"
        value={roof.overhang}
        onCommit={update("overhang")}
      />
      <Field
        label={t("Thickness")}
        type="number"
        unit="cm"
        value={roof.thickness}
        onCommit={update("thickness")}
      />
      <Field
        label={t("Top of the walls above the floor")}
        type="number"
        unit="cm"
        value={Math.round(roofBase(piece, roof) * 10) / 10}
        onCommit={update("base")}
      />
      <p className="muted small">
        {t("Highest point above the floor: {height}", {
          height: formatLength((a.elevation ?? 0) + a.height),
        })}
      </p>

      <h3>{t("Covered area")}</h3>
      <Field
        label={t("Width")}
        type="number"
        unit="cm"
        value={Math.round(width * 10) / 10}
        onCommit={update("width")}
      />
      <Field
        label={t("Depth")}
        type="number"
        unit="cm"
        value={Math.round(depth * 10) / 10}
        onCommit={update("depth")}
      />
      <Field label="X" type="number" unit="cm" value={a.x} onCommit={place("x")} />
      <Field label="Y" type="number" unit="cm" value={a.y} onCommit={place("y")} />
      <Field
        label={t("Angle")}
        type="number"
        unit="°"
        value={Math.round(((a.angle ?? 0) * 1800) / Math.PI) / 10}
        onCommit={place("angle_deg")}
      />
      {levels.length > 1 && (
        <SelectField
          label={t("Level")}
          value={a.level ?? ""}
          options={levels.map((l): [string, string] => [l.attrs.id, l.attrs.name])}
          onCommit={(v) => {
            place("level")(v);
            useStore.getState().selectLevel(v);
          }}
        />
      )}

      {sloped && (
        <>
          <h3>{t("Edges")}</h3>
          {roof.edges.map((edge, i) => (
            <SelectField
              // biome-ignore lint/suspicious/noArrayIndexKey: the edges have no other identity
              key={i}
              label={names[i]}
              value={edge}
              options={[
                ["eave", t("Eave (the roof rises here)")],
                ["gable", t("Gable (wall up to the roof)")],
              ]}
              onCommit={(v) => setEdge(i, v as RoofEdge)}
            />
          ))}
        </>
      )}

      <h3>{t("Roof covering")}</h3>
      <Field label={t("Color")} type="color" value={roof.color} onCommit={update("color")} />
      <TextureField
        label={t("Texture")}
        current={roofTexture(piece, roof.texture)}
        onCommit={update("texture")}
      />
      {roof.texture && (
        <p className="muted small">
          {t("The texture is shown instead of the color; its rows run along the eaves.")}
        </p>
      )}
      {sloped && (
        <>
          <h3>{t("Gable walls")}</h3>
          <Field
            label={t("Color")}
            type="color"
            value={roof.gableColor}
            onCommit={update("gable_color")}
          />
          <TextureField
            label={t("Texture")}
            current={roofTexture(piece, roof.gableTexture)}
            onCommit={update("gable_texture")}
          />
        </>
      )}
      <Field
        label={t("Visible")}
        type="checkbox"
        value={a.visible !== false}
        onCommit={place("visible")}
      />
      <p className="muted small">
        {t(
          "The plan shows a roof as its lines; click one of them to select it. It is saved as a piece of furniture with a generated model, so Sweet Home 3D shows it too, but only here it can be changed.",
        )}
      </p>
      <div className="prop-actions">
        <button type="button" onClick={() => void run("edit_delete", { ids: [id] })}>
          {t("Delete")}
        </button>
      </div>
    </div>
  );
}
