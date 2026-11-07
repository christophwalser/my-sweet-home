import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import "./App.css";

type AppInfo = { name: string; version: string };

export default function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    invoke<AppInfo>("app_info")
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  return (
    <div className="shell">
      <header className="toolbar">
        <strong>{info?.name ?? "My Sweet Home"}</strong>
        <span className="muted">{info ? `v${info.version}` : "Kern nicht verbunden"}</span>
      </header>
      <aside className="catalog">
        <h2>Katalog</h2>
        <p className="muted">Bibliotheken folgen in Phase P2.</p>
      </aside>
      <main className="plan">
        <p className="muted">2D-Plan</p>
      </main>
      <section className="view3d">
        <p className="muted">3D-Ansicht</p>
      </section>
    </div>
  );
}
