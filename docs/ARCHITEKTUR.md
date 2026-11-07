# My Sweet Home – Architektur- und Umsetzungsplan

Stand: 2026-11-07 · Status: Entwurf zur Freigabe

## 1. Ziel

Eine neu gebaute Raumplanungs-Anwendung für Windows, die

- die **Dateiformate von Sweet Home 3D** liest und schreibt (`.sh3d` Projekte, `.sh3f` Möbel-, `.sh3t` Texturbibliotheken),
- funktional mit **Sweet Home 3D 7.x** (Store-Version 7.9.27) gleichzieht,
- deutlich **weniger RAM und CPU** braucht (Ziel: < 150 MB RAM für ein mittleres Projekt, Start < 2 s; Original: 300–800 MB, JVM-Start),
- eine **moderne, aufgeräumte Oberfläche** hat (Hell/Dunkel, Ribbon-/Werkzeugleiste, Suchfeld im Katalog, Drag & Drop),
- vollständig von **KI über MCP** und von **Skripten über eine CLI** gesteuert werden kann.

## 2. Ausgangslage (Analyse)

| Quelle | Version | Befund |
|---|---|---|
| `github.com/ralic/sweethome-3d` | 5.4 (Stand 2017) | Veraltet. Nur als Referenz. Massgeblich ist der offizielle 7.x-Quellcode (SourceForge, GPL v2+). |
| `C:\Program Files\Sweet Home 3D` | 7.6.1 | Java 8 + Swing + Java3D, Furniture.jar (33 MB) und Textures.jar als Standardkatalog. |
| Microsoft Store (`eTeks.SweetHome3D`) | 7.9.27 | Gleicher Kern. Zusätzlich: FlatLaf-Oberfläche, 8 Möbelbibliotheken (~190 MB, `.sh3f`), 2 Texturbibliotheken (`.sh3t`), dazu Paywall, Lizenzprüfung, Analytics und Review-Popups. |

**Erkenntnis zur „Pro“-Version:** Die Store-Version hat keine eigenen Planungsfunktionen. Sie sperrt Funktionen, die auch in der freien Version enthalten sind, hinter einer Paywall: Modell-/Texturimport, zusätzliche Ebenen, Render- und Videoauflösung, Wand-/Raum-/3D-Bearbeitung. Gleichziehen heisst also:
1. Funktionsumfang von Sweet Home 3D 7.x komplett,
2. die zusätzlichen Möbel- und Texturbibliotheken,
3. eine moderne Oberfläche.

Paywall, Analytics und Remote-Config werden **nicht** übernommen.

