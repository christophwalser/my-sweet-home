# My Sweet Home on macOS and Linux – analysis

Status: analysis only, no port planned (2026-11-09). Decision D4 in `docs/ARCHITECTURE.md`
("Windows 11 only") stays in force until the user decides otherwise.

Line references (`path:line`) were taken from the working tree on 2026-11-09 while the P12f
installer work was in progress (it changes `app/src-tauri/src/lib.rs`, `commands.rs`,
`crates/msh-catalog/src/lib.rs` and the Tauri config), so some numbers may have shifted.

## Summary

- **The code base is closer to portable than the decision D4 suggests.** There is not a
  single `cfg(windows)` / `cfg(target_os)` in the workspace, no Windows API crate, no `unsafe`,
  no registry access and no native GPU code. Rendering, photo path tracing, video encoding,
  model conversion and printing all run inside the WebView. The Rust core (`msh-model`,
  `msh-format`, `msh-geometry`, `msh-export`, most of `msh-core`) is plain portable Rust.
- **Exactly one thing stops the build on macOS/Linux:** the live-control pipe server
  imports `tokio::net::windows::named_pipe` unconditionally (`app/src-tauri/src/pipe.rs:13`).
  Everything else compiles but silently loses features: library discovery, the user library
  folder and the catalog settings all read `%APPDATA%` / `%ProgramFiles%` / PowerShell
  (`crates/msh-catalog/src/lib.rs:379-473`, `crates/msh-core/src/catalog_settings.rs:53`), and
  the frontend hard-codes the Windows form of the custom URL scheme
  (`app/src/api.ts:113`, `http://msh.localhost`), so no model or texture would load.
- **The real cost is not code but WebView differences, packaging and testing.** WebKitGTK
  (Linux) is the weakest WebView for this app: WebGL performance and driver quirks (NVIDIA,
  Wayland), and WebCodecs video encoding is uncertain. WKWebView (macOS) is solid for WebGL2
  but macOS users expect a native menu bar, Cmd shortcuts and signed + notarized apps
  (Apple Developer Program, USD 99 / year).
- **Effort (one experienced developer, excluding feature work):** making the code portable
  and compiling on all three systems ~4–6 person-days; Linux port to "usable, AppImage/.deb"
  ~8–12 days; macOS port to "signed, notarized universal .dmg" ~10–15 days; CI matrix ~3–4
  days. Total for both platforms roughly **5–7 person-weeks**, plus ongoing testing cost on
  every release.
- **Recommended order:** first the cheap portability work in the Windows code (worth doing
  now, ~1 week, no user-visible change), then **macOS before Linux** if the goal is users
  (better WebView, larger audience among Sweet Home 3D users, one fixed target), or **Linux
  first** if the goal is a free proof that the code is portable (no fees, CI runners free,
  Docker). Detailed reasoning in section 9.

---

## 1. Inventory of Windows-specific code and assumptions

Search done for `cfg(windows)`, `cfg(target_os`, `APPDATA`, `USERPROFILE`, `ProgramFiles`,
registry crates, `\\` paths, `.exe`, `powershell`, named pipes, fonts and dialogs.

### 1.1 Blocking (does not compile on macOS/Linux)

| Where | What | Port |
|---|---|---|
| `app/src-tauri/src/pipe.rs:13` | `use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions}` – module only exists on Windows | Unix domain socket server (`tokio::net::UnixListener`) behind `cfg(unix)`; the protocol (newline-delimited JSON) is transport-agnostic, so `handle_client` (`pipe.rs:111`) can be made generic over `AsyncRead + AsyncWrite` |
| `app/src-tauri/src/pipe.rs:92-109` | `first_pipe_instance(true)`, `reject_remote_clients(true)` | Unix: socket file with mode `0600` in a per-user directory (`$XDG_RUNTIME_DIR/my-sweet-home.sock` on Linux, `$TMPDIR` / `~/Library/Caches/…` on macOS); stale socket file must be removed on start (check with a connect first, which also replaces `first_pipe_instance`) |

### 1.2 Compiles, but wrong or missing behaviour

