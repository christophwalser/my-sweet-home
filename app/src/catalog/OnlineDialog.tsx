// Online catalogs: search the free libraries of Sweet Home 3D and the CC0 textures and models
// of ambientCG and Poly Haven, and import an item with one click. msh-core does the search
// and the download (online_search, online_download); the import commands add the item to
// the user's libraries, a model opens the furniture import to set its icon and size.

import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { formatNumber, t } from "../i18n";
import { usePreferences } from "../preferences";
import Icon from "../ui/Icon";
import { useUi } from "../ui/uiStore";

type Source = "sh3d" | "ambientcg" | "polyhaven";
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
  width_cm?: number | null;
  height_cm?: number | null;
};

const PAGE = 40;

const SOURCES: { id: Source; label: string; kinds: Kind[] }[] = [
  { id: "sh3d", label: "Sweet Home 3D", kinds: ["furniture", "textures"] },
  { id: "ambientcg", label: "ambientCG", kinds: ["textures"] },
  { id: "polyhaven", label: "Poly Haven", kinds: ["furniture", "textures"] },
];

/** Note about each source, shown below the results (Poly Haven asks for its credit). */
function sourceNote(source: Source): string {
  if (source === "sh3d") {
    return t(
      "Free libraries of sweethome3d.com, downloaded from SourceForge; each lists its own licenses.",
    );
  }
  if (source === "ambientcg") return t("CC0 materials of ambientCG.com: free for any use.");
  return t("Powered by Poly Haven – CC0 assets of polyhaven.com: free for any use.");
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
  const openDialog = useUi((s) => s.openDialog);
  const [source, setSource] = useState<Source>("sh3d");
  const [kind, setKind] = useState<Kind>("furniture");
  const [query, setQuery] = useState("");
  const [resolution, setResolution] = useState("1k");
  const [items, setItems] = useState<Found[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Import state per item id: running, done or an error text */
  const [states, setStates] = useState<Record<string, string>>({});

  const search = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const r = (await api.execute("online_search", {
          source,
          kind,
          query,
          offset,
          limit: PAGE,
        })) as { items: Found[]; total: number };
        setItems((old) => (offset === 0 ? r.items : [...old, ...r.items]));
        setTotal(r.total);
      } catch (e) {
        setError(String(e));
        if (offset === 0) setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [source, kind, query],
  );

  // A new source or kind lists its items right away
  // biome-ignore lint/correctness/useExhaustiveDependencies: only source and kind trigger a new list
  useEffect(() => {
    if (enabled) void search(0);
  }, [source, kind, enabled]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chooseSource = (s: Source) => {
    setSource(s);
    const kinds = SOURCES.find((x) => x.id === s)?.kinds ?? ["textures"];
    if (!kinds.includes(kind)) setKind(kinds[0]);
  };

  const importItem = async (item: Found) => {
    setStates((s) => ({ ...s, [item.id]: "running" }));
    try {
      const d = (await api.execute("online_download", {
        source,
        kind,
        id: item.id,
        resolution,
      })) as Downloaded;
      if (d.type === "library") {
        try {
          await api.execute("library_import", { path: d.path });
        } catch (e) {
          if (!String(e).includes("exists already")) throw e;
          if (!window.confirm(t("{v0} exists already. Replace it?", { v0: d.name }))) {
            setStates((s) => ({ ...s, [item.id]: "" }));
            return;
          }
          await api.execute("library_import", { path: d.path, replace: true });
        }
      } else if (d.type === "texture") {
        const width = d.width_cm ?? 100;
        await api.execute("texture_import", {
          path: d.path,
          name: d.name,
          category: SOURCES.find((x) => x.id === source)?.label,
          creator: d.creator,
          width,
          height: d.height_cm ?? width,
        });
      } else {
        // Models: the furniture import sets icon, upright position and size
        openDialog("importFurniture", d.path);
        return;
      }
      setStates((s) => ({ ...s, [item.id]: "done" }));
    } catch (e) {
      setStates((s) => ({ ...s, [item.id]: String(e) }));
    }
  };

  const kinds = SOURCES.find((x) => x.id === source)?.kinds ?? [];

  return (
    <div className="dialog-backdrop">
      <div
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
                {SOURCES.map((s) => (
                  <button
                    type="button"
                    role="tab"
                    key={s.id}
                    aria-selected={source === s.id}
                    className={source === s.id ? "active" : ""}
                    onClick={() => chooseSource(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="segmented" role="tablist" aria-label={t("Kind")}>
                {kinds.map((k) => (
                  <button
                    type="button"
                    role="tab"
                    key={k}
                    aria-selected={kind === k}
                    className={kind === k ? "active" : ""}
                    onClick={() => setKind(k)}
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
                  value={query}
                  placeholder={t("Search, e.g. wood, chair, tiles")}
                  aria-label={t("Search")}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                />
                <button type="submit" disabled={loading}>
                  {t("Search")}
                </button>
              </form>
              {source !== "sh3d" && (
                <label className="online-resolution">
                  {t("Resolution")}
                  <select value={resolution} onChange={(e) => setResolution(e.currentTarget.value)}>
                    <option value="1k">1K</option>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                  </select>
                </label>
              )}
            </div>
            <div className="online-results">
              {error && <p className="small error-text">{error}</p>}
              {!loading && !error && items.length === 0 && (
                <p className="muted">{t("Nothing found.")}</p>
              )}
              <div className="online-grid">
                {items.map((item) => {
                  const state = states[item.id] ?? "";
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
              {loading && <p className="muted">{t("Loading…")}</p>}
              {!loading && items.length < total && (
                <button
                  type="button"
                  className="online-more"
                  onClick={() => void search(items.length)}
                >
                  {t("Load more ({shown} of {total})", { shown: items.length, total })}
                </button>
              )}
            </div>
            <p className="muted small">{sourceNote(source)}</p>
          </>
        )}
      </div>
    </div>
  );
}