Store-Bibliotheken (`…\WindowsApps\eTeks.SweetHome3D_7.9.27.0_x86__…\Sweet Home 3D\resources\`):
`BlendSwap-CC-0`, `BlendSwap-CC-BY`, `Contributions`, `KatorLegaz`, `LucaPresidente`, `Reallusion`, `Scopia`, `Trees` (Möbel), `Contributions`, `eTeksScopia` (Texturen). Alle sind auch auf sweethome3d.com erhältlich. Jede hat eine eigene Lizenz.

## 3. Entscheidungen

| # | Thema | Entscheidung |
|---|---|---|
| E1 | Technologie | Neubau: **Rust-Kern + Tauri 2 + TypeScript/React + three.js (WebGPU, Fallback WebGL2)** |
| E2 | KI-Steuerung | **MCP-Server** (kein eingebauter Chat) + **CLI** |
| E3 | Verbreitung | Offen. Deshalb: Bibliotheken werden **nie ins Repo/Programm eingebettet**, sondern aus konfigurierbaren Ordnern geladen bzw. importiert. |
| E4 | Plattform | Nur **Windows 11** (WebView2 ist vorinstalliert) |
| E5 | Lizenz des Codes | Werden Algorithmen aus dem Java-Code portiert (Wandgeometrie, Formatdetails), ist das ein abgeleitetes Werk → **GPL v2 oder später**. Das ist unproblematisch, solange die App privat bleibt. Bei Veröffentlichung muss der Quellcode GPL sein. |

## 4. Architektur

```
┌──────────────────────── Tauri-App (Windows) ────────────────────────┐
│  Frontend (WebView2): React + TypeScript                            │
│   ├─ 2D-Plan (Canvas 2D, eigene Szene, HiDPI)                       │
│   ├─ 3D-Ansicht (three.js WebGPURenderer, Lazy Loading der Modelle) │
│   ├─ Katalog (virtuelle Liste, Volltextsuche), Eigenschaften-Panels │
│   └─ Foto-Render (Pfadtracer im GPU, ersetzt SunFlow/YafaRay)       │
│                   ▲ Tauri IPC (invoke/events)                        │
│  Rust-Backend ────┴────────────────────────────────────────────────  │
│   ├─ msh-core      Dokument, Selektion, Undo/Redo, Command-Registry  │
│   ├─ msh-model     Home, Level, Wall, Room, Piece, Polyline, …       │
│   ├─ msh-geometry  Wandverbindungen, Bögen, Raumflächen, Snapping    │
│   ├─ msh-format    .sh3d / .sh3f / .sh3t lesen + schreiben           │
│   ├─ msh-catalog   Bibliotheks-Index (SQLite FTS5), Thumbnails       │
│   ├─ msh-export    PDF, SVG, OBJ, CSV                                 │
│   └─ msh-ipc       Named Pipe \\.\pipe\my-sweet-home (JSON-RPC)      │
└──────────────────────────────────────────────────────────────────────┘
        ▲ Named Pipe (laufende App)            ▲ direkt (headless)
┌───────┴──────────┐                  ┌────────┴─────────┐
│ msh mcp (stdio)  │◄── Claude etc.   │ msh <befehl> CLI │◄── Skripte
└──────────────────┘                  └──────────────────┘
```

### 4.1 Zentrale Designregel: Eine Command-Registry für alles

Jede Aktion (Wand zeichnen, Möbel platzieren, Ebene hinzufügen …) ist **ein Command** in `msh-core`. Jeder Command hat einen Namen, Parameter als JSON-Schema (via `schemars`), Undo-Logik und ein Ergebnis.

- Die **UI** ruft Commands über Tauri IPC auf.
- Die **CLI** erzeugt ihre Unterbefehle aus der Registry.
- Der **MCP-Server** erzeugt seine Tools aus derselben Registry.

So kann alles, was die Oberfläche kann, auch die KI und die CLI. Es gibt keine zweite Logik, die auseinanderlaufen kann.

### 4.2 Betriebsarten von CLI und MCP

- **Headless:** arbeitet direkt auf einer `.sh3d`-Datei, ohne Fenster. Gut für Batch, Tests und KI-Generierung.
- **Live:** verbindet sich über die Named Pipe mit der laufenden App. Die Änderungen erscheinen sofort im Fenster und landen im Undo-Verlauf.

Beispiele:
```
msh new haus.sh3d
msh wall add haus.sh3d --from 0,0 --to 500,0 --thickness 20 --height 250
msh furniture search "sofa" --json
msh --live furniture add --catalog-id eTeks#sofa --x 200 --y 150 --angle 90
msh render haus.sh3d --camera top --width 1920 --out bild.png
msh mcp            # startet MCP-Server (stdio)
```

MCP-Tools (Auszug): `home_open`, `home_save`, `home_describe` (strukturierte Zusammenfassung für die KI), `level_*`, `wall_*`, `room_*`, `furniture_search`, `furniture_add/move/modify`, `camera_set`, `view_screenshot` (liefert das Bild der 2D- oder 3D-Ansicht an die KI zurück, damit sie das Ergebnis prüfen kann), `render_photo`, `export_*`, `undo/redo`.

### 4.3 Dateikompatibilität

- `.sh3d` ist ein ZIP mit `Home.xml` (seit SH3D 5.3, DTD `SweetHome3D.dtd`), dazu Modelle und Texturen als Einträge und optional der Java-serialisierte Eintrag `Home`.
  - **Lesen:** `Home.xml`. Sehr alte Dateien (< 5.3, nur `Home`) bekommen einen eingeschränkten Java-Serialisierungs-Leser oder einen einmaligen Konverter. Das ist niedrig priorisiert.
  - **Schreiben:** `Home.xml` + Inhalte, ohne `Home`-Eintrag (so macht es auch SweetHome3DJS). **Muss früh mit SH3D 7.6.1 per Round-Trip verifiziert werden.**
  - Unbekannte Attribute und Elemente werden beim Speichern **unverändert erhalten** (forward compatibility), damit kein Datenverlust entsteht.
- `.sh3f` / `.sh3t`: ZIP mit `PluginFurnitureCatalog.properties` / `PluginTexturesCatalog.properties` (lokalisierte Schlüssel), Modelle (OBJ/MTL, 3DS, DAE), Icons und Bilder. Lesen und Schreiben (Bibliothekseditor später).
- 3D-Modellformate: OBJ, 3DS, DAE (Collada) wie im Original, zusätzlich glTF/GLB. Geladen wird im Frontend über die three.js-Loader. Rust liefert nur die Bytes.
- **Testkorpus:** `Examples.jar` (Beispielprojekte) + eigene Dateien. Automatischer Round-Trip-Test (lesen → schreiben → lesen → semantisch vergleichen).

### 4.4 Bibliotheken

- Einstellbare Bibliotheksordner. Ein **Import-Assistent** findet automatisch:
  - `C:\Program Files\Sweet Home 3D\lib\Furniture.jar` und `Textures.jar` (Standardkatalog, JAR = ZIP, gleiches Properties-Format),
  - den Ressourcenordner der Store-App,
  - `%APPDATA%\eTeks\Sweet Home 3D\furniture|textures` (vom Benutzer importierte Bibliotheken).
- Die Bibliotheken werden in einen eigenen Bibliotheksordner kopiert und in SQLite (FTS5) indiziert: Name, Kategorie, Tags, Masse, Lizenz/Autor. Sie werden nicht ins Programm gebündelt (siehe E3).
- Lizenz und Autor jedes Elements werden angezeigt. Das ist wichtig für CC-BY.

### 4.5 Ressourcensparen – wie konkret

- Kein JVM. Natives Rust-Backend, WebView2 teilt sich die Runtime mit Windows.
- Modelle werden **lazy** geladen und in GPU-Instanzen geteilt (gleiche Möbel = ein Mesh, `InstancedMesh`), mit Texturkompression (KTX2/Basis).
- 3D wird nur bei Änderungen neu gezeichnet (kein Dauer-Renderloop im Leerlauf).
- Katalog: virtuelle Liste, Thumbnails im Cache auf der Festplatte, nicht im RAM.
- Messung: Benchmark-Skript vergleicht RAM, CPU und Startzeit mit dem Original anhand derselben Beispieldateien.

## 5. Funktionsumfang (Parität mit SH3D 7.x)

Pflicht (in Phasen umgesetzt):
- Ebenen (inkl. gleiche Höhe), Wände (gerade, gebogen, Höhen an beiden Enden, Muster, Sockelleisten), Räume (Boden/Decke, Flächen), Polylinien, Masslinien, Beschriftungen, Kompass
- Möbel: platzieren, drehen (3 Achsen), skalieren, spiegeln, Materialien/Texturen ändern, gruppieren, Türen und Fenster mit Wandaussparung, Lichtquellen
- Möbelliste mit sortierbaren Spalten, Preis und MwSt.
- 3D: Ansicht von oben und virtueller Besucher, Hintergrundbilder/Himmel, Lichter
- Foto-Render (Qualitätsstufen) und Video entlang eines Kamerapfads
- Import: Möbel- und Texturassistent, Hintergrundplan-Bild, Bibliotheken
- Export: PDF/Druck, SVG, OBJ, CSV, Bild
- Einstellungen, Masseinheiten, Magnetismus/Raster, Undo/Redo, Kopieren/Einfügen zwischen Projekten
- Sprachen: Deutsch, Englisch (weitere über Übersetzungsdateien)

Bewusst **nicht** übernommen: Java-Plugins von SH3D (nicht kompatibel; Ersatz sind die CLI/MCP-Commands bzw. später ein eigenes Plugin-System), Paywall, Analytics.

## 6. Phasenplan

| Phase | Inhalt | Ergebnis / Abnahme |
|---|---|---|
| **P0 Setup** | Rust (rustup, MSVC Build Tools), pnpm, Tauri CLI, Git-Repo, Cargo-Workspace + Frontend-Gerüst, CI-Skripte, Lint/Format | `pnpm tauri dev` startet ein leeres Fenster |
| **P1 Format & Modell** | `msh-model`, `msh-format` (Home.xml lesen/schreiben), Katalog-Leser `.sh3f/.sh3t/.jar`, Round-Trip-Tests | Alle Beispieldateien round-trip-fähig, von SH3D 7.6.1 wieder öffnenbar |
| **P2 Viewer** | Datei öffnen, 2D-Plan, 3D-Ansicht (nur lesen), Katalog durchsuchen | Beispielprojekte sehen im Wesentlichen aus wie im Original |
| **P3 Commands + CLI + MCP** | Command-Registry, Undo/Redo, `msh` CLI headless, MCP-Server, Named Pipe für Live-Modus, `view_screenshot` | Claude kann über MCP ein einfaches Haus (Wände, Räume, Möbel) anlegen und speichern |
| **P4 Bearbeiten** | Alle Zeichenwerkzeuge im 2D-Plan, Eigenschaften-Dialoge, Ebenen, Magnetismus, Kopieren/Einfügen | Ein realer Grundriss lässt sich komplett in der App zeichnen |
| **P5 Bibliotheken & Import** | Import-Assistent für Bibliotheken, Möbel- und Texturimport (OBJ/DAE/3DS/glTF), Material-Editor | Alle installierten Bibliotheken nutzbar, eigene Modelle importierbar |
| **P6 Render & Export** | Foto-Render (Pfadtracer), Video, PDF/SVG/OBJ/CSV, Druck | Exporte entsprechen dem Original |
| **P7 Feinschliff** | Einstellungen, i18n, Barrierefreiheit, Performance-Benchmarks, Installer (MSI via Tauri), optional Auto-Update | Release-Kandidat 1.0 |

Realistische Einschätzung: P0–P3 ergeben schnell eine KI-steuerbare Basis. Volle Parität (P4–P7) ist ein Projekt von **mehreren Monaten**. Die Phasen sind so geschnitten, dass nach jeder Phase etwas Nutzbares entsteht.

## 7. Repo-Struktur

```
my-sweet-home/
├─ Cargo.toml                  # Workspace
├─ crates/
│  ├─ msh-model/  msh-geometry/  msh-format/  msh-catalog/
│  ├─ msh-core/   msh-export/    msh-ipc/
│  └─ msh-cli/                 # Binary "msh" (CLI + "msh mcp")
├─ app/
│  ├─ src-tauri/               # Tauri-Backend (bindet crates ein)
│  └─ src/                     # React/TS-Frontend (plan2d/, view3d/, catalog/, panels/)
├─ tests/corpus/               # Test-.sh3d (nur eigene/freie Dateien)
├─ docs/
└─ libraries/                  # lokal, in .gitignore – importierte Bibliotheken
```

## 8. Offene Punkte (nicht blockierend)

- Name der App (Arbeitstitel „My Sweet Home“, Binary `msh`)
- Verbreitung / Lizenzmodell (E3), spätestens vor der ersten Weitergabe
- Ob ein Konverter für sehr alte `.sh3d`-Dateien (< 5.3) nötig ist
