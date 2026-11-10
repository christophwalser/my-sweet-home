// Columns of the furniture list, with the names Sweet Home 3D stores in a home
// (`furnitureVisibleProperty`), so a list chosen here shows the same columns there.

import { formatNumber, t } from "../i18n";
import type { Furniture, Home } from "../model";
import { formatMoney, piecePrice } from "../prices";
import { formatFieldValue, toUnit } from "../units";

export type ColumnId =
  | "CATALOG_ID"
  | "NAME"
  | "DESCRIPTION"
  | "CREATOR"
  | "LICENSE"
  | "WIDTH"
  | "DEPTH"
  | "HEIGHT"
  | "X"
  | "Y"
  | "ELEVATION"
  | "ANGLE"
  | "LEVEL"
  | "MODEL_SIZE"
  | "COLOR"
  | "TEXTURE"
  | "MOVABLE"
  | "DOOR_OR_WINDOW"
  | "VISIBLE"
  | "PRICE"
  | "VALUE_ADDED_TAX_PERCENTAGE"
  | "VALUE_ADDED_TAX"
  | "PRICE_VALUE_ADDED_TAX_INCLUDED";

/** Kind of a column: what it needs to be shown. */
type Need = "always" | "price" | "vat";

type ColumnDef = {
  id: ColumnId;
  /** Header text (short) and its full name */
  label: () => string;
  full: () => string;
  numeric: boolean;
  need: Need;
};

/** All columns in Sweet Home 3D's order. */
export const COLUMNS: ColumnDef[] = [
  {
    id: "CATALOG_ID",
    label: () => t("Catalog ID"),
    full: () => t("Catalog ID"),
    numeric: false,
    need: "always",
  },
  { id: "NAME", label: () => t("Name"), full: () => t("Name"), numeric: false, need: "always" },
  {
    id: "DESCRIPTION",
    label: () => t("Description"),
    full: () => t("Description"),
    numeric: false,
    need: "always",
  },
  {
    id: "CREATOR",
    label: () => t("Creator"),
    full: () => t("Creator"),
    numeric: false,
    need: "always",
  },
  {
    id: "LICENSE",
    label: () => t("License"),
    full: () => t("License"),
    numeric: false,
    need: "always",
  },
  { id: "WIDTH", label: () => t("W"), full: () => t("Width"), numeric: true, need: "always" },
  { id: "DEPTH", label: () => t("D"), full: () => t("Depth"), numeric: true, need: "always" },
  { id: "HEIGHT", label: () => t("H"), full: () => t("Height"), numeric: true, need: "always" },
  { id: "X", label: () => "X", full: () => "X", numeric: true, need: "always" },
  { id: "Y", label: () => "Y", full: () => "Y", numeric: true, need: "always" },
  {
    id: "ELEVATION",
    label: () => t("Elev."),
    full: () => t("Elevation"),
    numeric: true,
    need: "always",
  },
  { id: "ANGLE", label: () => t("Angle"), full: () => t("Angle"), numeric: true, need: "always" },
  { id: "LEVEL", label: () => t("Level"), full: () => t("Level"), numeric: false, need: "always" },
  {
    id: "MODEL_SIZE",
    label: () => t("Model size"),
    full: () => t("Model size"),
    numeric: true,
    need: "always",
  },
  { id: "COLOR", label: () => t("Color"), full: () => t("Color"), numeric: false, need: "always" },
  {
    id: "TEXTURE",
    label: () => t("Texture"),
    full: () => t("Texture"),
    numeric: false,
    need: "always",
  },
  {
    id: "MOVABLE",
    label: () => t("Movable"),
    full: () => t("Movable"),
    numeric: false,
    need: "always",
  },
  {
    id: "DOOR_OR_WINDOW",
    label: () => t("Door/window"),
    full: () => t("Door or window"),
    numeric: false,
    need: "always",
  },
  {
    id: "VISIBLE",
    label: () => t("Visible"),
    full: () => t("Visible"),
    numeric: false,
    need: "always",
  },
  { id: "PRICE", label: () => t("Price"), full: () => t("Price"), numeric: true, need: "price" },
  {
    id: "VALUE_ADDED_TAX_PERCENTAGE",
    label: () => t("VAT %"),
    full: () => t("VAT %"),
    numeric: true,
    need: "vat",
  },
  {
    id: "VALUE_ADDED_TAX",
    label: () => t("VAT"),
    full: () => t("VAT"),
    numeric: true,
    need: "vat",
  },
  {
    id: "PRICE_VALUE_ADDED_TAX_INCLUDED",
    label: () => t("Price incl. VAT"),
    full: () => t("Price incl. VAT"),
    numeric: true,
    need: "vat",
  },
];

