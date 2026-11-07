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
.\scripts\check.ps1                   # Formatierung, Lints, Tests
.\scripts\compat-check.ps1            # Gegen den Original-Leser von Sweet Home 3D testen
```

## CLI (`msh`)

```powershell
cargo build -p msh-cli                # Binary: target\debug\msh.exe
msh info haus.sh3d                    # Übersicht: Ebenen, Wände, Räume mit Fläche, Möbel
msh dump haus.sh3d                    # Vollständiges Modell als JSON
msh resave haus.sh3d kopie.sh3d       # Lesen und neu speichern
msh catalog scan                      # Installierte Möbel-/Texturbibliotheken finden
msh catalog search "sofa"             # In allen Bibliotheken suchen (deutsche Namen)
msh catalog list Trees.sh3f           # Inhalt einer Bibliothek
```

Alle Befehle können mit `--json` maschinenlesbar ausgeben.

```powershell
cd app
pnpm tauri build        # Installer (MSI/NSIS) unter target\release\bundle
```

## Struktur

| Pfad | Inhalt |
|---|---|
| `crates/msh-model` | Datenmodell, 1:1 zum Format von Sweet Home 3D 7.x |
| `crates/msh-format` | `.sh3d` / `Home.xml` lesen und schreiben |
| `crates/msh-catalog` | Möbel- und Texturbibliotheken (`.sh3f`, `.sh3t`, `.jar`) |
| `crates/msh-core` | Kern: Dokument, Commands, Undo/Redo (ab P3) |
| `crates/msh-cli` | Binary `msh` (CLI, später MCP-Server) |
| `app/src-tauri` | Tauri-Backend der Desktop-App |
| `app/src` | React/TypeScript-Frontend |
| `tools/compat` | Java-Testprogramm mit dem Original-Leser von Sweet Home 3D |
| `tests/corpus` | Testdateien (Beispielprojekte; eigene Dateien in `private/`) |
| `docs/` | Architektur und Entscheidungen |

Weitere Crates (`msh-geometry`, `msh-export`, `msh-ipc`) kommen in den Phasen dazu, in denen
sie gebraucht werden.

## Lizenz

GPL-2.0-or-later (abgeleitet von Sweet Home 3D, © eTeks). Möbel- und Texturbibliotheken
werden nicht mitgeliefert und haben eigene Lizenzen.
