// Catalog panel: furniture and textures of all installed libraries, grouped by
// category, with full-text search over name, category, tags and creator. Each item has a
// context menu (right click or ⋯): place in the plan or apply to the selection, replace the
// selection, favorite, edit, move to another category, duplicate, delete. Furniture is placed
// by a double-click and a click in the plan or by dragging; textures are dragged onto a floor,
// a wall side or a piece, or applied to the selection by a double-click. The rows take the
// keyboard: arrow keys, Enter, Delete, Ctrl+D and the menu key.

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CATALOG_DRAG_TYPE,
  type CatalogDragData,
  type CatalogItem,
  type CatalogKind,
  libResourceUrl,
  setCatalogDrag,
  TEXTURE_DRAG_TYPE,
  type TextureDragData,
} from "../api";
import { errorText } from "../errorText";
import { language, t } from "../i18n";
import Splitter from "../layout/Splitter";
import { forEachPiece } from "../model";
import ContextMenu, { type MenuItem } from "../plan2d/ContextMenu";
import { usePreferences } from "../preferences";
import { useStore } from "../store";
import { useUi } from "../ui/uiStore";
import { formatPrecise } from "../units";
import { useCatalogPrefs } from "./catalogPrefs";
import { importDroppedFiles } from "./dropImport";
import FurnitureList from "./FurnitureList";
import { categoriesFor, itemMenu, libraryOf, openEditor, undoLibrary } from "./library";

/** Search results shown before "Show all". */
const MAX_RESULTS = 300;

/** Transparent picture shown under the pointer while an item is dragged. */
const EMPTY_DRAG_IMAGE = (() => {
  const img = new Image(1, 1);
  img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  return img;
})();

/** What the plan needs to show and place a catalog piece. */
function dragData(item: CatalogItem): CatalogDragData {
  return {
    catalogId: item.id as string,
    doorOrWindow: item.doorOrWindow,
    name: item.name,
    width: item.width,
    depth: item.depth,
  };
}

/** Icon of an item, loaded for the plan canvas (which must stay readable for exports). */
function planIcon(item: CatalogItem): HTMLImageElement | null {
  if (!item.icon) return null;
  const icon = new Image();
  icon.crossOrigin = "anonymous";
  icon.src = libResourceUrl(item.library, item.icon);
  return icon;
}

/** The next click in the plan places the piece (Shift+click places several). */
function startPlacing(item: CatalogItem): void {
  const state = useStore.getState();
  if (!state.opened || !item.id || item.kind !== "furniture") return;
  state.setTool("select");
  useUi.getState().setPlacing({ data: dragData(item), icon: planIcon(item) });
}

/** IDs of the selected pieces of furniture (no groups). */
function selectedPieces(): string[] {
  const { opened, selection } = useStore.getState();
  const ids: string[] = [];
  if (opened) {
    forEachPiece(opened.home.furniture, (p) => {
      if (p.attrs.id && selection.includes(p.attrs.id)) ids.push(p.attrs.id);
    });
  }
  return ids;
}