| Where | Assumption | Effect on macOS/Linux |
|---|---|---|
| `crates/msh-ipc/src/lib.rs:26` | `PIPE_NAME = r"\\.\pipe\my-sweet-home"` | Client opens a non-existent file → always "not running". Needs a `cfg` switch to the socket path and `UnixStream` (`lib.rs:101-122`) |
| `crates/msh-ipc/src/lib.rs:96-108` | `ERROR_PIPE_BUSY = 231` retry loop | Windows only; Unix sockets queue connections (backlog), retry unnecessary |
| `crates/msh-catalog/src/lib.rs:379-395` | `store_resources_dir()` runs `powershell Get-AppxPackage` | Process start fails → `None` (harmless, but wasted spawn on every catalog load). Gate with `cfg(windows)` |
| `crates/msh-catalog/src/lib.rs:399-406` | `user_library_dir()` from `APPDATA` | `None` → `library_import`, `furniture_import` and "My furniture.sh3f" fail (`crates/msh-catalog/src/user_library.rs:51-58`, error message hard-codes `%APPDATA%`) |
| `crates/msh-catalog/src/lib.rs:431-454` | `find_libraries()` looks in `%ProgramFiles%\Sweet Home 3D\lib` and `%APPDATA%\eTeks\…`; doc comment says "Windows only" (`:427`) | Finds nothing → empty catalog unless the user adds folders. See section 2 for the per-OS locations |
| `crates/msh-core/src/catalog_settings.rs:49-59` | `%APPDATA%\ch.mysweethome.app\catalog.json` | Settings not saved ("the settings folder is unknown"). Should use the same base as Tauri's `app_data_dir()` (see below), which `autosave.rs:38-39` already does |
| `crates/msh-core/src/catalog_settings.rs:38-41` | `same_path()` compares paths case-insensitively "like Windows does" | Wrong on Linux (case-sensitive file systems); acceptable on macOS (APFS is case-insensitive by default, but not always) |
| `crates/msh-core/src/commands/online/feed.rs:101` | `\\server\share` UNC feed addresses | Windows only by nature; on Unix `/mnt/…` or `smb://` mounted paths already work through `is_absolute()`. Test `feed.rs:391` is Windows-specific → `cfg(windows)` |
| `crates/msh-core/src/catalog_settings.rs:123` | Test uses `C:\Lib\A.sh3f` | Still passes (paths are opaque), but reads oddly; harmless |
| `app/src/api.ts:112-113` | `MSH_BASE = "http://msh.localhost"` | **No resources load at all.** Tauri serves custom schemes as `http://<scheme>.localhost` only on Windows (WebView2 limitation); on macOS and Linux the URL is `msh://localhost/…`. Fix: choose at runtime (e.g. from `navigator.userAgent` or an `app_info` field). The CSP in `app/src-tauri/tauri.conf.json` already allows `msh:` |
| `app/src-tauri/src/resources.rs:3` | Doc comment about the Windows URL form | Only documentation |
| `app/src-tauri/src/commands.rs:27-39` | Startup file only from `std::env::args()` | macOS never passes files on the command line when the user double-clicks a `.sh3d`; it sends an Apple Event that Tauri delivers as `RunEvent::Opened { urls }` (also while the app is already running). Needs handling in `lib.rs` (`.run(...)` → `.build(...)?.run(|app, event| …)`) |
| `app/src-tauri/src/lib.rs:41-46` | App exits when the last home window closes | Correct on Windows/Linux; on macOS the convention is that the app stays in the Dock with its menu bar (optional, but expected by Mac users; re-open a window on Dock click via `RunEvent::Reopen`) |
| `app/src-tauri/src/main.rs:2` | `windows_subsystem = "windows"` | Ignored on other targets, fine |
| `app/src-tauri/tauri.conf.json` (`bundle.targets`) | `["msi", "nsis"]` | Must become per-platform (`"all"` or a platform-specific config file `tauri.macos.conf.json` / `tauri.linux.conf.json`, which Tauri 2 merges automatically). Icons already include `icon.icns` |

### 1.3 Fonts

| Where | What | Risk |
|---|---|---|
| `app/src/App.css:17` | `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` | Falls back to `system-ui` (San Francisco on macOS, Cantarell/Ubuntu/Noto on Linux). Fine, but UI metrics change; check tight layouts (toolbar, property panels) |
| `crates/msh-export/src/plan.rs:84`, `crates/msh-export/src/pages.rs:378`, `crates/msh-core/src/commands/export.rs:199` | SVG/PDF exports use `font-family="Segoe UI, Arial, sans-serif"` with `load_system_fonts()` (`crates/msh-export/src/lib.rs:28`, `pages.rs:438`) | **Real risk on Linux:** `fontdb` maps the generic `sans-serif` to "Arial" by default. Without Arial installed (most distributions), text in PNG/PDF exports may be missing. Fix: set the generic families from what is installed (`fontdb.set_sans_serif_family(...)`), or embed one free font (e.g. Noto Sans / Inter, OFL) in `msh-export` – also makes exports identical on all systems |
| `app/src/panels/TextStyleFields.tsx:12-19` | Font choice list with Windows fonts (Arial, Segoe UI, …) | Missing fonts silently fall back. Better: list installed fonts (Rust `fontdb` query → command) |

