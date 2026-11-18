// Furniture of the open home as a sortable table (like Sweet Home 3D's furniture list).
// Clicking a row selects the piece (and its level), Ctrl+click adds it, Shift+click selects a
// range; the arrow keys walk the rows and F2 or a double-click renames a piece. The search
// looks in all shown columns, and equal pieces can share a row ("6 × Chair"). Groups are
// listed as one row. The columns are chosen per home (stored like Sweet Home 3D's
// `furnitureVisibleProperty`); price columns need a currency in the preferences.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { t } from "../i18n";
import { type Home, isReference } from "../model";
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
import {
  type ListedFurniture,
  type ListRow,
  listRows,
  matchesWords,
  rangeIds,
} from "./furnitureRows";

const PRICE_COLUMNS: ColumnId[] = ["PRICE", "VALUE_ADDED_TAX", "PRICE_VALUE_ADDED_TAX_INCLUDED"];

type Sort = { column: ColumnId; desc: boolean };

const SORT_KEY = "msh.furnitureSort";
const COMBINE_KEY = "msh.furnitureCombine";

function loadSort(): Sort {
  try {
    const v = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null") as Partial<Sort> | null;
    if (v && COLUMNS.some((c) => c.id === v.column)) {
      return { column: v.column as ColumnId, desc: v.desc === true };
    }
  } catch {
    // Storage unavailable or damaged: the default order
  }
  return { column: "NAME", desc: false };
}

function remember(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: kept until the window is closed
  }
}

/** CSS class of a header or cell: check box, amount (wider), number or text. */
function cellClass(id: ColumnId, numeric: boolean): string {
  if (id === "VISIBLE") return "check";
  if (PRICE_COLUMNS.includes(id)) return "num money";
  return numeric ? "num" : "";
}