/** IDs of the selected rooms, walls and pieces: what a texture can be applied to. */
function texturable(): string[] {
  const { opened, selection } = useStore.getState();
  if (!opened) return [];
  const sel = new Set(selection);
  return [
    ...opened.home.rooms.map((r) => r.attrs.id).filter((id): id is string => !!id && sel.has(id)),
    ...opened.home.walls.map((w) => w.attrs.id).filter((id) => sel.has(id)),
    ...selectedPieces(),
  ];
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
  favorite,
  onHover,
  onMenu,
  onPrimary,
  onShortcut,
}: {
  item: CatalogItem;
  libraryName: string;
  /** The large preview is on: no native tooltip */
  preview: boolean;
  favorite: boolean;
  onHover: (hovered: Hovered | null) => void;
  /** Opens the item's context menu at a position in the window */
  onMenu: (item: CatalogItem, x: number, y: number) => void;
  /** Double-click or Enter: place the piece, apply the texture */
  onPrimary: (item: CatalogItem) => void;
  /** Runs the menu entry with this shortcut ("Delete", "Ctrl+D") */
  onShortcut: (item: CatalogItem, shortcut: string) => void;
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
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the rows are walked with the arrow keys
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        const row = e.currentTarget;
        const menuKey = e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
        if (e.key === "Enter") onPrimary(item);
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          const rows = [
            ...(row.closest(".catalog-list")?.querySelectorAll<HTMLElement>(".catalog-item") ?? []),
          ];
          rows[rows.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          // Nothing to do in the list, and not a key of the plan either
        } else if (e.key === "Delete") onShortcut(item, "Delete");
        else if (e.ctrlKey && e.key.toLowerCase() === "d") onShortcut(item, "Ctrl+D");
        else if (menuKey) {
          const r = row.getBoundingClientRect();
          onHover(null);
          onMenu(item, r.left + 24, r.bottom);
        } else return;
        // Not a key of the plan (Delete would delete the selection there)
        e.preventDefault();
        e.stopPropagation();
      }}
      title={preview ? undefined : tooltip}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onHover({ item, libraryName, top: r.top, bottom: r.bottom });
      }}
      onMouseLeave={() => onHover(null)}
      onContextMenu={(e) => {
        e.preventDefault();
        onHover(null);
        onMenu(item, e.clientX, e.clientY);
      }}
      onDoubleClick={() => onPrimary(item)}
      // Furniture is dragged onto the plan, a texture onto a floor, wall side or piece
      draggable={!!item.id}
      onDragStart={(e) => {
        onHover(null);
        if (!item.id) return;
        e.dataTransfer.effectAllowed = "copy";
        if (item.kind === "textures") {
          const texture: TextureDragData = { catalogId: item.id, name: item.name };
          e.dataTransfer.setData(TEXTURE_DRAG_TYPE, JSON.stringify(texture));
          return;
        }
        const data = dragData(item);
        e.dataTransfer.setData(CATALOG_DRAG_TYPE, JSON.stringify(data));
        // The plan shows the piece at its size; no picture of the list row in the way
        setCatalogDrag({ data, icon: planIcon(item) });
        e.dataTransfer.setDragImage(EMPTY_DRAG_IMAGE, 0, 0);
      }}
      onDragEnd={() => setCatalogDrag(null)}
    >
      {item.icon ? (
        <img src={libResourceUrl(item.library, item.icon)} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="catalog-icon-placeholder" />
      )}
      <span className="catalog-item-text">
        <span className="catalog-item-name">
          {favorite && (
            <span className="catalog-star" title={t("Favorite")}>
              ★{" "}
            </span>
          )}
          {item.name}
        </span>
        <span className="catalog-item-meta">{formatSize(item)}</span>
      </span>
      <button
        type="button"
        className="catalog-item-more"
        aria-label={t("Actions for {name}", { name: item.name })}
        title={t("Actions (right click)")}
        onClick={(e) => {
          e.stopPropagation();
          onHover(null);
          const r = e.currentTarget.getBoundingClientRect();
          onMenu(item, r.left, r.bottom);
        }}
      >
        ⋯
      </button>
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