### 1.4 Keyboard and mouse

| Where | What | macOS issue |
|---|---|---|
| `app/src/ui/commands.ts:1102` | `eventShortcut()` maps `metaKey` to "Ctrl" | Cmd shortcuts already work, but menus and the shortcuts dialog show "Ctrl+…" instead of "⌘…". Also Ctrl+key on a Mac then does nothing, which is correct |
| `app/src/ui/commands.ts:1112` | Alias `Ctrl+Shift+Z → Ctrl+Y` | Fine (Cmd+Shift+Z is the Mac redo) |
| `app/src/catalog/FurnitureList.tsx:147` | Multi-select with `e.shiftKey \|\| e.ctrlKey` only | Cmd+click does not add to the selection on macOS; Ctrl+click is a right click there |
| `app/src/plan2d/PlanView.tsx:1597-1618` | Uses `ctrlKey \|\| metaKey` | Fine |
| `app/src/plan2d/PlanView.tsx:1061` | Context menu on `button === 2` | Ctrl+click on a Mac produces `button 0` + `ctrlKey` in some WebKit versions and a `contextmenu` event; listen to `contextmenu` instead |
| Shortcuts that macOS reserves | Cmd+H (hide), Cmd+M (minimize), Cmd+Q (quit), Cmd+, (preferences), Cmd+` (window cycle) | Check the command table for collisions |

### 1.5 Scripts and tools (development only)

All four scripts in `scripts/` are Windows PowerShell 5.1 and use `.exe` paths and Windows
install paths:

- `scripts/check.ps1` – portable content (cargo/pnpm), PowerShell only. Rewrite as a
  cross-platform `pwsh` script or replace with a `justfile` / `cargo xtask`; in CI the
  individual steps are run directly anyway.
- `scripts/compat-check.ps1:11,33,37` and `scripts/mcp-smoke.ps1:39,60,68-71` –
  `C:\Program Files\Sweet Home 3D\lib\SweetHome3D.jar`, `target\debug\msh.exe`, classpath
  separator `;` (Unix: `:`).
- `scripts/live-demo.ps1:10` – `target\debug\msh.exe`.
- `tools/compat/ReadHome.java`, `ReadCatalog.java` – plain Java, portable. **Java is a
  development/test dependency only** (compat check against the original reader); the shipped
  app has no Java dependency. Sweet Home 3D's jar runs headless on any OS with a JDK, so the
  compat check can run on Linux CI (download SweetHome3D-x.y.tgz in the job).

### 1.6 Already portable (no work)

- Path handling in the core normalizes `\` to `/` for ZIP entries
  (`crates/msh-core/src/model_package.rs:63,105`, `model_formats.rs:621`,
  `commands/online.rs:307,488`); the frontend splits on both (`app/src/catalog/dropImport.ts:31`).
- Temporary files use Tauri's `tempDir()` (`app/src/catalog/modelConvert.ts:144,154`),
  recovery uses `app_data_dir()` (`app/src-tauri/src/autosave.rs:38-39`), window state uses
  `tauri-plugin-window-state`, file dialogs use `tauri-plugin-dialog` (native on all three:
  NSOpenPanel, GTK/xdg-desktop-portal).
- Dropped files are read as `File` objects and copied to a temp folder
  (`app/src/catalog/CatalogPanel.tsx:195-206`, `modelConvert.ts:153-162`) instead of relying
  on WebView2-specific `File.path` – this works in WKWebView and WebKitGTK unchanged. Tauri's
  native drag-drop is disabled (`"dragDropEnabled": false` in `tauri.conf.json`), which is
  also what HTML5 drag and drop on Windows requires; on macOS/Linux HTML5 drop works either way.
- Network (`ureq`, rustls), time zones (`iana-time-zone`, `chrono-tz`), images (`image`,
  `resvg`), PDF (`krilla`), glTF – all portable crates.
- Multiple windows per home (`commands::new_window`, labels `home-*` / `view3d-*`) – Tauri
  supports multiple webview windows on all desktop platforms.

---

## 2. Sweet Home 3D locations per OS

Sweet Home 3D stores preferences and imported libraries in a per-user folder (Java
`OperatingSystem.getDefaultApplicationFolder()`):

| OS | User folder (preferences, `furniture/`, `textures/`, `languages/`, `plugins/`) |
|---|---|
| Windows | `%APPDATA%\eTeks\Sweet Home 3D` (current code) |
| macOS | `~/Library/Application Support/eTeks/Sweet Home 3D` |
| Linux | `~/.eteks/sweethome3d` |
| Linux Flatpak (`com.sweethome3d.Sweethome3d`) | inside the sandbox home: `~/.var/app/com.sweethome3d.Sweethome3d/.eteks/sweethome3d` *(verify)* |

Default catalog (`Furniture.jar`, `Textures.jar`) of an installation:

| OS | Where to look |
|---|---|
| Windows | `%ProgramFiles%\Sweet Home 3D\lib`, `%ProgramFiles(x86)%\…`, Store package via `Get-AppxPackage` (current code) |
| macOS | `/Applications/Sweet Home 3D.app/Contents/Java/` or `…/Contents/Resources/Java/` depending on the bundler version *(verify on a Mac)*; also `~/Applications/…`. Mac App Store version: same bundle layout inside `/Applications` |
| Linux tarball | wherever the user unpacked `SweetHome3D-x.y/` → `lib/Furniture.jar`; not discoverable, so offer "add folder" (already supported via `extra_dirs`) and scan `~/SweetHome3D*`, `/opt/SweetHome3D*` |
| Linux distro packages | Debian/Ubuntu `sweethome3d` (+ `sweethome3d-furniture*` packages) under `/usr/share/sweethome3d/` *(verify exact subfolders)* |
| Linux Flatpak | `/var/lib/flatpak/app/com.sweethome3d.Sweethome3d/current/active/files/…` and `~/.local/share/flatpak/app/…` |
| Linux Snap | `/snap/sweethome3d-homedesign/current/…` *(verify)* |

Design suggestion: replace the hard-coded lists in `crates/msh-catalog/src/lib.rs` by a
small `locations` module with one function per OS (`cfg(target_os = "…")`) returning
`installation_jars()`, `user_folder()` and `extra_resource_dirs()`; keep `find_libraries`
OS-agnostic. The user folder is also where P12e writes ("My furniture.sh3f"), so sharing with
Sweet Home 3D keeps working on every OS.

**Our own settings** (`catalog.json`, recovery): today `catalog_settings.rs` builds
`%APPDATA%\ch.mysweethome.app` by hand while `autosave.rs` uses Tauri's `app_data_dir()`.
On Windows both are the same folder; on macOS Tauri uses
`~/Library/Application Support/ch.mysweethome.app`, on Linux `~/.local/share/ch.mysweethome.app`
(XDG). Since `msh-core` must not depend on Tauri (CLI/MCP use it too), add a tiny
`app_data_dir()` helper in `msh-core` that mirrors Tauri's rule (`dirs`/`directories` crate:
`data_dir()/ch.mysweethome.app`) and use it for both.

---

## 3. WebView differences

| | Windows (today) | macOS | Linux |
|---|---|---|---|
| Engine | WebView2 (Chromium, evergreen) | WKWebView (Safari engine, tied to the macOS version) | WebKitGTK (version of the distribution, often 1–2 years old on LTS distros) |
| WebGL2 / three.js | very good (ANGLE → D3D11) | good (ANGLE → Metal since Safari 15+) | works, but slowest; compositing quirks |
| WebGPU | yes | Safari 26 / macOS 26+ | not usable |
| WebCodecs `VideoEncoder` | yes | Safari 16.4+ (H.264; check HEVC/AV1) | GStreamer-backed implementation since WebKitGTK 2.42 for some codecs; depends on installed GStreamer plugins – **uncertain** |
| `window.print()` | system dialog | historically not supported in Tauri/WKWebView without native call; verify with current wry | GTK print dialog |
| Dev tools | yes | yes (debug builds) | yes (debug builds) |

### 3.1 Rendering, photo and video pipeline

- No native or GPU code in Rust. All 3D is `THREE.WebGLRenderer` (`app/src/view3d/View3D.tsx:149`,
  offscreen renderer for photo/video `app/src/view3d/photo.ts:60-64`, top views
  `app/src/plan2d/topView.ts:192`, lens `app/src/view3d/lens.ts:117`, import preview
  `app/src/catalog/ImportFurnitureDialog.tsx:97`). Despite D1 ("WebGPU"), WebGPU is not used,
  which is good for portability.
- Photo rendering uses `three-gpu-pathtracer` (WebGL2, float render targets). Needs
  `EXT_color_buffer_float` – available in WKWebView and current WebKitGTK; on WebKitGTK with
  software rendering (no GPU / VM) it will be extremely slow.
- Video: `app/src/view3d/video.ts:146-170` tries codecs via `VideoEncoder.isConfigSupported`
  and muxes with `mp4-muxer`; it already throws a clear error when WebCodecs is missing
  (`video.ts:147`). Fallback options if WebKitGTK lacks it: encode in Rust (send frames over
  IPC, `ffmpeg` sidecar or `openh264` crate – adds a binary and licensing questions), or
  offer PNG frame sequences.
- Captures for MCP (`view_screenshot`, `capture_3d`) go through the frontend
  (`app/src-tauri/src/pipe.rs:15-80`) – portable once the IPC transport works.

### 3.2 Known WebKitGTK issues (Linux)

- **NVIDIA and Wayland:** blank or crashing windows ("Error 71", DMABUF errors). Workarounds
  are environment variables set before the WebView starts: `__NV_DISABLE_EXPLICIT_SYNC=1`
  (no cost) or `WEBKIT_DISABLE_DMABUF_RENDERER=1` (slower compositing). The Tauri docs
  recommend a non-WebGL fallback and a user setting on Linux. For a 3D-heavy app this is the
  biggest single risk.
- `WEBGL_debug_renderer_info` does not report the real GPU, so automatic quality selection
  (e.g. 3D quality preference) cannot rely on it.
- WebGL work runs on the main thread in WebKitGTK; heavy scenes cause UI jank.
- Distribution spread: Ubuntu 22.04 ships an older WebKitGTK than 24.04; Tauri 2 needs
  `webkit2gtk-4.1`. Supporting only current LTS distros (Ubuntu 24.04+, Fedora current,
  Debian 13) keeps this manageable. AppImage bundles do **not** ship WebKitGTK itself (too
  big, uses the system one).

### 3.3 CSS / JS differences

- Safari/WebKit gaps that matter here: CSS `@page` named pages + `page:` property used by
  `app/src/export/print.ts:28-35` (support in WebKit to verify), `color-mix()`/newer CSS
  (fine in current WebKit), scrollbar styling (`::-webkit-scrollbar` works, `scrollbar-color`
  partially), `<input type="color">` and `<select>` render natively and look different,
  `dialog` element fine.
- Overlay scrollbars on macOS change layout widths (catalog virtual list, furniture list).
- Text rendering and font metrics differ (section 1.3) – check truncation in panels.
- `localStorage` works (used for split sizes etc.).

### 3.4 Native menus and macOS conventions

The app draws its own menu bar in HTML (`app/src/ui/MenuBar.tsx`, menu model in
`app/src/ui/commands.ts`). On Windows and Linux that is fine. On macOS:

- Users expect the global menu bar with the **app menu** (About, Preferences… Cmd+,,
  Hide, Quit Cmd+Q), Edit (Undo/Redo/Cut/Copy/Paste/Select All) and Window menus. Without a
  native Edit menu, Cmd+C/V/X/A in text inputs may not work in WKWebView. Tauri 2 creates a
  default menu on macOS when none is set, which covers this minimum.
- Recommended: on macOS build a native `tauri::menu::Menu` from the same command model
  (the menu entries are already data in `commands.ts`) and hide the HTML menu bar; keep the
  toolbar. This is the largest macOS-specific UI task (~3–4 days).
- Window chrome: optional `titleBarStyle: "Overlay"` for a modern look; traffic-light
  buttons on the left (check that nothing important sits in the top-left corner).
- Dock: re-open a window on click (`RunEvent::Reopen`), keep running after the last window
  (see 1.2).

---

## 4. Integration features per OS

| Feature | Windows (today / P12f) | macOS | Linux |
|---|---|---|---|
| Live control / MCP transport | named pipe | Unix socket | Unix socket |
| Open `.sh3d` by double click | argv + file association in MSI | `CFBundleDocumentTypes` (Tauri `bundle.fileAssociations`) + `RunEvent::Opened` | `.desktop` file `MimeType=` + shared-mime-info XML for `application/x-sweethome3d` (or reuse what a SH3D package registered); file arrives in argv |
| Second launch with a file while running | today: new process, pipe already taken (`pipe.rs:86`) → two independent apps | OS routes to the running app (`Opened`) | new process → use `tauri-plugin-single-instance` (works on Windows too, recommended there as well) |
| CLI `msh` on PATH | installer adds it (P12f) | binary inside `.app/Contents/MacOS/msh`; offer "Install command line tool" (symlink to `/usr/local/bin/msh`, needs admin) or document `ln -s`; Homebrew cask can do it | `.deb`/`.rpm` install to `/usr/bin/msh`; AppImage cannot put things on PATH (document or offer a symlink to `~/.local/bin`) |
| MCP configuration for Claude Desktop etc. | path to `msh.exe` | `/Applications/My Sweet Home.app/Contents/MacOS/msh` | `/usr/bin/msh` |
| Auto-update (Tauri updater) | MSI/NSIS | `.app.tar.gz` + signature, works | AppImage only; `.deb`/`.rpm` are updated by the package manager / a repository |

The CLI and MCP server (`crates/msh-cli`) are pure Rust and work headless on all systems
once `msh-ipc` has the socket transport; headless MCP is actually the cheapest feature to
port (no WebView).

---

## 5. Packaging and distribution

### 5.1 macOS

- **Bundle:** `.app` + `.dmg` via `tauri build` (targets `app`, `dmg`). The CLI `msh` must be
  added to the bundle (Tauri `bundle.externalBin` sidecar, which expects target-triple
  suffixed binaries, or copy step).
- **Universal binary:** `tauri build --target universal-apple-darwin` (needs both
  `aarch64-apple-darwin` and `x86_64-apple-darwin` Rust targets; build time doubles). Intel
  Macs are a shrinking share; arm64-only is a valid choice, universal costs nothing but CI time.
- **Code signing + notarization:** required in practice – unsigned apps downloaded from the
  internet are blocked by Gatekeeper (users must override in System Settings, which most
  will not). Needs the **Apple Developer Program, USD 99 / year**, a "Developer ID
  Application" certificate, and notarization (Tauri supports it via `APPLE_ID`,
  `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID` or an App Store Connect API key). The
  sidecar `msh` must be signed too (hardened runtime). Mac App Store distribution would add
  sandboxing, which conflicts with reading Sweet Home 3D's folders and arbitrary library paths
  – not recommended.
- **Licensing note (D5):** GPL distribution is fine via direct download; the Mac App Store
  terms are commonly considered incompatible with GPL – another reason to stay outside it.
- **Default catalog (P12f):** the same build-time step that extracts the SH3D default catalog
  for the Windows installer must run on the macOS build machine (source: a SH3D download,
  never committed).

### 5.2 Linux

- **Formats Tauri builds:** `.deb`, `.rpm`, `.AppImage`. Flatpak is not built by Tauri; it
  needs a manifest (Flathub accepts Tauri apps, with the GNOME runtime that contains
  WebKitGTK – arguably the best way to get a known WebKitGTK version). Snap possible but
  less common for this audience.
- **Recommended set:** AppImage (works everywhere, updater support) + `.deb` (Ubuntu/Debian,
  puts `msh` on PATH, file association). `.rpm` is nearly free once `.deb` works. Flatpak later.
- **File association:** `.desktop` entry with `MimeType=application/x-sweethome3d;` and a
  MIME definition for `*.sh3d` (plus `.sh3f`, `.sh3t` if they should open in the app);
  Tauri 2 `bundle.fileAssociations` generates these for deb/rpm.
- **Build host:** build on the oldest supported distro (e.g. Ubuntu 22.04 or 24.04) because
  of glibc; an AppImage built on a new distro does not run on older ones.
- **No signing requirement**; optional GPG-signed apt repository later.

### 5.3 Auto-update

The Tauri updater (planned in P12f) uses one signing key for all platforms and a JSON
manifest with per-platform entries (`windows-x86_64`, `darwin-aarch64`, `darwin-x86_64`,
`linux-x86_64`). So the P12f decision carries over; only the release pipeline must upload
one artifact per platform. On Linux only the AppImage self-updates.

---

## 6. CI, build and testing

- **No CI exists yet** (no `.github/`). A port without CI is not maintainable, because
  nobody would notice regressions on systems the developer does not use.
- **Cross-compiling:** Windows → Linux works in Docker/WSL, but Tauri's bundler and
  WebKitGTK headers make native Linux builds simpler. Windows/Linux → macOS is not practical
  (SDK licence, signing, notarization need macOS). Use native runners.
- **GitHub Actions matrix** (the official `tauri-apps/tauri-action` covers build, bundling,
  signing and uploading):
  - `windows-latest` – current target, MSI/NSIS.
  - `ubuntu-22.04` or `ubuntu-24.04` – needs `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
    `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`.
  - `macos-latest` (arm64) – build `universal-apple-darwin`; secrets for signing.
  - Free for public repositories; for private repositories macOS minutes count 10× against
    the quota (budget matters if the repository stays private, D5).
