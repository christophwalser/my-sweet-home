// Catalog panel: furniture and textures of all installed libraries, grouped by
// category, with full-text search over name, category, tags and creator. Items can be
// dragged onto another category (or a new one) to move them there.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  CATALOG_DRAG_TYPE,
  type CatalogDragData,
  type CatalogItem,
  type CatalogKind,
  libResourceUrl,
} from "../api";
import { language, t } from "../i18n";
import Splitter from "../layout/Splitter";
import { usePreferences } from "../preferences";
import { useStore } from "../store";
import { useUi } from "../ui/uiStore";
import { formatPrecise } from "../units";
import { importDroppedFiles } from "./dropImport";
import FurnitureList from "./FurnitureList";

const MAX_RESULTS = 300;

/** Drag data of a catalog item that may be moved to another category */
const MOVE_TYPE = "application/x-msh-catalog-move";
type MoveData = { id: string; kind: CatalogKind; category: string };

/** Moves a catalog item to a category (the backend reloads the catalog afterwards). */
async function moveToCategory(raw: string, category: string): Promise<void> {
  const data = JSON.parse(raw) as MoveData;
  const target = category.trim();
  if (!target || target === data.category) return;
  await api.execute("catalog_set_category", {
    catalog_id: data.id,
    kind: data.kind,
    category: target,
  });
}

function formatSize(item: CatalogItem): string {
  return item.kind === "furniture"
    ? `${formatPrecise(item.width)} × ${formatPrecise(item.depth)} × ${formatPrecise(item.height)}`
    : `${formatPrecise(item.width)} × ${formatPrecise(item.height)}`;
}

/** Item the mouse points at, with the screen position of its row. */
type Hovered = { item: CatalogItem; libraryName: string; top: number; bottom: number };

/** Delay before the preview opens, so moving over the list does not flash previews. */
const PREVIEW_DELAY_MS = 250;
const PREVIEW_WIDTH = 280;

