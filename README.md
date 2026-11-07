# My Sweet Home

Moderne, ressourcenschonende Raumplanung für Windows, kompatibel mit den Dateiformaten von
Sweet Home 3D (`.sh3d`, `.sh3f`, `.sh3t`). Steuerbar über Oberfläche, CLI (`msh`) und MCP.

Architektur und Phasenplan: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md)

## Voraussetzungen

- Windows 11 (WebView2 ist vorinstalliert)
- Rust (stable, via rustup) mit `clippy` und `rustfmt`
- Visual Studio Build Tools 2022 mit Workload „Desktopentwicklung mit C++“ (inkl. Windows SDK)
- Node.js ≥ 22 und pnpm

## Entwickeln

```powershell
cd app
pnpm install
pnpm tauri dev          # App mit Hot Reload starten
```

```powershell
cargo run -p msh-cli -- info --json   # CLI ausprobieren
.\scripts\check.ps1                   # Formatierung, Lints, Tests
```

```powershell
cd app
pnpm tauri build        # Installer (MSI/NSIS) unter target\release\bundle
```

## Struktur

| Pfad | Inhalt |
|---|---|
| `crates/msh-core` | Kern: Dokument, Commands, Undo/Redo |
| `crates/msh-cli` | Binary `msh` (CLI, später MCP-Server) |
| `app/src-tauri` | Tauri-Backend der Desktop-App |
| `app/src` | React/TypeScript-Frontend |
| `docs/` | Architektur und Entscheidungen |

Weitere Crates (`msh-model`, `msh-format`, `msh-geometry`, `msh-catalog`, `msh-export`, `msh-ipc`)
kommen in den Phasen dazu, in denen sie gebraucht werden.

## Lizenz

GPL-2.0-or-later (abgeleitet von Sweet Home 3D, © eTeks). Möbel- und Texturbibliotheken
werden nicht mitgeliefert und haben eigene Lizenzen.