const BY_ID = new Map(COLUMNS.map((c) => [c.id, c]));

/** Columns of a home that stores none (Sweet Home 3D shows NAME, WIDTH, DEPTH, HEIGHT, VISIBLE). */
export const DEFAULT_COLUMNS: ColumnId[] = [
  "VISIBLE",
  "NAME",
  "WIDTH",
  "DEPTH",
  "HEIGHT",
  "ELEVATION",
  "LEVEL",
  "PRICE",
];

export type PriceSettings = { currency: string; vatEnabled: boolean };

/** Whether a column can be shown with the price settings of the preferences. */
export function available(id: ColumnId, prices: PriceSettings): boolean {
  const need = BY_ID.get(id)?.need ?? "always";
  if (need === "price") return prices.currency !== "";
  if (need === "vat") return prices.currency !== "" && prices.vatEnabled;
  return true;
}

/** The columns shown: the home's list (known names) or the defaults, without unavailable ones. */
export function shownColumns(home: Home, prices: PriceSettings): ColumnDef[] {
  const stored = home.furniture_visible_properties ?? [];
  const ids = (stored.length ? stored : DEFAULT_COLUMNS).filter((id): id is ColumnId =>
    BY_ID.has(id as ColumnId),
  );
  return ids
    .filter((id) => available(id, prices))
    .filter((id) => id !== "LEVEL" || home.levels.length > 0)
    .map((id) => BY_ID.get(id) as ColumnDef);
}

/** The column list after switching `id` on or off (kept in the stored order). */
export function toggled(home: Home, id: ColumnId): ColumnId[] {
  const stored = (home.furniture_visible_properties ?? []) as ColumnId[];
  const current = stored.length ? stored : DEFAULT_COLUMNS;
  if (current.includes(id)) return current.filter((c) => c !== id);
  // A new column goes where Sweet Home 3D's order puts it among the shown ones
  const order = COLUMNS.map((c) => c.id);
  const result = [...current];
  const at = result.findIndex((c) => order.indexOf(c) > order.indexOf(id));
  result.splice(at < 0 ? result.length : at, 0, id);
  return result;
}

