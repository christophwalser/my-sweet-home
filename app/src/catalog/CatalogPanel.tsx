// Catalog panel: furniture and textures of all installed libraries, grouped by
// category, with full-text search over name, category, tags and creator.

import { useEffect, useMemo, useState } from "react";
import {
  CATALOG_DRAG_TYPE,
  type CatalogDragData,
  type CatalogItem,
  type CatalogKind,
  libResourceUrl,
} from "../api";
import { useStore } from "../store";
import FurnitureList from "./FurnitureList";
import ImportFurnitureDialog from "./ImportFurnitureDialog";
import LibraryDialog from "./LibraryDialog";

const MAX_RESULTS = 300;

function formatSize(item: CatalogItem): string {
  return item.kind === "furniture"
    ? `${Math.round(item.width)} × ${Math.round(item.depth)} × ${Math.round(item.height)} cm`
    : `${item.width} × ${item.height} cm`;
}

function ItemRow({ item, libraryName }: { item: CatalogItem; libraryName: string }) {
  const tooltip = [
    item.name,
    formatSize(item),
    item.creator && `Creator: ${item.creator}`,
    item.license && `License: ${item.license}`,
    `Library: ${libraryName}`,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <li
      className="catalog-item"
      title={tooltip}
      // Furniture can be dragged onto the plan
      draggable={item.kind === "furniture" && !!item.id}
      onDragStart={(e) => {
        if (!item.id) return;
        const data: CatalogDragData = {
          catalogId: item.id,
          doorOrWindow: item.doorOrWindow,
          name: item.name,
        };
        e.dataTransfer.setData(CATALOG_DRAG_TYPE, JSON.stringify(data));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      {item.icon ? (
        <img src={libResourceUrl(item.library, item.icon)} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="catalog-icon-placeholder" />
      )}
      <span className="catalog-item-text">
        <span className="catalog-item-name">{item.name}</span>
        <span className="catalog-item-meta">{formatSize(item)}</span>
      </span>
    </li>
  );
}

export default function CatalogPanel() {
  const catalog = useStore((s) => s.catalog);
  const loading = useStore((s) => s.catalogLoading);
  const loadCatalog = useStore((s) => s.loadCatalog);
  const [kind, setKind] = useState<CatalogKind>("furniture");
  /** "home": the furniture of the open home instead of the catalog */
  const [showHome, setShowHome] = useState(false);
  const [librariesOpen, setLibrariesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Catalog content is shown in the system language when translations exist
    void loadCatalog(navigator.language.split("-")[0] || "en");
  }, [loadCatalog]);

  const libraryNames = useMemo(() => {
    const m = new Map<number, string>();
    for (const l of catalog?.libraries ?? []) {
      if (!m.has(l.index)) m.set(l.index, l.name ?? l.path);
    }
    return m;
  }, [catalog]);

  const items = useMemo(
    () => (catalog?.items ?? []).filter((i) => i.kind === kind),
    [catalog, kind],
  );

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return null;
    return items.filter((i) => {
      const hay = [i.name, i.category, i.creator ?? "", i.id ?? "", ...i.tags]
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, query]);

  const categories = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    for (const i of items) {
      const list = m.get(i.category);
      if (list) list.push(i);
      else m.set(i.category, [i]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const toggle = (category: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  return (
    <div className="catalog-panel">
      <div className="catalog-header">
        <div className="segmented">
          <button
            type="button"
            className={!showHome && kind === "furniture" ? "active" : ""}
            onClick={() => {
              setShowHome(false);
              setKind("furniture");
            }}
          >
            Furniture
          </button>
          <button
            type="button"
            className={!showHome && kind === "textures" ? "active" : ""}
            onClick={() => {
              setShowHome(false);
              setKind("textures");
            }}
          >
            Textures
          </button>
          <button
            type="button"
            className={showHome ? "active" : ""}
            onClick={() => setShowHome(true)}
            title="Furniture of the open home"
          >
            In home
          </button>
        </div>
        <input
          type="search"
          placeholder={showHome ? "Search furniture in the home…" : "Search catalog…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search catalog"
        />
        <div className="catalog-tools">
          <button
            type="button"
            className="link-button"
            onClick={() => setImportOpen(true)}
            title="Import a 3D model (OBJ, DAE, 3DS, glTF, GLB) as piece of furniture"
          >
            Import furniture…
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => setLibrariesOpen(true)}
            title="Import and manage furniture and texture libraries"
          >
            Libraries…
          </button>
        </div>
        {librariesOpen && <LibraryDialog onClose={() => setLibrariesOpen(false)} />}
        {importOpen && <ImportFurnitureDialog onClose={() => setImportOpen(false)} />}
        <div className="catalog-count muted" hidden={showHome}>
          {loading
            ? "Loading libraries…"
            : results
              ? `${results.length} of ${items.length} items`
              : `${items.length} items in ${categories.length} categories`}
        </div>
      </div>
      <div className="catalog-list">
        {showHome ? (
          <FurnitureList query={query} />
        ) : results ? (
          <ul>
            {results.slice(0, MAX_RESULTS).map((i) => (
              <ItemRow
                key={`${i.library}:${i.id ?? i.name}:${i.icon}`}
                item={i}
                libraryName={libraryNames.get(i.library) ?? ""}
              />
            ))}
            {results.length > MAX_RESULTS && (
              <li className="muted catalog-more">Refine the search to see more…</li>
            )}
          </ul>
        ) : (
          categories.map(([category, list]) => (
            <section key={category}>
              <button
                type="button"
                className="catalog-category"
                onClick={() => toggle(category)}
                aria-expanded={open.has(category)}
              >
                <span>{open.has(category) ? "▾" : "▸"}</span> {category}
                <span className="muted"> {list.length}</span>
              </button>
              {open.has(category) && (
                <ul>
                  {list.map((i) => (
                    <ItemRow
                      key={`${i.library}:${i.id ?? i.name}:${i.icon}`}
                      item={i}
                      libraryName={libraryNames.get(i.library) ?? ""}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