- **Per-PR checks (cheap):** `cargo fmt`, `clippy -D warnings`, `cargo test --workspace` on
  all three OS (catches `cfg` mistakes, path and case issues), Biome + `tsc` once. The SH3D
  compat check (`tools/compat`) on Linux with a downloaded SH3D tarball and a JDK.
- **Testing without own Mac/Linux machines:**
  - Linux: WSL2 with WSLg runs the GTK app with a window on Windows 11 – good enough for
    functional testing; GPU path differs from real hardware (Mesa d3d12). A VM or a cheap
    used laptop with an AMD/Intel GPU for the WebGL checks; NVIDIA testing ideally on real
    hardware.
  - macOS: no legal VM on non-Apple hardware. Options: cloud Macs (MacStadium, AWS EC2 Mac
    with 24 h minimum, Scaleway Mac mini ~€0.10–0.25/h), a used Mac mini M1/M2 (~€300–500,
    cheapest long term), or remote testers. CI can run headless smoke tests (CLI, MCP
    headless, Rust tests) but not the WebView UI.
  - UI smoke tests: WebdriverIO with `tauri-driver` works on Windows and Linux, **not on
    macOS** (no WKWebView driver). A small scripted scenario (open example home, place a
    piece, save, compat-check) on Windows + Linux CI is realistic.
  - MCP smoke test (`scripts/mcp-smoke.ps1`) can be ported to a cross-platform script and run
    headless on all three runners.

