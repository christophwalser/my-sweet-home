// Library manager: the furniture and texture libraries found on this machine,
// importing library files (.sh3f / .sh3t) and removing the user's own libraries.
// Imported libraries go into Sweet Home 3D's user library folders, so both
// applications share them.

import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

type LibraryInfo = {
  path: string;
  name: string | null;
  kind: "furniture" | "textures" | null;
  furniture: number;
  textures: number;
  license: string | null;
  user: boolean;
  error?: string;
};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Where a library comes from, derived from its path. */
function origin(lib: LibraryInfo): string {
  if (lib.user) return "Your libraries";
  if (/WindowsApps|eTeks\.SweetHome3D/i.test(lib.path)) return "Sweet Home 3D (Store)";
  return "Sweet Home 3D";
}

export default function LibraryDialog({ onClose }: { onClose: () => void }) {
  const [libraries, setLibraries] = useState<LibraryInfo[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = (await api.execute("library_list")) as { libraries: LibraryInfo[] };
      setLibraries(r.libraries);
    } catch (e) {
      setMessage(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Escape closes the dialog wherever the focus is
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const importLibrary = async () => {
    const chosen = await open({
      multiple: false,
      filters: [{ name: "Sweet Home 3D libraries", extensions: ["sh3f", "sh3t"] }],
    });
    if (typeof chosen !== "string") return;
    setBusy(true);
    setMessage(null);
    try {
      let result: unknown;
      try {
        result = await api.execute("library_import", { path: chosen });
      } catch (e) {
        if (!String(e).includes("exists already")) throw e;
        if (!window.confirm(`${fileName(chosen)} exists already. Replace it?`)) return;
        result = await api.execute("library_import", { path: chosen, replace: true });
      }
      const r = result as LibraryInfo;
      setMessage(
        `Imported ${r.name ?? fileName(chosen)}: ${r.furniture || r.textures} ${
          r.kind === "textures" ? "textures" : "pieces of furniture"
        }.`,
      );
      await refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (lib: LibraryInfo) => {
    if (
      !window.confirm(
        `Remove ${lib.name ?? fileName(lib.path)}? The file is moved to the "removed" folder next to your libraries and can be restored from there.`,
      )
    )
      return;
    try {
      await api.execute("library_remove", { path: lib.path });
      setMessage(`Removed ${lib.name ?? fileName(lib.path)}.`);
      await refresh();
    } catch (e) {
      setMessage(String(e));
    }
  };

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Libraries">
        <header className="dialog-header">
          <h2>Libraries</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="muted small">
          Furniture and texture libraries of Sweet Home 3D. Imported libraries are stored in your
          Sweet Home 3D library folders, so both applications use them.
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={() => void importLibrary()} disabled={busy}>
            Import library…
          </button>
          {message && <span className="small">{message}</span>}
        </div>
        <div className="dialog-body">
          {!libraries ? (
            <p className="muted small">Loading…</p>
          ) : (
            <table className="library-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Items</th>
                  <th>Source</th>
                  <th>License</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {libraries.map((lib) => (
                  <tr key={lib.path} title={lib.path}>
                    <td>
                      {lib.name ?? fileName(lib.path)}
                      {lib.error && <span className="error-text"> ({lib.error})</span>}
                    </td>
                    <td className="num">
                      {lib.kind === "textures"
                        ? `${lib.textures} textures`
                        : `${lib.furniture} furniture`}
                    </td>
                    <td>{origin(lib)}</td>
                    <td className="license">{lib.license ?? ""}</td>
                    <td>
                      {lib.user && (
                        <button type="button" onClick={() => void remove(lib)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