/** Value of a cell for sorting: a number, a string, or null (sorted first). */
export function cellValue(
  item: Furniture,
  home: Home,
  id: ColumnId,
): number | string | boolean | null {
  const a = item.attrs;
  const level = () => home.levels.find((l) => l.attrs.id === a.level)?.attrs.name ?? "";
  if (item.type === "group") {
    switch (id) {
      case "NAME":
        return a.name;
      case "WIDTH":
        return item.attrs.width ?? 0;
      case "DEPTH":
        return item.attrs.depth ?? 0;
      case "HEIGHT":
        return item.attrs.height ?? 0;
      case "X":
        return item.attrs.x ?? 0;
      case "Y":
        return item.attrs.y ?? 0;
      case "ELEVATION":
        return item.attrs.elevation ?? 0;
      case "ANGLE":
        return degrees(item.attrs.angle ?? 0);
      case "LEVEL":
        return level();
      case "VISIBLE":
        return item.attrs.visible !== false;
      case "PRICE":
      case "VALUE_ADDED_TAX":
      case "PRICE_VALUE_ADDED_TAX_INCLUDED": {
        // A group costs what its pieces cost
        const sums = groupPrices(item);
        return id === "PRICE" ? sums.price : id === "VALUE_ADDED_TAX" ? sums.vat : sums.withVat;
      }
      default:
        return null;
    }
  }
  const p = item;
  const pa = p.attrs;
  const prices = piecePrice(p);
  switch (id) {
    case "CATALOG_ID":
      return pa.catalog_id ?? "";
    case "NAME":
      return pa.name;
    case "DESCRIPTION":
      return pa.description ?? "";
    case "CREATOR":
      return pa.creator ?? "";
    case "LICENSE":
      return pa.license ?? "";
    case "WIDTH":
      return pa.width;
    case "DEPTH":
      return pa.depth;
    case "HEIGHT":
      return pa.height;
    case "X":
      return pa.x;
    case "Y":
      return pa.y;
    case "ELEVATION":
      return pa.elevation ?? 0;
    case "ANGLE":
      return degrees(pa.angle ?? 0);
    case "LEVEL":
      return level();
    case "MODEL_SIZE":
      return (pa as { model_size?: number | null }).model_size ?? null;
    case "COLOR":
      return pa.color === null || pa.color === undefined
        ? ""
        : `#${(pa.color & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
    case "TEXTURE":
      return p.texture?.name ?? "";
    case "MOVABLE":
      return pa.movable !== false;
    case "DOOR_OR_WINDOW":
      return p.kind === "DoorOrWindow";
    case "VISIBLE":
      return pa.visible !== false;
    case "PRICE":
      return prices.price;
    case "VALUE_ADDED_TAX_PERCENTAGE":
      return prices.vatFraction === null ? null : prices.vatFraction * 100;
    case "VALUE_ADDED_TAX":
      return prices.vat;
    case "PRICE_VALUE_ADDED_TAX_INCLUDED":
      return prices.withVat;
  }
}

function degrees(rad: number): number {
  const d = ((rad * 180) / Math.PI) % 360;
  return Math.round((d < 0 ? d + 360 : d) * 10) / 10;
}

/** Sums of the prices of the pieces of a group (null where no piece has one). */
export function groupPrices(item: Furniture): {
  price: number | null;
  vat: number | null;
  withVat: number | null;
} {
  const sums = {
    price: null as number | null,
    vat: null as number | null,
    withVat: null as number | null,
  };
  const add = (key: keyof typeof sums, v: number | null) => {
    if (v !== null) sums[key] = (sums[key] ?? 0) + v;
  };
  const walk = (f: Furniture) => {
    if (f.type === "group") f.items.forEach(walk);
    else {
      const p = piecePrice(f);
      add("price", p.price);
      add("vat", p.vat);
      add("withVat", p.withVat);
    }
  };
  walk(item);
  return sums;
}

/** Text of a cell (VISIBLE is drawn as a check box by the list). */
export function cellText(
  value: number | string | boolean | null,
  id: ColumnId,
  currency: string,
): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "✓" : "";
  if (typeof value === "string") return value;
  switch (id) {
    case "WIDTH":
    case "DEPTH":
    case "HEIGHT":
    case "X":
    case "Y":
    case "ELEVATION":
      return formatFieldValue(toUnit(value));
    case "ANGLE":
      return `${formatNumber(value, 1)}°`;
    case "MODEL_SIZE":
      return value >= 1048576
        ? `${formatNumber(value / 1048576, 1)} MB`
        : `${formatNumber(value / 1024, 0)} kB`;
    case "VALUE_ADDED_TAX_PERCENTAGE":
      return `${formatNumber(value, 2)} %`;
    case "PRICE":
    case "VALUE_ADDED_TAX":
    case "PRICE_VALUE_ADDED_TAX_INCLUDED":
      return formatMoney(value, currency);
    default:
      return formatNumber(value, 2);
  }
}

/** Compares two cell values for sorting (empty values first). */
export function compareCells(
  a: number | string | boolean | null,
  b: number | string | boolean | null,
): number {
  if (a === b) return 0;
  if (a === null || a === "") return -1;
  if (b === null || b === "") return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return a ? 1 : -1;
  return String(a).localeCompare(String(b));
}
