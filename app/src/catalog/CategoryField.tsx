// Category of an item to import: one of the catalog's existing categories, chosen from a
// list, or a new one typed in.

import { useMemo, useState } from "react";
import type { CatalogKind } from "../api";
import { t } from "../i18n";
import { useStore } from "../store";

/** Value of the list entry that switches to typing a new category */
const NEW = "\u0000new";

export default function CategoryField({
  kind,
  value,
  onChange,
}: {
  kind: CatalogKind;
  value: string;
  onChange: (category: string) => void;
}) {
  const catalog = useStore((s) => s.catalog);
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const i of catalog?.items ?? []) if (i.kind === kind) set.add(i.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [catalog, kind]);
  // A category the catalog does not have yet is typed in
  const [typing, setTyping] = useState(() => !categories.includes(value));

  return (
    <div className="prop-row category-field">
      <span className="prop-label">{t("Category")}</span>
      <div className="category-inputs">
        <select
          aria-label={t("Category")}
          value={typing ? NEW : value}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v === NEW) {
              setTyping(true);
              onChange("");
            } else {
              setTyping(false);
              onChange(v);
            }
          }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={NEW}>{t("New category…")}</option>
        </select>
        {typing && (
          <input
            type="text"
            value={value}
            placeholder={t("Name of the new category")}
            aria-label={t("Name of the new category")}
            // biome-ignore lint/a11y/noAutofocus: the user just chose to type a new category
            autoFocus={value === ""}
            onChange={(e) => onChange(e.currentTarget.value)}
          />
        )}
      </div>
    </div>
  );
}