---

## 7. Effort estimate

Person-days for one developer who knows the code base; "S" < 2 d, "M" 2–5 d, "L" > 5 d.

| # | Area | Size | Days | Notes |
|---|---|---|---|---|
| 1 | IPC transport abstraction (named pipe / Unix socket), `msh-ipc` client + `pipe.rs` server | M | 2 | Protocol unchanged; tests for both via `cfg` |
| 2 | Path/location module (SH3D folders per OS, `app_data_dir`, gate PowerShell), case-sensitive compare | M | 2 | Plus verification on real installations |
| 3 | `msh` URL scheme base per platform (`api.ts`) | S | 0.5 | |
| 4 | Fonts: generic family mapping or embedded font in exports; installed-font list | S | 1–2 | |
| 5 | Keyboard/mouse: ⌘ display, Cmd+click, `contextmenu`, reserved shortcuts | S | 1–2 | |
| 6 | File open: `RunEvent::Opened`, single-instance plugin, macOS keep-alive / reopen | M | 2–3 | Single instance also improves Windows |
| 7 | macOS native menu from the command model, app menu conventions | M | 3–4 | |
| 8 | macOS packaging: universal build, sidecar `msh`, signing + notarization, `.dmg`, file associations, CLI install | M | 3–4 | + Apple account setup, waiting for notarization |
| 9 | Linux packaging: AppImage + `.deb`/`.rpm`, MIME/desktop files, `msh` on PATH | M | 2–3 | Flatpak +2–3 later |
| 10 | WebKitGTK hardening: env workarounds, WebGL fallback/quality setting, video fallback | L | 4–6 | Largest uncertainty; depends on test hardware |
| 11 | WKWebView fixes: printing, CSS/layout, video codecs | M | 2–4 | Unknown until first run |
| 12 | CI matrix (build + tests on 3 OS, release workflow with signing and updater manifest) | M | 3–4 | |
| 13 | Scripts → cross-platform (`pwsh` or `xtask`) | S | 1–2 | |
| 14 | Manual QA pass per platform per release | — | 1–2 per release | Ongoing |

