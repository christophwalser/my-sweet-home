// Texture chooser of the properties panel: shows the current texture and opens a
// searchable grid of the textures of all installed libraries.

import { useMemo, useState } from "react";
import { docResourceUrl, libResourceUrl } from "../api";
import type { Texture } from "../model";
import { useStore } from "../store";

/** Number of textures shown at once in the grid (keeps the panel fast). */
const MAX_SHOWN = 150;

type Props = {
  label: string;
  current: Texture | null | undefined;
  /** Called with a catalog texture ID, or "" to remove the texture */
  onCommit: (catalogId: string) => void;
};

export default function TextureField({ label, current, onCommit }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const catalog = useStore((s) => s.catalog);
  const docId = useStore((s) => s.opened?.id);

  const textures = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (catalog?.items ?? []).filter((item) => {
      if (item.kind !== "textures" || !item.id) return false;
      const hay = `${item.name} ${item.category} ${item.tags.join(" ")}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [catalog, query]);

  const pick = (id: string) => {
    onCommit(id);
    setOpen(false);
  };

  return (
    <div className="texture-field">
      <div className="prop-row">
        <span className="prop-label">{label}</span>
        <button
          type="button"
          className="texture-button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {current && docId !== undefined && (
            <img src={docResourceUrl(docId, current.image)} alt="" />
          )}
          <span>{current?.name ?? "None"}</span>
        </button>
      </div>
      {open && (
        <div className="texture-picker">
          <div className="texture-picker-bar">
            <input
              type="search"
              placeholder="Search textures"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <button type="button" onClick={() => pick("")} disabled={!current}>
              None
            </button>
          </div>
          {!catalog && <p className="muted small">Loading catalog…</p>}
          <div className="texture-grid">
            {textures.slice(0, MAX_SHOWN).map((item) => (
              <button
                type="button"
                key={`${item.library}:${item.id}`}
                title={`${item.name} (${item.category})`}
                onClick={() => pick(item.id as string)}
              >
                {item.icon ? (
                  <img src={libResourceUrl(item.library, item.icon)} alt="" />
                ) : (
                  item.name
                )}
              </button>
            ))}
          </div>
          {textures.length > MAX_SHOWN && (
            <p className="muted small">
              {textures.length - MAX_SHOWN} more; refine the search to see them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
