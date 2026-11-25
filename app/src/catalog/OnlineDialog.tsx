// Online catalogs: search the free libraries of Sweet Home 3D, the CC0 textures and models of
// ambientCG and Poly Haven and the user's own catalog servers (feeds), and import an item
// with one click. msh-core does the search and the download (online_search,
// online_download); the import commands add the item to the user's libraries. A model opens
// the furniture import, and closing that comes back here, to the same list and position:
// the dialog's state lives in a store, not in the component.

import { useEffect, useRef } from "react";
import { create } from "zustand";
import { api } from "../api";
import { errorText } from "../errorText";
import { formatNumber, t } from "../i18n";
import { type CatalogFeed, usePreferences } from "../preferences";
import { useDialogEscape } from "../ui/dialogEscape";
import Icon from "../ui/Icon";
import { useUi } from "../ui/uiStore";
import { askReplaceLibrary } from "./dropImport";

type Kind = "furniture" | "textures";

type Found = {
  id: string;
  name: string;
  thumbnail: string | null;
  author: string | null;
  license: string;
  size: number | null;
  width_cm: number | null;
  height_cm: number | null;
};

type Downloaded = {
  path: string;
  type: "library" | "texture" | "model";
  name: string;
  creator?: string;
  category?: string;
  width_cm?: number | null;
  height_cm?: number | null;
};

/** A source of the dialog: a built-in one or a feed of the preferences. */
type SourceTab = { key: string; label: string; kinds: Kind[]; feed?: CatalogFeed };

const PAGE = 40;

const BUILT_IN: SourceTab[] = [
  { key: "sh3d", label: "Sweet Home 3D", kinds: ["furniture", "textures"] },
  { key: "ambientcg", label: "ambientCG", kinds: ["textures"] },
  { key: "polyhaven", label: "Poly Haven", kinds: ["furniture", "textures"] },
];

type OnlineState = {
  source: string;
  kind: Kind;
  query: string;
  resolution: string;
  items: Found[];
  total: number;
  /** Source, kind and query of the shown list (a new one lists again) */
  listed: string | null;
  scrollTop: number;
  /** Import state per item id: running, done or an error text */
  states: Record<string, string>;
  /** A model handed to the furniture import, and the import count at that time */
  pending: { id: string; count: number } | null;
};

const useOnline = create<OnlineState>(() => ({
  source: "sh3d",
  kind: "furniture",
  query: "",
  resolution: "1k",
  items: [],
  total: 0,
  listed: null,
  scrollTop: 0,
  states: {},
  pending: null,
}));

const setItemState = (id: string, state: string) =>
  useOnline.setState((s) => ({ states: { ...s.states, [id]: state } }));

/** Note about each source, shown below the results (Poly Haven asks for its credit). */
function sourceNote(source: string): string {
  if (source === "sh3d") {
    return t(
      "Free libraries of sweethome3d.com, downloaded from SourceForge; each lists its own licenses.",
    );
  }
  if (source === "ambientcg") return t("CC0 materials of ambientCG.com: free for any use.");
  if (source === "polyhaven")
    return t("Powered by Poly Haven – CC0 assets of polyhaven.com: free for any use.");
  return t("Catalog of your organization; see its license details for each item.");
}

/** License of a search result; msh-core names libraries without a stated license so. */
function licenseText(license: string): string {
  return license === "Free (see the library)" ? t("Free (see the library)") : license;
}

function megabytes(bytes: number | null): string {
  return bytes ? `${formatNumber(bytes / 1048576, 1)} MB` : "";
}