Totals (rough): portable code (1–5, 13) **~8–11 d**; Linux on top (6 partly, 9, 10, Linux CI)
**~10–14 d**; macOS on top (6, 7, 8, 11, macOS CI) **~12–16 d**. Both platforms together
**~5–7 person-weeks**. Fixed cost: USD 99 / year Apple, optionally a test Mac.

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| WebKitGTK WebGL performance / NVIDIA + Wayland breakage makes the 3D view unusable for part of Linux users | high | high | Env workarounds, quality setting, documented requirements, Flatpak with a known runtime; accept "best effort" Linux support |
| No WebCodecs video encoding on WebKitGTK (and codec gaps on WKWebView) | medium | medium | Detect and show a clear message (already done); Rust/ffmpeg fallback only if users need it |
| Printing does not work in WKWebView | medium | low | PDF export is the fallback (already exists); native print via wry if available |
| macOS signing/notarization friction (certificates, hardened runtime, sidecar) | medium | medium | Do it once in CI with `tauri-action`, keep secrets in the CI store |
| Testing burden: regressions on platforms the developer does not use daily | high | medium | CI on all three OS from day one; small UI smoke test on Linux |
| Sweet Home 3D install paths differ more than expected (distro packages, Flatpak sandbox) | medium | low | "Add library folder" already exists; detection is a convenience |
| GPL vs. Mac App Store | low (if not used) | — | Distribute directly |
| Distribution undecided (D3/D5): building for 3 OS before deciding to publish may be wasted | — | medium | Do only the cheap preparation (section 10) now |

