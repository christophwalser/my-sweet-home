// Furniture of the open home as a sortable table (like Sweet Home 3D's furniture
// list). Clicking a row selects the piece (and its level); the visible checkbox
// shows or hides it. Groups are listed as one row.

import { useMemo, useState } from "react";
import { formatNumber, t } from "../i18n";
import type { Furniture, Home } from "../model";
import { useStore } from "../store";
import { formatFieldValue, toUnit, unitSymbol } from "../units";

type Column = "name" | "width" | "depth" | "height" | "elevation" | "level" | "price";

type Row = {
  id: string;
  name: string;
  group: number | null;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  levelId: string | null;
  level: string;
  visible: boolean;
  price: number | null;
};

function rowOf(item: Furniture, home: Home): Row | null {
  const levelId = item.attrs.level;
  const level = home.levels.find((l) => l.attrs.id === levelId)?.attrs.name ?? "";
  if (item.type === "group") {
    if (!item.attrs.id) return null;
    return {
      id: item.attrs.id,
      name: item.attrs.name,
      group: item.items.length,
      width: item.attrs.width ?? 0,
      depth: item.attrs.depth ?? 0,
      height: item.attrs.height ?? 0,
      elevation: item.attrs.elevation ?? 0,
      levelId,
      level,
      visible: item.attrs.visible !== false,
      price: null,
    };
  }
  const a = item.attrs;
  if (!a.id) return null;
  const price = a.price ? Number.parseFloat(a.price) : null;
  return {
    id: a.id,
    name: a.name,
    group: null,
    width: a.width,
    depth: a.depth,
    height: a.height,
    elevation: a.elevation ?? 0,
    levelId,
    level,
    visible: a.visible !== false,
    price: price !== null && Number.isFinite(price) ? price : null,
  };
}

/** A length in cm in the unit and number format of the preferences. */
const fmt = (cm: number) => formatFieldValue(toUnit(cm));

export default function FurnitureList({ query }: { query: string }) {
  const opened = useStore((s) => s.opened);
  const selection = useStore((s) => s.selection);
  const run = useStore((s) => s.run);
  const [sort, setSort] = useState<{ column: Column; desc: boolean }>({
    column: "name",
    desc: false,
  });

  const home = opened?.home ?? null;
  const rows = useMemo(() => {
    if (!home) return [];
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = home.furniture
      .map((f) => rowOf(f, home))
      .filter((r): r is Row => r !== null)
      .filter((r) => words.every((w) => r.name.toLowerCase().includes(w)));
    const { column, desc } = sort;
    list.sort((a, b) => {
      const va = a[column];
      const vb = b[column];
      const cmp =
        typeof va === "string" && typeof vb === "string"
          ? va.localeCompare(vb)
          : ((va as number | null) ?? -1) - ((vb as number | null) ?? -1);
      return desc ? -cmp : cmp;
    });
    return list;
  }, [home, query, sort]);

  if (!home) return <p className="muted small catalog-empty">{t("No home open")}</p>;
  const hasLevels = home.levels.length > 0;
  const hasPrices = rows.some((r) => r.price !== null);
  const total = rows.reduce((sum, r) => sum + (r.price ?? 0), 0);

  const header = (column: Column, label: string, numeric = true, full = label) => (
    <th className={numeric ? "num" : ""}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ column, desc: s.column === column ? !s.desc : false }))}
        title={`${full} · ${t("Sort")}`}
      >
        {label}
        {sort.column === column ? (sort.desc ? " ▾" : " ▴") : ""}
      </button>
    </th>
  );

  const select = (r: Row, add: boolean) => {
    const state = useStore.getState();
    if (r.levelId && r.levelId !== state.selectedLevel) state.selectLevel(r.levelId);
    state.setSelection(
      add
        ? selection.includes(r.id)
          ? selection.filter((s) => s !== r.id)
          : [...selection, r.id]
        : [r.id],
    );
  };

  return (
    <div className="furniture-list">
      <table>
        <thead>
          <tr>
            <th className="check" title={t("Visible")} />
            {header("name", t("Name"), false)}
            {header("width", t("W"), true, t("Width"))}
            {header("depth", t("D"), true, t("Depth"))}
            {header("height", t("H"), true, t("Height"))}
            {header("elevation", t("Elev."), true, t("Elevation"))}
            {hasLevels && header("level", t("Level"), false)}
            {hasPrices && header("price", t("Price"))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className={`${selection.includes(r.id) ? "selected" : ""} ${r.visible ? "" : "hidden-row"}`}
              onClick={(e) => select(r, e.shiftKey || e.ctrlKey)}
            >
              <td className="check">
                <input
                  type="checkbox"
                  checked={r.visible}
                  title={t("Visible")}
                  disabled={r.group !== null}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    void run("furniture_update", { id: r.id, visible: e.currentTarget.checked })
                  }
                />
              </td>
              <td className="name" title={r.name}>
                {r.name}
                {r.group !== null && <span className="muted"> ({r.group})</span>}
              </td>
              <td className="num">{fmt(r.width)}</td>
              <td className="num">{fmt(r.depth)}</td>
              <td className="num">{fmt(r.height)}</td>
              <td className="num">{fmt(r.elevation)}</td>
              {hasLevels && <td className="name">{r.level}</td>}
              {hasPrices && (
                <td className="num">{r.price !== null ? formatNumber(r.price, 2, 2) : ""}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small catalog-empty">
        {t("{n} items · sizes in {unit}", { n: rows.length, unit: unitSymbol() })}
        {hasPrices ? t(" · total {total}", { total: formatNumber(total, 2, 2) }) : ""}
      </p>
    </div>
  );
}
