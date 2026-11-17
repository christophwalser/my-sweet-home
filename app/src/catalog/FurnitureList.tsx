// Furniture of the open home as a sortable table (like Sweet Home 3D's furniture list).
// Clicking a row selects the piece (and its level); the Visible column shows or hides it.
// Groups are listed as one row. The columns are chosen per home (stored like Sweet Home 3D's
// `furnitureVisibleProperty`); price columns need a currency in the preferences.

import { useMemo, useState } from "react";
import { t } from "../i18n";
import { type Furniture, isReference } from "../model";
import { usePreferences } from "../preferences";
import { formatMoney } from "../prices";
import { useStore } from "../store";
import { unitSymbol } from "../units";
import {
  available,
  COLUMNS,
  type ColumnId,
  cellText,
  cellValue,
  compareCells,
  shownColumns,
  toggled,
} from "./furnitureColumns";

const PRICE_COLUMNS: ColumnId[] = ["PRICE", "VALUE_ADDED_TAX", "PRICE_VALUE_ADDED_TAX_INCLUDED"];

/** CSS class of a header or cell: check box, amount (wider), number or text. */
function cellClass(id: ColumnId, numeric: boolean): string {
  if (id === "VISIBLE") return "check";
  if (PRICE_COLUMNS.includes(id)) return "num money";
  return numeric ? "num" : "";
}

export default function FurnitureList({ query }: { query: string }) {
  const opened = useStore((s) => s.opened);
  const selection = useStore((s) => s.selection);
  const run = useStore((s) => s.run);
  const currency = usePreferences((s) => s.currency);
  const vatEnabled = usePreferences((s) => s.vatEnabled);
  const [sort, setSort] = useState<{ column: ColumnId; desc: boolean }>({
    column: "NAME",
    desc: false,
  });
  const [choosing, setChoosing] = useState(false);

  const home = opened?.home ?? null;
  const prices = { currency, vatEnabled };
  const columns = home ? shownColumns(home, prices) : [];
  const rows = useMemo(() => {
    if (!home) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = home.furniture
      .filter((f): f is Furniture & { attrs: { id: string } } => !!f.attrs.id)
      // Reference objects (terrain, scans) are no furniture: they are in the home details
      .filter((f) => f.type !== "piece" || !isReference(f))
      .filter((f) => words.every((w) => f.attrs.name.toLowerCase().includes(w)));
    const { column, desc } = sort;
    list.sort((a, b) => {
      const cmp = compareCells(cellValue(a, home, column), cellValue(b, home, column));
      return desc ? -cmp : cmp;
    });
    return list;
  }, [home, query, sort]);

  if (!home) return <p className="muted small catalog-empty">{t("No home open")}</p>;
  const hasTotals = columns.some((c) => PRICE_COLUMNS.includes(c.id));

  const select = (f: Furniture, add: boolean) => {
    const id = f.attrs.id as string;
    const state = useStore.getState();
    const level = f.attrs.level;
    if (level && level !== state.selectedLevel) state.selectLevel(level);
    state.setSelection(
      add
        ? selection.includes(id)
          ? selection.filter((s) => s !== id)
          : [...selection, id]
        : [id],
    );
  };

  const total = (id: ColumnId) => {
    let sum: number | null = null;
    for (const f of rows) {
      const v = cellValue(f, home, id);
      if (typeof v === "number") sum = (sum ?? 0) + v;
    }
    return sum;
  };

  return (
    <div className="furniture-list">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} className={cellClass(c.id, c.numeric)}>
                <button
                  type="button"
                  onClick={() =>
                    setSort((s) => ({ column: c.id, desc: s.column === c.id ? !s.desc : false }))
                  }
                  title={`${c.full()} · ${t("Sort")}`}
                >
                  {c.id === "VISIBLE" ? "" : c.label()}
                  {sort.column === c.id ? (sort.desc ? " ▾" : " ▴") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => {
            const id = f.attrs.id as string;
            const visible = f.attrs.visible !== false;
            return (
              <tr
                key={id}
                className={`${selection.includes(id) ? "selected" : ""} ${visible ? "" : "hidden-row"}`}
                onClick={(e) => select(f, e.shiftKey || e.ctrlKey)}
              >
                {columns.map((c) => {
                  if (c.id === "VISIBLE") {
                    return (
                      <td key={c.id} className="check">
                        <input
                          type="checkbox"
                          checked={visible}
                          title={t("Visible")}
                          disabled={f.type === "group"}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            void run("furniture_update", { id, visible: e.currentTarget.checked })
                          }
                        />
                      </td>
                    );
                  }
                  const text = cellText(cellValue(f, home, c.id), c.id, currency);
                  return (
                    <td
                      key={c.id}
                      className={c.numeric ? cellClass(c.id, true) : "name"}
                      title={c.numeric ? undefined : text}
                    >
                      {text}
                      {c.id === "NAME" && f.type === "group" && (
                        <span className="muted"> ({f.items.length})</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td key={c.id} className={c.numeric ? cellClass(c.id, true) : "name"}>
                  {PRICE_COLUMNS.includes(c.id)
                    ? formatMoney(total(c.id), currency)
                    : i === columns.findIndex((x) => !x.numeric && x.id !== "VISIBLE")
                      ? t("Total")
                      : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      <div className="furniture-list-footer muted small">
        <span>{t("{n} items · sizes in {unit}", { n: rows.length, unit: unitSymbol() })}</span>
        <button
          type="button"
          className="link-button"
          aria-expanded={choosing}
          onClick={() => setChoosing(!choosing)}
        >
          {t("Columns…")}
        </button>
      </div>
      {choosing && (
        <fieldset className="furniture-columns">
          <legend>{t("Columns of the furniture list")}</legend>
          {COLUMNS.filter((c) => available(c.id, prices)).map((c) => (
            <label key={c.id} className="prefs-option">
              <input
                type="checkbox"
                checked={columns.some((x) => x.id === c.id)}
                onChange={() => void run("home_set", { furniture_columns: toggled(home, c.id) })}
              />
              <span>{c.full()}</span>
            </label>
          ))}
          {!currency && (
            <p className="muted small">{t("Price columns need a currency in the preferences.")}</p>
          )}
        </fieldset>
      )}
    </div>
  );
}