## 9. Recommended order

1. **Now, in the Windows code (no port yet):** the preparation in section 10. Costs about a
   week, has no user-visible downside, and removes the only compile blocker.
2. **Add Linux to CI as a compile + test target** (Rust tests, clippy). This keeps the code
   portable for free from then on and is possible without any Mac/Linux hardware.
3. **Then the first real port – macOS or Linux:**
   - **macOS first** if the goal is real users: Sweet Home 3D has a large Mac user base, the
     WebView is good for WebGL/WebCodecs, there is one well-defined target (current macOS on
     arm64/x64) instead of a distribution zoo. Cost: USD 99 / year and access to a Mac for
     testing.
   - **Linux first** if the goal is to prove portability cheaply: no fees, WSL2 and CI
     runners are enough to start, packaging is simpler. But the hardest WebView problems
     (WebKitGTK + GPU drivers) come first, and the audience is smaller.
   - Overall recommendation: **macOS first for a product, Linux CI first for the code**.
4. **Second platform**, then Flatpak / Homebrew cask as convenience channels.

## 10. Cheap preparation now (keeps the port easy)

These changes are small, safe on Windows and could be done in the current Windows-only phase
(coordinate with P12f, which touches library discovery and bundling):

1. **IPC transport behind a tiny abstraction** in `msh-ipc` (`connect()` / `serve()` with
   `cfg(windows)` named pipe and `cfg(unix)` Unix socket). Even implementing only the
   Windows branch now, moving `tokio::net::windows` out of `app/src-tauri/src/pipe.rs` behind
   `cfg(windows)` removes the only compile blocker.
