// Properties of a stair made by `stair_add`, and of a floor opening made by `opening_add`.

import { t } from "../i18n";
import type { Level, Piece } from "../model";
import { roofTexture } from "../plan2d/roof";
import {
  type OpeningData,
  openingOutline,
  riserHeight,
  type StairData,
  warningText,
} from "../plan2d/stair";
import { useStore } from "../store";
import { formatLength } from "../units";
import { Field, SelectField } from "./fields";
import TextureField from "./TextureField";

type Run = (command: string, params?: Record<string, unknown>) => Promise<unknown>;

const shapes = (): [string, string][] => [
  ["straight", t("Straight")],
  ["l", t("L-shaped with landing")],
  ["u", t("U-shaped with landing")],
  ["spiral", t("Spiral")],
];

/** Fields that place a piece: X, Y, angle and level. */
function Placement({ piece, levels, run }: { piece: Piece; levels: Level[]; run: Run }) {
  const a = piece.attrs;
  const place = (field: string) => (v: unknown) =>
    void run("furniture_update", { id: a.id, [field]: v });
  return (
    <>
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
    </>
  );
}

export default function StairPanel({
  piece,
  stair,
  levels,
  run,
}: {
  piece: Piece;
  stair: StairData;
  levels: Level[];
  run: Run;
}) {
  const a = piece.attrs;
  const id = a.id;
  const update = (field: string) => (v: unknown) => void run("stair_update", { id, [field]: v });
  const place = (field: string) => (v: unknown) => void run("furniture_update", { id, [field]: v });
  const riser = riserHeight(stair);
  const spiral = stair.shape === "spiral";
  const landing = stair.shape === "l" || stair.shape === "u";
  const round = (v: number) => Math.round(v * 10) / 10;
  return (
    <div className="props">
      <h2>{t("Stairs")}</h2>
      <Field label={t("Name")} type="text" value={a.name} onCommit={place("name")} />
      <SelectField
        label={t("Shape")}
        value={stair.shape}
        options={shapes()}
        onCommit={update("shape")}
      />
      {stair.shape !== "straight" && (
        <SelectField
          label={t("Turns")}
          value={stair.turn}
          options={[
            ["right", t("To the right")],
            ["left", t("To the left")],
          ]}
          onCommit={update("turn")}
        />
      )}

      <h3>{t("Risers and treads")}</h3>
      <Field
        label={t("Height to the floor above")}
        type="number"
        unit="cm"
        value={round(stair.rise)}
        onCommit={update("rise")}
      />
      <Field
        label={t("Number of risers")}
        type="number"
        value={stair.risers}
        onCommit={(v) => update("risers")(Math.round(Number(v)))}
      />
      <p className="muted small">{t("Riser height: {height}", { height: formatLength(riser) })}</p>
      <Field
        label={spiral ? t("Tread on the walking line") : t("Tread")}
        type="number"
        unit="cm"
        value={round(stair.tread)}
        onCommit={update("tread")}
      />
      {stair.warnings.length === 0 ? (
        <p className="muted small">
          {t("Step rule 2 × riser + tread = {value} cm (59–65 cm)", {
            value: String(round(2 * riser + stair.tread)),
          })}
        </p>
      ) : (
        <ul className="warning small">
          {stair.warnings.map((w) => (
            <li key={w.kind}>{warningText(w)}</li>
          ))}
        </ul>
      )}
      {landing && stair.flights.length === 2 && (
        <Field
          label={t("Treads before the landing")}
          type="number"
          value={stair.flights[0]}
          onCommit={(v) => update("first_flight")(Math.max(1, Math.round(Number(v))))}
        />
      )}

      <h3>{t("Measures")}</h3>
      {spiral ? (
        <>
          <Field
            label={t("Diameter")}
            type="number"
            unit="cm"
            value={round(stair.diameter)}
            onCommit={update("diameter")}
          />
          <Field
            label={t("Column diameter")}
            type="number"
            unit="cm"
            value={round(stair.column)}
            onCommit={update("column")}
          />
        </>
      ) : (
        <Field
          label={t("Width")}
          type="number"
          unit="cm"
          value={round(stair.width)}
          onCommit={update("width")}
        />
      )}
      {stair.shape === "u" && (
        <Field
          label={t("Gap between the flights")}
          type="number"
          unit="cm"
          value={round(stair.gap)}
          onCommit={update("gap")}
        />
      )}
      <SelectField
        label={t("Construction")}
        value={stair.style}
        options={[
          ["solid", spiral ? t("Solid steps") : t("Solid (down to the floor)")],
          ["open", spiral ? t("Treads around the column") : t("Open treads on stringers")],
        ]}
        onCommit={update("style")}
      />
      {stair.style === "open" && (
        <Field
          label={t("Tread thickness")}
          type="number"
          unit="cm"
          value={round(stair.thickness)}
          onCommit={update("thickness")}
        />
      )}
      <SelectField
        label={t("Handrails")}
        value={stair.rails}
        options={
          spiral
            ? [
                ["none", t("None")],
                ["both", t("On the outside")],
              ]
            : [
                ["none", t("None")],
                ["left", t("Left (walking up)")],
                ["right", t("Right (walking up)")],
                ["both", t("Both sides")],
              ]
        }
        onCommit={update("rails")}
      />
      <Placement piece={piece} levels={levels} run={run} />

      <h3>{t("Steps")}</h3>
      <Field label={t("Color")} type="color" value={stair.color} onCommit={update("color")} />
      <TextureField
        label={t("Texture")}
        current={roofTexture(piece, stair.texture)}
        onCommit={update("texture")}
      />
      <h3>{t("Stringers and handrails")}</h3>
      <Field
        label={t("Color")}
        type="color"
        value={stair.frameColor}
        onCommit={update("frame_color")}
      />
      <Field
        label={t("Visible")}
        type="checkbox"
        value={a.visible !== false}
        onCommit={place("visible")}
      />
      <p className="muted small">
        {t(
          "The stair cuts the hole it needs in the floor above, where the headroom of 2 m ends. It is saved as a staircase with a generated model, so Sweet Home 3D shows it too, but only here it can be changed.",
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

export function OpeningPanel({
  piece,
  opening,
  levels,
  run,
}: {
  piece: Piece;
  opening: OpeningData;
  levels: Level[];
  run: Run;
}) {
  const a = piece.attrs;
  const id = a.id;
  const update = (field: string) => (v: unknown) => void run("opening_update", { id, [field]: v });
  const corners = openingOutline(piece, opening).length;
  return (
    <div className="props">
      <h2>{t("Floor opening")}</h2>
      <Field
        label={t("Name")}
        type="text"
        value={a.name}
        onCommit={(v) => void run("furniture_update", { id, name: v })}
      />
      <Field
        label={t("Width")}
        type="number"
        unit="cm"
        value={Math.round(a.width * 10) / 10}
        onCommit={update("width")}
      />
      <Field
        label={t("Depth")}
        type="number"
        unit="cm"
        value={Math.round(a.depth * 10) / 10}
        onCommit={update("depth")}
      />
      {corners !== 4 && <p className="muted small">{t("{count} corners", { count: corners })}</p>}
      <Placement piece={piece} levels={levels} run={run} />
      <p className="muted small">
        {t(
          "A hole in the floor of this level and in the ceiling below, e.g. for a gallery or a shaft. It is saved as a staircase without steps, so Sweet Home 3D cuts the hole too.",
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
