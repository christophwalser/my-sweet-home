// "Catalogs" page of the preferences: the user's own catalog servers (msh-catalog feeds,
// see docs/CATALOG_FEED.md) with name, address (web, file or file share) and an optional
// access token. They appear as sources in the online catalogs.

import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { api } from "./api";
import { t } from "./i18n";
import { type CatalogFeed, usePreferences } from "./preferences";

export default function CatalogFeedsPage() {
  const feeds = usePreferences((s) => s.catalogs);
  const update = usePreferences((s) => s.update);
  /** Result of the last test per catalog */
  const [tests, setTests] = useState<Record<string, string>>({});

  const change = (id: string, changes: Partial<CatalogFeed>) =>
    update({ catalogs: feeds.map((f) => (f.id === id ? { ...f, ...changes } : f)) });

  const add = () =>
    update({
      catalogs: [...feeds, { id: crypto.randomUUID(), name: "", url: "", token: "" }],
    });

  const remove = (id: string) => update({ catalogs: feeds.filter((f) => f.id !== id) });

  const browse = async (f: CatalogFeed) => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: t("Catalog feed"), extensions: ["json"] }],
    });
    if (typeof chosen === "string") change(f.id, { url: chosen });
  };

  const test = async (f: CatalogFeed) => {
    setTests((s) => ({ ...s, [f.id]: t("Testing…") }));
    try {
      const count = async (kind: string) =>
        (await api.execute("online_search", {
          source: "feed",
          url: f.url,
          token: f.token || undefined,
          kind,
          limit: 1,
        })) as { total: number; catalog: string | null };
      const furniture = await count("furniture");
      const textures = await count("textures");
      if (!f.name && furniture.catalog) change(f.id, { name: furniture.catalog });
      setTests((s) => ({
        ...s,
        [f.id]: t("Connected: {furniture} furniture items, {textures} texture items", {
          furniture: furniture.total,
          textures: textures.total,
        }),
      }));
    } catch (e) {
      setTests((s) => ({ ...s, [f.id]: String(e) }));
    }
  };

  return (
    <>
      <p className="muted small">
        {t(
          "Catalog servers of your organization: one JSON feed (format msh-catalog) on a web server, a file share or in a folder, listing models, textures and libraries. They appear as sources in Furniture › Online catalogs. The format is described in docs/CATALOG_FEED.md.",
        )}
      </p>
      {feeds.length === 0 && <p className="muted">{t("No catalogs added yet.")}</p>}
      {feeds.map((f) => (
        <fieldset className="prefs-group" key={f.id}>
          <legend>{f.name || t("New catalog")}</legend>
          <label className="prop-row">
            <span className="prop-label">{t("Name")}</span>
            <input value={f.name} onChange={(e) => change(f.id, { name: e.currentTarget.value })} />
          </label>
          <label className="prop-row">
            <span className="prop-label">{t("Address")}</span>
            <input
              value={f.url}
              placeholder="https://catalog.example.com/catalog.json"
              onChange={(e) => change(f.id, { url: e.currentTarget.value })}
            />
            <button type="button" onClick={() => void browse(f)}>
              {t("Browse…")}
            </button>
          </label>
          <label className="prop-row">
            <span className="prop-label">{t("Access token")}</span>
            <input
              type="password"
              value={f.token}
              placeholder={t("Only if the server asks for one")}
              autoComplete="off"
              onChange={(e) => change(f.id, { token: e.currentTarget.value })}
            />
          </label>
          <div className="prop-actions">
            <button type="button" onClick={() => void test(f)} disabled={!f.url.trim()}>
              {t("Test")}
            </button>
            <button type="button" onClick={() => remove(f.id)}>
              {t("Remove")}
            </button>
            {tests[f.id] && <span className="small">{tests[f.id]}</span>}
          </div>
        </fieldset>
      ))}
      <button type="button" className="online-add-catalog" onClick={add}>
        {t("Add catalog")}
      </button>
      <p className="muted small">
        {t("The token is stored on this computer and sent only to the catalog's own server.")}
      </p>
    </>
  );
}
