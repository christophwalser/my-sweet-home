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
        <span className="muted">{info ? `v${info.version}` : "Core not connected"}</span>
      </header>
      <aside className="catalog">
        <h2>Catalog</h2>
        <p className="muted">Libraries follow in phase P2.</p>
      </aside>
      <main className="plan">
        <p className="muted">2D plan</p>
      </main>
      <section className="view3d">
        <p className="muted">3D view</p>
      </section>
    </div>
  );
}