function ItemRow({
  item,
  libraryName,
  preview,
  onHover,
}: {
  item: CatalogItem;
  libraryName: string;
  /** The large preview is on: no native tooltip */
  preview: boolean;
  onHover: (hovered: Hovered | null) => void;
}) {
  const tooltip = [
    item.name,
    formatSize(item),
    item.creator && t("Creator: {name}", { name: item.creator }),
    item.license && t("License: {name}", { name: item.license }),
    t("Library: {name}", { name: libraryName }),
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <li
      className="catalog-item"
      title={preview ? undefined : tooltip}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onHover({ item, libraryName, top: r.top, bottom: r.bottom });
      }}
      onMouseLeave={() => onHover(null)}
      // Furniture can be dragged onto the plan, all items onto another category
      draggable={!!item.id}
      onDragStart={(e) => {
        onHover(null);
        if (!item.id) return;
        const move: MoveData = { id: item.id, kind: item.kind, category: item.category };
        e.dataTransfer.setData(MOVE_TYPE, JSON.stringify(move));
        if (item.kind === "furniture") {
          const data: CatalogDragData = {
            catalogId: item.id,
            doorOrWindow: item.doorOrWindow,
            name: item.name,
          };
          e.dataTransfer.setData(CATALOG_DRAG_TYPE, JSON.stringify(data));
        }
        e.dataTransfer.effectAllowed = "copyMove";
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

/** Share of the catalog in the height of the left column; the furniture list gets the rest. */
const SPLIT_KEY = "msh.catalogSplit";
const SPLIT_DEFAULT = 0.6;
const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.9;

/** Large picture and details of the item the mouse points at, beside the catalog. */
function ItemPreview({ hovered, left }: { hovered: Hovered; left: number }) {
  const { item, libraryName } = hovered;
  const height = item.kind === "textures" ? PREVIEW_WIDTH + 130 : PREVIEW_WIDTH + 150;
  // Next to the row, inside the window
  const top = Math.max(8, Math.min(hovered.top - 20, window.innerHeight - height - 8));
  const details: [string, string | null][] = [
    [t("Size"), formatSize(item)],
    [t("Category"), item.category],
    [t("Creator"), item.creator],
    [t("License"), item.license],
    [t("Library"), libraryName],
  ];
  return (
    <div className="catalog-preview" style={{ left, top, width: PREVIEW_WIDTH }} aria-hidden="true">
      <div className={`catalog-preview-image ${item.kind}`}>
        {item.icon ? (
          <img src={libResourceUrl(item.library, item.icon)} alt="" />
        ) : (
          <span className="catalog-icon-placeholder" />
        )}
      </div>
      <strong className="catalog-preview-name">{item.name}</strong>
      <dl className="catalog-preview-details">
        {details
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {item.doorOrWindow && <span className="muted small">{t("Door or window")}</span>}
    </div>
  );
}

function loadSplit(): number {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
}

export default function CatalogPanel() {
  const catalog = useStore((s) => s.catalog);
  const loading = useStore((s) => s.catalogLoading);
  const loadCatalog = useStore((s) => s.loadCatalog);
  const [kind, setKind] = useState<CatalogKind>("furniture");
  const openDialog = useUi((s) => s.openDialog);
  const previewOn = usePreferences((s) => s.catalogPreview);
  const onlineOn = usePreferences((s) => s.onlineSources);
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const hoverTimer = useRef(0);
  /** Opens the preview after a short delay; closes it at once */
  const onHover = (h: Hovered | null) => {
    window.clearTimeout(hoverTimer.current);
    if (!h) setHovered(null);
    else if (previewOn)
      hoverTimer.current = window.setTimeout(() => setHovered(h), PREVIEW_DELAY_MS);
  };
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const [query, setQuery] = useState("");
  const [homeQuery, setHomeQuery] = useState("");
  const [split, setSplit] = useState(loadSplit);
  const panelRef = useRef<HTMLDivElement>(null);
  const pieces = useStore((s) => s.opened?.home.furniture.length ?? 0);
  /** Files are dragged over the catalog / message about dropped files */
  const [dropping, setDropping] = useState(false);
  const [dropMessage, setDropMessage] = useState<string | null>(null);
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    setDropMessage(t("Importing…"));
    try {
      setDropMessage((await importDroppedFiles(files)) || null);
    } catch (err) {
      setDropMessage(String(err));
    }
  };

  // Share of the catalog in the height of the column, remembered
  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(split));
    } catch {
      // Storage unavailable: the split is just not remembered
    }
  }, [split]);
  const dragSplit = (_x: number, y: number) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    setSplit(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (y - rect.top) / rect.height)));
  };
  const [open, setOpen] = useState<Set<string>>(new Set());
  /** Category a catalog item is dragged over ("" = the "new category" zone) */
  const [dropCategory, setDropCategory] = useState<string | null>(null);
  /** A catalog item is being dragged (shows the "new category" zone) */
  const [movingItem, setMovingItem] = useState(false);
  const isMove = (e: React.DragEvent) => e.dataTransfer.types.includes(MOVE_TYPE);
  const categoryDropProps = (category: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isMove(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropCategory(category);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node))
        setDropCategory((c) => (c === category ? null : c));
    },
    onDrop: (e: React.DragEvent) => {
      if (!isMove(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setDropCategory(null);
      setMovingItem(false);
      const raw = e.dataTransfer.getData(MOVE_TYPE);
      const target = category || window.prompt(t("Name of the new category"), "")?.trim() || "";
      if (!target) return;
      // The moved item stays visible: its new category opens
      setOpen((prev) => new Set(prev).add(target));
      moveToCategory(raw, target).catch((err) => setDropMessage(String(err)));
    },
  });

  useEffect(() => {
    // Catalog content is shown in the language of the user interface when translations exist
    void loadCatalog(language());
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
    // biome-ignore lint/a11y/noStaticElementInteractions: drop zone for files from the desktop; the import buttons are the keyboard way
    <div
      className={`catalog-panel ${dropping ? "dropping" : ""}`}
      ref={panelRef}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => void onDrop(e)}
      title={t("Drop 3D models, images or libraries here to import them")}
    >
      <div className="catalog-top" style={{ flex: `${split} 1 0` }}>
        <div className="catalog-header">
          <div className="segmented">
            <button
              type="button"
              className={kind === "furniture" ? "active" : ""}
              onClick={() => setKind("furniture")}
            >
              {t("Furniture")}
            </button>
            <button
              type="button"
              className={kind === "textures" ? "active" : ""}
              onClick={() => setKind("textures")}
            >
              {t("Textures")}
            </button>
          </div>
          <input
            type="search"
            placeholder={t("Search catalog…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("Search catalog")}
          />
          <div className="catalog-tools">
            {kind === "furniture" ? (
              <button
                type="button"
                className="link-button"
                onClick={() => openDialog("importFurniture")}
                title={t("Import a 3D model as piece of furniture (OBJ, DAE, 3DS, glTF, FBX, ...)")}
              >
                {t("Import furniture…")}
              </button>
            ) : (
              <button
                type="button"
                className="link-button"
                onClick={() => openDialog("importTexture")}
                title={t("Import an image or a PBR material package as texture into the catalog")}
              >
                {t("Import textures…")}
              </button>
            )}
            <button
              type="button"
              className="link-button"
              onClick={() => openDialog("libraries")}
              title={t("Import and manage furniture and texture libraries")}
            >
              {t("Libraries…")}
            </button>
            {onlineOn && (
              <button
                type="button"
                className="link-button"
                onClick={() => openDialog("online")}
                title={t("Search and import free libraries, textures and models from the internet")}
              >
                {t("Online…")}
              </button>
            )}
          </div>
          {dropMessage && (
            <div className="catalog-drop-message" role="status">
              <span>{dropMessage}</span>
              <button type="button" onClick={() => setDropMessage(null)} aria-label={t("Close")}>
                ×
              </button>
            </div>
          )}
          <div className="catalog-count muted">
            {loading
              ? t("Loading libraries…")
              : results
                ? t("{found} of {total} items", { found: results.length, total: items.length })
                : t("{items} items in {categories} categories", {
                    items: items.length,
                    categories: categories.length,
                  })}
          </div>
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: drag start/end of catalog items only show the drop zones */}
        <div
          className="catalog-list"
          onScroll={() => onHover(null)}
          onDragStart={(e) => {
            if (isMove(e)) setMovingItem(true);
          }}
          onDragEnd={() => {
            setMovingItem(false);
            setDropCategory(null);
          }}
        >
          {results ? (
            <ul>
              {results.slice(0, MAX_RESULTS).map((i) => (
                <ItemRow
                  key={`${i.library}:${i.id ?? i.name}:${i.icon}`}
                  item={i}
                  libraryName={libraryNames.get(i.library) ?? ""}
                  preview={previewOn}
                  onHover={onHover}
                />
              ))}
              {results.length > MAX_RESULTS && (
                <li className="muted catalog-more">{t("Refine the search to see more…")}</li>
              )}
            </ul>
          ) : (
            categories.map(([category, list]) => (
              <section
                key={category}
                className={dropCategory === category ? "catalog-drop-target" : undefined}
                {...categoryDropProps(category)}
              >
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
                        preview={previewOn}
                        onHover={onHover}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}
          {!results && movingItem && (
            <div
              className={`catalog-new-category ${dropCategory === "" ? "catalog-drop-target" : ""}`}
              {...categoryDropProps("")}
            >
              {t("Drop here to move into a new category…")}
            </div>
          )}
        </div>
      </div>
      <Splitter
        orientation="horizontal"
        title={t("Drag to resize, double-click for the default size")}
        onDrag={dragSplit}
        onReset={() => setSplit(SPLIT_DEFAULT)}
      />
      {hovered && previewOn && (
        <ItemPreview
          hovered={hovered}
          left={(panelRef.current?.getBoundingClientRect().right ?? 280) + 8}
        />
      )}
      <section className="home-furniture" style={{ flex: `${1 - split} 1 0` }}>
        <div className="home-furniture-header">
          <h2>
            {t("Furniture in the home")} <span className="muted">{pieces}</span>
          </h2>
          <input
            type="search"
            placeholder={t("Search furniture in the home…")}
            value={homeQuery}
            onChange={(e) => setHomeQuery(e.target.value)}
            aria-label={t("Search furniture in the home…")}
          />
        </div>
        <div className="home-furniture-list">
          <FurnitureList query={homeQuery} />
        </div>
      </section>
    </div>
  );
}