function CatalogPanel() {
  const catalog = useStore((s) => s.catalog);
  const loading = useStore((s) => s.catalogLoading);
  const loadCatalog = useStore((s) => s.loadCatalog);
  const [kind, setKind] = useState<CatalogKind>("furniture");
  const previewOn = usePreferences((s) => s.catalogPreview);
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
  /** The last message is about a library change that can be undone */
  const [canUndo, setCanUndo] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const notify = (text: string, undo = false) => {
    setDropMessage(text);
    setCanUndo(undo);
  };
  const favorites = useCatalogPrefs((s) => s.favorites);
  const recentFurniture = useCatalogPrefs((s) => s.recent);
  const recentTextures = useUi((s) => s.recentTextures);
  const openKeys = useCatalogPrefs((s) => s.open);
  const tiles = useCatalogPrefs((s) => s.tiles);
  const [showAll, setShowAll] = useState(false);
  /** Gives the texture to the selected rooms (floor), walls (both sides) and furniture. */
  const applyTexture = (item: CatalogItem) => {
    const ids = texturable();
    if (!item.id) return;
    if (ids.length === 0) {
      notify(t("Select rooms, walls or furniture first, or drag the texture onto the plan."));
      return;
    }
    useUi.getState().noteTexture(item.id);
    void useStore.getState().run("texture_apply", { ids, texture: item.id });
  };
  const primary = (item: CatalogItem) => {
    if (item.kind === "furniture") startPlacing(item);
    else applyTexture(item);
  };
  const menuItems = async (item: CatalogItem): Promise<MenuItem[]> => {
    const all = useStore.getState().catalogAll;
    const lib = libraryOf(item, all);
    const categories = await categoriesFor(item.kind, lib?.path ?? null);
    const opened = !!useStore.getState().opened;
    const id = item.id;
    const pieces = item.kind === "furniture" && id ? selectedPieces() : [];
    return itemMenu(item, lib, categories, {
      notify,
      place: item.kind === "furniture" && opened && id ? () => startPlacing(item) : undefined,
      apply: item.kind === "textures" && opened && id ? () => applyTexture(item) : undefined,
      replace:
        pieces.length > 0
          ? () => void useStore.getState().run("furniture_replace", { ids: pieces, catalog_id: id })
          : undefined,
      favorite: id
        ? {
            on: useCatalogPrefs.getState().favorites.includes(id),
            toggle: () => useCatalogPrefs.getState().toggleFavorite(id),
          }
        : undefined,
      edit: (path, index) => openEditor(path, index),
    });
  };
  const openMenu = async (item: CatalogItem, x: number, y: number) =>
    setMenu({ x, y, items: await menuItems(item) });
  /** Runs the entry of the item's menu that shows this shortcut, if it has one. */
  const runShortcut = async (item: CatalogItem, shortcut: string) => {
    for (const entry of await menuItems(item)) {
      if ("action" in entry && entry.shortcut === shortcut && !entry.disabled) entry.action();
    }
  };
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
      setDropMessage(errorText(err));
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

  // Favorites and the items used last, as categories above the others
  const pinned = useMemo(() => {
    const byId = new Map(items.filter((i) => i.id).map((i) => [i.id as string, i]));
    const pick = (ids: string[]) =>
      ids.map((id) => byId.get(id)).filter((i): i is CatalogItem => i !== undefined);
    const out: [string, string, CatalogItem[]][] = [
      ["*favorites", t("Favorites"), pick(favorites)],
      ["*recent", t("Used last"), pick(kind === "furniture" ? recentFurniture : recentTextures)],
    ];
    return out.filter(([, , list]) => list.length > 0);
  }, [items, favorites, recentFurniture, recentTextures, kind]);

  const isOpen = (category: string) => openKeys.includes(`${kind}:${category}`);
  const toggle = (category: string) => useCatalogPrefs.getState().toggleOpen(`${kind}:${category}`);
  const row = (i: CatalogItem) => (
    <ItemRow
      key={`${i.library}:${i.id ?? i.name}:${i.icon}`}
      item={i}
      libraryName={libraryNames.get(i.library) ?? ""}
      preview={previewOn}
      favorite={!!i.id && favorites.includes(i.id)}
      onHover={onHover}
      onMenu={(i, x, y) => void openMenu(i, x, y)}
      onPrimary={primary}
      onShortcut={(i, shortcut) => void runShortcut(i, shortcut).catch((e) => notify(errorText(e)))}
    />
  );
  const section = (key: string, title: string, list: CatalogItem[]) => (
    <section key={key}>
      <button
        type="button"
        className="catalog-category"
        onClick={() => toggle(key)}
        aria-expanded={isOpen(key)}
      >
        <span>{isOpen(key) ? "▾" : "▸"}</span> {title}
        <span className="muted"> {list.length}</span>
      </button>
      {isOpen(key) && <ul>{list.map(row)}</ul>}
    </section>
  );
  const shownResults = results && (showAll ? results : results.slice(0, MAX_RESULTS));

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
            onChange={(e) => {
              setQuery(e.target.value);
              setShowAll(false);
            }}
            aria-label={t("Search catalog")}
          />
          <div className="catalog-tools">
            <button
              type="button"
              className="link-button"
              onClick={() => useUi.getState().openDialog("libraries", `add:${kind}`)}
              title={t("Add 3D models, textures, libraries, online items or furniture of the home")}
            >
              {t("Add…")}
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => useUi.getState().openDialog("libraries")}
              title={t("Edit furniture and texture libraries: items, categories, names")}
            >
              {t("Libraries…")}
            </button>
            <button
              type="button"
              className="link-button"
              aria-pressed={tiles}
              onClick={() => useCatalogPrefs.getState().setTiles(!tiles)}
              title={t("Show the items as a list or as large tiles")}
            >
              {tiles ? t("List") : t("Tiles")}
            </button>
          </div>
          {dropMessage && (
            <div className="catalog-drop-message" role="status">
              <span>{dropMessage}</span>
              {canUndo && (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setDropMessage(null);
                    void undoLibrary().catch((e) => notify(errorText(e)));
                  }}
                >
                  {t("Undo")}
                </button>
              )}
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
        <div className={`catalog-list${tiles ? " tiles" : ""}`} onScroll={() => onHover(null)}>
          {results && shownResults ? (
            <>
              <ul>{shownResults.map(row)}</ul>
              {results.length === 0 && (
                <p className="muted catalog-more">
                  {t("Nothing in the catalog matches the search.")}
                </p>
              )}
              {results.length > shownResults.length && (
                <button
                  type="button"
                  className="link-button catalog-more"
                  onClick={() => setShowAll(true)}
                >
                  {t("Show all {n} items", { n: results.length })}
                </button>
              )}
            </>
          ) : (
            <>
              {pinned.map(([key, title, list]) => section(key, title, list))}
              {categories.map(([category, list]) => section(category, category, list))}
            </>
          )}
        </div>
      </div>
      <Splitter
        orientation="horizontal"
        title={t("Drag to resize, double-click for the default size")}
        onDrag={dragSplit}
        onReset={() => setSplit(SPLIT_DEFAULT)}
      />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} fixed onClose={() => setMenu(null)} />
      )}
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

// Rendered again only for what it shows, not with every change of the window around it
export default memo(CatalogPanel);