function FurnitureList({ query }: { query: string }) {
  // Only what the list shows: unchanged parts of the home keep their identity (see applyHome),
  // so the list is not rendered again when e.g. a wall moves
  const furniture = useStore((s) => s.opened?.home.furniture);
  const levels = useStore((s) => s.opened?.home.levels);
  const visibleProperties = useStore((s) => s.opened?.home.furniture_visible_properties);
  const selection = useStore((s) => s.selection);
  const run = useStore((s) => s.run);
  const currency = usePreferences((s) => s.currency);
  const vatEnabled = usePreferences((s) => s.vatEnabled);
  const [sort, setSort] = useState<Sort>(loadSort);
  const [combine, setCombine] = useState(() => localStorage.getItem(COMBINE_KEY) === "true");
  const [choosing, setChoosing] = useState(false);
  /** Piece whose name is edited in its row */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Row clicked last: the other end of a Shift+click range */
  const anchor = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const home = useMemo(
    () =>
      furniture && levels
        ? ({ furniture, levels, furniture_visible_properties: visibleProperties } as Home)
        : null,
    [furniture, levels, visibleProperties],
  );
  const prices = { currency, vatEnabled };
  const columns = home ? shownColumns(home, prices) : [];
  // biome-ignore lint/correctness/useExhaustiveDependencies: the columns follow from the home and the price settings
  const rows = useMemo((): ListRow[] => {
    if (!home) return [];
    const list = home.furniture
      .filter((f): f is ListedFurniture => !!f.attrs.id)
      // Reference objects (terrain, scans) are no furniture: they are in the home details
      .filter((f) => f.type !== "piece" || !isReference(f))
      .filter((f) =>
        matchesWords(
          columns.map((c) => cellText(cellValue(f, home, c.id), c.id, currency)),
          query,
        ),
      );
    const { column, desc } = sort;
    list.sort((a, b) => {
      const cmp = compareCells(cellValue(a, home, column), cellValue(b, home, column));
      return desc ? -cmp : cmp;
    });
    return listRows(list, combine);
  }, [home, query, sort, combine, currency, vatEnabled]);

  // A piece selected in the plan is shown in the list
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when the selection changes
  useEffect(() => {
    listRef.current?.querySelector("tr.selected")?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  if (!home) return <p className="muted small catalog-empty">{t("No home open")}</p>;
  const hasTotals = columns.some((c) => PRICE_COLUMNS.includes(c.id));

  const select = (index: number, e: { shiftKey: boolean; ctrlKey: boolean }) => {
    const row = rows[index];
    if (!row) return;
    const state = useStore.getState();
    const level = row.first.attrs.level;
    if (level && level !== state.selectedLevel) state.selectLevel(level);
    if (e.shiftKey && anchor.current !== null) {
      state.setSelection(rangeIds(rows, anchor.current, index));
      return;
    }
    anchor.current = index;
    if (!e.ctrlKey) state.setSelection(row.ids);
    else if (row.ids.every((id) => selection.includes(id))) {
      state.setSelection(selection.filter((id) => !row.ids.includes(id)));
    } else {
      state.setSelection([...selection, ...row.ids.filter((id) => !selection.includes(id))]);
    }
  };

  const total = (id: ColumnId) => {
    let sum: number | null = null;
    for (const row of rows) {
      const v = cellValue(row.first, home, id);
      if (typeof v === "number") sum = (sum ?? 0) + v * row.ids.length;
    }
    return sum;
  };

  const rename = (ids: string[], name: string) => {
    setRenaming(null);
    if (name.trim()) void run("furniture_update", { ids, name: name.trim() });
  };

  return (
    <div className="furniture-list" ref={listRef}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} className={cellClass(c.id, c.numeric)}>
                <button
                  type="button"
                  onClick={() => {
                    const next = { column: c.id, desc: sort.column === c.id ? !sort.desc : false };
                    setSort(next);
                    remember(SORT_KEY, next);
                  }}
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
          {rows.map((row, index) => {
            const f = row.first;
            const id = f.attrs.id;
            const visible = f.attrs.visible !== false;
            const selected = row.ids.every((i) => selection.includes(i));
            return (
              <tr
                key={id}
                className={`${selected ? "selected" : ""} ${visible ? "" : "hidden-row"}`}
                tabIndex={0}
                onClick={(e) => {
                  // The row takes the keyboard: the arrow keys walk the list from here
                  e.currentTarget.focus();
                  select(index, e);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    const next = index + (e.key === "ArrowDown" ? 1 : -1);
                    if (rows[next]) {
                      select(next, { shiftKey: e.shiftKey, ctrlKey: false });
                      const tr = e.currentTarget.parentElement?.children[next];
                      (tr as HTMLElement | undefined)?.focus();
                    }
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    // Nothing to do in the list, and not a key of the plan either
                  } else if (e.key === "F2" && f.type === "piece") setRenaming(id);
                  else return;
                  // Not keys of the plan (the arrows would move the selection there)
                  e.preventDefault();
                  e.stopPropagation();
                }}
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
                            void run("furniture_update", {
                              ids: row.ids,
                              visible: e.currentTarget.checked,
                            })
                          }
                        />
                      </td>
                    );
                  }
                  const text = cellText(cellValue(f, home, c.id), c.id, currency);
                  if (c.id === "NAME" && renaming === id) {
                    return (
                      <td key={c.id} className="name">
                        <input
                          type="text"
                          className="furniture-rename"
                          aria-label={t("Name")}
                          defaultValue={f.attrs.name}
                          ref={(el) => el?.select()}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => rename(row.ids, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") e.currentTarget.blur();
                            else if (e.key === "Escape") setRenaming(null);
                          }}
                        />
                      </td>
                    );
                  }
                  return (
                    <td
                      key={c.id}
                      className={c.numeric ? cellClass(c.id, true) : "name"}
                      title={
                        c.numeric
                          ? undefined
                          : c.id === "NAME" && f.type === "piece"
                            ? `${text} · ${t("F2 or double-click to rename")}`
                            : text
                      }
                      onDoubleClick={
                        c.id === "NAME" && f.type === "piece" ? () => setRenaming(id) : undefined
                      }
                    >
                      {c.id === "NAME" && row.ids.length > 1 && (
                        <span className="furniture-count">{row.ids.length} × </span>
                      )}
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
        <span>
          {t("{n} items · sizes in {unit}", {
            n: rows.reduce((n, r) => n + r.ids.length, 0),
            unit: unitSymbol(),
          })}
        </span>
        <label title={t("Equal pieces share a row with their number, like in a parts list")}>
          <input
            type="checkbox"
            checked={combine}
            onChange={(e) => {
              setCombine(e.currentTarget.checked);
              remember(COMBINE_KEY, e.currentTarget.checked);
              anchor.current = null;
            }}
          />{" "}
          {t("Combine equal pieces")}
        </label>
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

// Rendered again only for what it shows, not with every change of the window around it
export default memo(FurnitureList);