export default function OnlineDialog({ onClose }: { onClose: () => void }) {
  const enabled = usePreferences((s) => s.onlineSources);
  const feeds = usePreferences((s) => s.catalogs);
  const openDialog = useUi((s) => s.openDialog);
  const st = useOnline();
  const loading = useRef(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useBusy();
  const [error, setError] = useError();

  const sources: SourceTab[] = [
    ...BUILT_IN,
    ...feeds.map((f) => ({
      key: `feed:${f.id}`,
      label: f.name || t("Catalog"),
      kinds: ["furniture", "textures"] as Kind[],
      feed: f,
    })),
  ];
  const current = sources.find((s) => s.key === st.source) ?? sources[0];
  const sourceParams = (s: SourceTab) =>
    s.feed
      ? { source: "feed", url: s.feed.url, token: s.feed.token || undefined }
      : { source: s.key };

  const search = async (offset: number) => {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError(null);
    const { kind, query } = useOnline.getState();
    try {
      const r = (await api.execute("online_search", {
        ...sourceParams(current),
        kind,
        query,
        offset,
        limit: PAGE,
      })) as { items: Found[]; total: number };
      useOnline.setState((s) => ({
        items: offset === 0 ? r.items : [...s.items, ...r.items],
        total: r.total,
        listed: `${current.key}|${kind}|${query}`,
        scrollTop: offset === 0 ? 0 : s.scrollTop,
      }));
      if (offset === 0 && resultsRef.current) resultsRef.current.scrollTop = 0;
    } catch (e) {
      setError(errorText(e));
      if (offset === 0) useOnline.setState({ items: [], total: 0, listed: null });
    } finally {
      loading.current = false;
      setBusy(false);
    }
  };

  // Back from the furniture import: mark the model and restore the scroll position. A new
  // source or kind lists its items.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when source or kind change
  useEffect(() => {
    const s = useOnline.getState();
    if (s.pending) {
      const done = useUi.getState().importCount > s.pending.count;
      setItemState(s.pending.id, done ? "done" : "");
      useOnline.setState({ pending: null });
    }
    if (!enabled) return;
    if (s.listed?.startsWith(`${current.key}|${s.kind}|`) && s.items.length > 0) {
      requestAnimationFrame(() => {
        if (resultsRef.current) resultsRef.current.scrollTop = useOnline.getState().scrollTop;
      });
    } else {
      void search(0);
    }
  }, [st.source, st.kind, enabled]);

  const dialog = useRef<HTMLDivElement>(null);
  useDialogEscape(dialog, onClose);

  const chooseSource = (s: SourceTab) => {
    const kind = s.kinds.includes(st.kind) ? st.kind : s.kinds[0];
    useOnline.setState({ source: s.key, kind, listed: null, items: [], total: 0 });
  };

  const importItem = async (item: Found) => {
    setItemState(item.id, "running");
    try {
      const d = (await api.execute("online_download", {
        ...sourceParams(current),
        kind: st.kind,
        id: item.id,
        resolution: st.resolution,
      })) as Downloaded;
      if (d.type === "library") {
        try {
          await api.execute("library_import", { path: d.path });
        } catch (e) {
          if (!String(e).includes("exists already")) throw e;
          if (!(await askReplaceLibrary(d.name))) {
            setItemState(item.id, "");
            return;
          }
          await api.execute("library_import", { path: d.path, replace: true });
        }
        useUi.getState().noteImport(null);
      } else if (d.type === "texture") {
        const width = d.width_cm ?? 100;
        const added = (await api.execute("texture_import", {
          path: d.path,
          name: d.name,
          category: d.category ?? current.label,
          creator: d.creator,
          width,
          height: d.height_cm ?? width,
          ...(useUi.getState().libraryTarget ? { library: useUi.getState().libraryTarget } : {}),
        })) as { catalog_id: string };
        useUi.getState().noteImport(added.catalog_id);
      } else {
        // Models: the furniture import sets icon, upright position and size, then comes back
        useOnline.setState({
          pending: { id: item.id, count: useUi.getState().importCount },
          scrollTop: resultsRef.current?.scrollTop ?? 0,
        });
        const extra: Record<string, string> = {};
        if (d.category) extra.category = d.category;
        if (d.creator) extra.creator = d.creator;
        useUi.setState({ importQueue: [d.path] });
        openDialog("importFurniture", d.path, "online", extra);
        return;
      }
      setItemState(item.id, "done");
    } catch (e) {
      setItemState(item.id, errorText(e));
    }
  };

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialog}
        tabIndex={-1}
        className="dialog online-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("Online catalogs")}
      >
        <header className="dialog-header">
          <h2>{t("Online catalogs")}</h2>
          <button type="button" onClick={onClose} aria-label={t("Close")}>
            {"✕"}
          </button>
        </header>
        {!enabled ? (
          <p className="muted">
            {t("Online sources are turned off in the preferences (General).")}
          </p>
        ) : (
          <>
            <div className="online-bar">
              <div className="segmented" role="tablist" aria-label={t("Source")}>
                {sources.map((s) => (
                  <button
                    type="button"
                    role="tab"
                    key={s.key}
                    aria-selected={current.key === s.key}
                    className={current.key === s.key ? "active" : ""}
                    onClick={() => chooseSource(s)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="link-button online-add"
                onClick={() => openDialog("preferences", "catalogs", "online")}
                title={t("Add the catalog server of your organization")}
              >
                {t("Add catalog…")}
              </button>
            </div>
            <div className="online-bar">
              <div className="segmented" role="tablist" aria-label={t("Kind")}>
                {current.kinds.map((k) => (
                  <button
                    type="button"
                    role="tab"
                    key={k}
                    aria-selected={st.kind === k}
                    className={st.kind === k ? "active" : ""}
                    onClick={() => useOnline.setState({ kind: k })}
                  >
                    {k === "furniture" ? t("Furniture") : t("Textures")}
                  </button>
                ))}
              </div>
              <form
                className="online-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search(0);
                }}
              >
                <input
                  type="search"
                  className="online-search-input"
                  value={st.query}
                  placeholder={t("Search, e.g. wood, chair, tiles")}
                  aria-label={t("Search")}
                  onChange={(e) => useOnline.setState({ query: e.currentTarget.value })}
                />
                <button type="submit" disabled={busy}>
                  {t("Search")}
                </button>
              </form>
              {(current.key === "ambientcg" || current.key === "polyhaven") && (
                <label className="online-resolution">
                  {t("Resolution")}
                  <select
                    value={st.resolution}
                    onChange={(e) => useOnline.setState({ resolution: e.currentTarget.value })}
                  >
                    <option value="1k">1K</option>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                  </select>
                </label>
              )}
            </div>
            <div
              className="online-results"
              ref={resultsRef}
              onScroll={(e) => useOnline.setState({ scrollTop: e.currentTarget.scrollTop })}
            >
              {error && <p className="small error-text">{error}</p>}
              {!busy && !error && st.items.length === 0 && (
                <p className="muted">{t("Nothing found.")}</p>
              )}
              <div className="online-grid">
                {st.items.map((item) => {
                  const state = st.states[item.id] ?? "";
                  return (
                    <div className="online-card" key={item.id}>
                      <div className="online-thumb">
                        {item.thumbnail ? (
                          <img
                            className="online-thumb-image"
                            src={item.thumbnail}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <Icon name="library" size={40} />
                        )}
                      </div>
                      <strong className="online-name" title={item.name}>
                        {item.name}
                      </strong>
                      <span className="muted small">
                        {[item.author, licenseText(item.license)].filter(Boolean).join(" · ")}
                      </span>
                      <span className="muted small">
                        {[
                          megabytes(item.size),
                          item.width_cm
                            ? `${formatNumber(item.width_cm)} × ${formatNumber(item.height_cm ?? item.width_cm)} cm`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      <button
                        type="button"
                        disabled={state === "running" || state === "done"}
                        onClick={() => void importItem(item)}
                      >
                        {state === "running"
                          ? t("Importing…")
                          : state === "done"
                            ? t("Imported")
                            : t("Import")}
                      </button>
                      {state && state !== "running" && state !== "done" && (
                        <span className="small error-text">{state}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              {busy && <p className="muted">{t("Loading…")}</p>}
              {!busy && st.items.length < st.total && (
                <button
                  type="button"
                  className="online-more"
                  onClick={() => void search(st.items.length)}
                >
                  {t("Load more ({shown} of {total})", { shown: st.items.length, total: st.total })}
                </button>
              )}
            </div>
            <p className="muted small">{sourceNote(current.feed ? "feed" : current.key)}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Loading flag of the dialog (kept in the store's neighbour, not across closing). */
function useBusy(): [boolean, (b: boolean) => void] {
  const busy = useOnlineUi((s) => s.busy);
  return [busy, (b) => useOnlineUi.setState({ busy: b })];
}

function useError(): [string | null, (e: string | null) => void] {
  const error = useOnlineUi((s) => s.error);
  return [error, (e) => useOnlineUi.setState({ error: e })];
}

const useOnlineUi = create<{ busy: boolean; error: string | null }>(() => ({
  busy: false,
  error: null,
}));
