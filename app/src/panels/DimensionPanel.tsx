// Parts of the properties panel for dimensions: the chain a dimension belongs to, the style of
// all dimensions of the home, and the elevation mark a label is.

import { t } from "../i18n";
import type { Home } from "../model";
import {
  CHAIN_ROWS,
  type ChainData,
  type ChainRowKind,
  chainIds,
  decimalComma,
  dimensionStyle,
  type ElevationMark,
  hasDimensionStyle,
} from "../plan2d/dimensionStyle";
import { useStore } from "../store";
import { Field, SelectField } from "./fields";

type Run = (command: string, params?: Record<string, unknown>) => Promise<unknown>;

const rowLabels = (): Record<ChainRowKind, string> => ({
  openings: t("Doors and windows"),
  walls: t("Adjoining walls"),
  total: t("Whole length"),
});

/** The chain the selected dimension lines belong to. */
export function ChainSection({
  home,
  chain,
  selection,
  run,
}: {
  home: Home;
  chain: ChainData;
  selection: string[];
  run: Run;
}) {
  const ids = chainIds(home, chain.id);
  const all = ids.length === selection.length;
  const update = async (params: Record<string, unknown>) => {
    const result = (await run("dimension_chain_update", { id: selection[0], ...params })) as
      | { ids?: string[] }
      | undefined;
    // The dimension lines of the chain are new ones
    if (result?.ids) useStore.getState().setSelection(result.ids);
  };
  const rows = chain.rows ?? CHAIN_ROWS;
  const setRow = (kind: ChainRowKind, on: boolean) => {
    const next = CHAIN_ROWS.filter((r) => (r === kind ? on : rows.includes(r)));
    if (next.length > 0) void update({ rows: next });
  };
  const labels = rowLabels();
  return (
    <>
      <h3>{t("Dimension chain")}</h3>
      {chain.wall && (
        <>
          {CHAIN_ROWS.map((kind) => (
            <Field
              key={kind}
              label={labels[kind]}
              type="checkbox"
              value={rows.includes(kind)}
              onCommit={(v) => setRow(kind, v === true)}
            />
          ))}
          <Field
            label={t("Distance from the wall")}
            type="number"
            unit="cm"
            value={chain.distance}
            onCommit={(v) => void update({ distance: v })}
          />
          <Field
            label={t("Distance between the rows")}
            type="number"
            unit="cm"
            value={chain.spacing}
            onCommit={(v) => void update({ spacing: v })}
          />
        </>
      )}
      <div className="prop-actions">
        {chain.wall && (
          <>
            <button
              type="button"
              title={t("After the wall, its doors and windows or the adjoining walls changed")}
              onClick={() => void update({})}
            >
              {t("Measure again")}
            </button>
            <button
              type="button"
              onClick={() => void update({ side: chain.side === "left" ? "right" : "left" })}
            >
              {t("Other side of the wall")}
            </button>
          </>
        )}
        {!all && (
          <button type="button" onClick={() => useStore.getState().setSelection(ids)}>
            {t("Select the whole chain")}
          </button>
        )}
      </div>
    </>
  );
}

/** Style of all dimensions of the home. */
export function DimensionStyleSection({ home, run }: { home: Home; run: Run }) {
  const style = dimensionStyle(home);
  const own = hasDimensionStyle(home);
  const set = (field: string) => (v: unknown) =>
    void run("dimension_style_set", {
      [field]: v,
      // The first change takes the decimal sign of the language
      ...(!own && { comma: decimalComma() }),
    });
  const plain = style.unit === "mm" || style.unit === "cm" || style.unit === "m";
  return (
    <>
      <h2>{t("Dimension style")}</h2>
      <SelectField
        label={t("Marks at the ends")}
        value={style.mark}
        options={[
          ["slash", t("Slashes")],
          ["arrow", t("Arrows")],
          ["dot", t("Dots")],
          ["none", t("None")],
        ]}
        onCommit={set("mark")}
      />
      <SelectField
        label={t("Unit of dimensions")}
        value={style.unit}
        options={[
          ["auto", t("As in the preferences")],
          ["mm", t("Millimeters")],
          ["cm", t("Centimeters")],
          ["m", t("Meters")],
          ["din", t("DIN 1356 (88⁵, 2.01)")],
        ]}
        onCommit={set("unit")}
      />
      {plain && (
        <>
          <SelectField
            label={t("Decimals")}
            value={String(style.decimals ?? -1)}
            options={[
              ["-1", t("Automatic")],
              ...[0, 1, 2, 3, 4].map((n): [string, string] => [String(n), String(n)]),
            ]}
            onCommit={(v) => set("decimals")(Number(v))}
          />
          <Field
            label={t("Write the unit")}
            type="checkbox"
            value={style.showUnit}
            onCommit={set("show_unit")}
          />
        </>
      )}
      <Field
        label={t("Text size")}
        type="number"
        unit="cm"
        value={style.fontSize ?? 18}
        onCommit={set("font_size")}
      />
      <p className="muted small">
        {t(
          "For all dimensions of the home, also in exported and printed plans. Sweet Home 3D shows them in its own style.",
        )}
      </p>
      {own && (
        <div className="prop-actions">
          <button type="button" onClick={() => void run("dimension_style_set", { reset: true })}>
            {t("Default style")}
          </button>
        </div>
      )}
    </>
  );
}

/** What an elevation mark shows. */
export function ElevationMarkFields({
  id,
  mark,
  run,
}: {
  id: string;
  mark: ElevationMark;
  run: Run;
}) {
  const set = (field: string) => (v: unknown) =>
    void run("elevation_mark_update", { id, [field]: v });
  return (
    <>
      <Field
        label={t("Height above the floor")}
        type="number"
        unit="cm"
        value={mark.height}
        onCommit={set("height")}
      />
      <SelectField
        label={t("Marks")}
        value={mark.kind}
        options={[
          ["finished", t("Finished floor (open triangle)")],
          ["raw", t("Unfinished floor (filled triangle)")],
        ]}
        onCommit={set("kind")}
      />
      <p className="muted small">
        {t("Shows the elevation of the level plus this height and follows the level.")}
      </p>
    </>
  );
}
