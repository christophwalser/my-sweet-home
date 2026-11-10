// Prices of furniture as Sweet Home 3D stores them: `price` as a decimal string, the VAT as a
// fraction (`valueAddedTaxPercentage` "0.2" = 20 %) and an optional ISO currency per piece.

import { locale } from "./i18n";
import type { Piece } from "./model";

/** A decimal string of the file as number, null when missing or invalid. */
export function decimal(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Price, VAT fraction, VAT amount and price with VAT of a piece (null where unknown). */
export function piecePrice(p: Piece): {
  price: number | null;
  vatFraction: number | null;
  vat: number | null;
  withVat: number | null;
} {
  const price = decimal(p.attrs.price);
  const vatFraction = decimal(p.attrs.value_added_tax_percentage);
  const vat = price !== null && vatFraction !== null ? price * vatFraction : null;
  const withVat = price !== null ? price + (vat ?? 0) : null;
  return { price, vatFraction, vat, withVat };
}

/** Sum of the given values, null when none is known. */
export function total(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

const formats = new Map<string, Intl.NumberFormat>();

/** An amount in the currency (e.g. "CHF 1’250.00" in de-CH), "" for null. */
export function formatMoney(value: number | null, currency: string): string {
  if (value === null) return "";
  const loc = locale();
  const key = `${loc}|${currency}`;
  let f = formats.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(loc, { style: "currency", currency });
    } catch {
      // Unknown currency code: plain number with two decimals
      f = new Intl.NumberFormat(loc, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    formats.set(key, f);
  }
  return f.format(value);
}