2. **One `locations` module** for all OS-dependent folders: SH3D user folder, SH3D
   installation jars, Store package, our own data dir. Replace the direct
   `env::var_os("APPDATA")` calls in `crates/msh-catalog/src/lib.rs:400,450`,
   `crates/msh-core/src/catalog_settings.rs:53` and the `%APPDATA%` error text in
   `crates/msh-catalog/src/user_library.rs:53`. Gate the PowerShell call with `cfg(windows)`.
   P12f is already changing library discovery – a good moment.
3. **Use the same data folder rule as Tauri** in `msh-core` (so CLI, MCP and app agree on
   every OS) instead of a hand-built `%APPDATA%` path.
4. **Do not hard-code `http://msh.localhost`**: let `app_info` return the resource base URL
   or detect the platform in `app/src/api.ts`.
5. **Embed or map fonts for exports** (`crates/msh-export`): makes PDFs/PNGs identical on
   every machine, which helps Windows users without Segoe UI fonts too.
6. **Single-instance plugin + file-open event handling** (`tauri-plugin-single-instance`):
   fixes the Windows case where a second double-click starts a second app that cannot get
   the pipe (`app/src-tauri/src/pipe.rs:86`), and is the same code path macOS needs.
7. **Platform-specific Tauri config files** (`tauri.windows.conf.json` for `msi`/`nsis` and
   WebView2 options) instead of putting Windows-only settings in `tauri.conf.json` – Tauri 2
   merges them automatically; this matters for the P12f installer work.
8. **Modifier handling in one place**: a helper `isPrimaryModifier(e)` (`metaKey` on macOS,
   `ctrlKey` elsewhere) and a shortcut display function, used by `FurnitureList.tsx:147`,
   `PlanView.tsx`, `commands.ts`.
9. **Do not add new Windows-only dependencies** (registry, `windows` crate, PowerShell calls)
   without a `cfg` and a note; keep using Tauri plugins for OS integration.
10. **Write new scripts in a cross-platform way** (PowerShell 7 `pwsh` runs on all three, or
    `cargo xtask`), and keep the `;` classpath separator out of new scripts.

## Sources

- Tauri 2 – Linux graphics issues (WebKitGTK, DMABUF, NVIDIA/Wayland workarounds, WebGL
  fallback advice): <https://v2.tauri.app/develop/debug/linux-graphics/>
- Tauri 2 – deep linking / single instance on Linux and Windows:
  <https://v2.tauri.app/plugin/deep-linking/>
- Tauri 2 – file associations and `RunEvent::Opened`:
  <https://v2.tauri.app/learn/mobile-file-associations/>
- Tauri 2.0.0-alpha.13 release notes (custom protocols on Windows use `http://<scheme>.localhost`):
  <https://v2.tauri.app/release/tauri/v2.0.0-alpha.13>
- WebCodecs in WebKit with GStreamer (WebKitGTK 2.42 status):
  <https://gstconf.ubicast.tv/videos/webcodecs-in-webkit-with-gstreamer/>
- `webkit2gtk-nvidia-quirk` crate (DMABUF workaround and its performance cost):
  <https://docs.rs/crate/webkit2gtk-nvidia-quirk/latest/source/src/lib.rs>

Items marked *(verify)* are from memory and must be checked on a real installation before
the corresponding code is written.
