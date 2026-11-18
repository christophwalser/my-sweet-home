// Library editor: the one place to add, change, move, copy and remove furniture and textures
// of the libraries, rename libraries and create categories. Left the libraries and their items
// (the search covers all libraries), in the middle a preview fitting the kind of the item, on
// the right its properties. Every change is a library_* command (undo with Ctrl+Z).

import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { api, type CatalogItem, type CatalogKind, type LibraryInfo, libResourceUrl } from "../api";
import { errorText } from "../errorText";
import { language, t } from "../i18n";
import Splitter from "../layout/Splitter";
import ContextMenu, { type MenuItem } from "../plan2d/ContextMenu";
import { useStore } from "../store";
import Icon from "../ui/Icon";
import { useUi } from "../ui/uiStore";
import { formatPrecise } from "../units";
import { disposeObject, loadModelUncached } from "../view3d/models";
import { importFiles } from "./dropImport";
import {
  askCategoryName,
  categoriesFor,
  type History,
  historyLabel,
  itemKey,
  itemMenu,
  libraryName,
} from "./library";
import { LIBRARY_EXTENSIONS, MODEL_EXTENSIONS, TEXTURE_EXTENSIONS } from "./modelConvert";
import ShapeEditor from "./ShapeEditor";

/** Keys and values of an item in the library file (Sweet Home 3D's format). */
type Details = {
  path: string;
  index: number;
  editable: boolean;
  values: Record<string, string>;
  translated: Record<string, string>;
};

type Menu = { x: number; y: number; items: MenuItem[] };

/** Size and place of the editor window and its panes, kept between sessions. */
type Frame = {
  /** Window rectangle; null: centered in its default size */
  rect: { x: number; y: number; w: number; h: number } | null;
  maximized: boolean;
  side: number;
  props: number;
  libs: number;
};

const FRAME_KEY = "msh.libraryEditor.frame";
const DEFAULT_FRAME: Frame = { rect: null, maximized: false, side: 330, props: 420, libs: 180 };
const MIN_W = 720;
const MIN_H = 420;

function loadFrame(): Frame {
  try {
    const raw = localStorage.getItem(FRAME_KEY);
    if (raw) return { ...DEFAULT_FRAME, ...(JSON.parse(raw) as Partial<Frame>) };
  } catch {
    // Unknown or unreadable: the default layout
  }
  return DEFAULT_FRAME;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Edges and corners of the window that resize it. */
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;

/**
 * The editor window: moved by its title bar, resized at its edges and corners, maximized with
 * the button or a double-click on the title bar; side panes and the library list resized with
 * splitters (double-click: default size).
 */
function useFrame() {
  const [frame, setFrame] = useState<Frame>(loadFrame);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem(FRAME_KEY, JSON.stringify(frame));
    } catch {
      // Not kept: the layout starts as default next time
    }
  }, [frame]);
  const update = useCallback(
    (change: Partial<Frame>) => setFrame((f) => ({ ...f, ...change })),
    [],
  );

  /** Follows the pointer from a pointerdown; `apply` gets the start rectangle and the offset */
  const track = useCallback(
    (
      e: React.PointerEvent<HTMLElement>,
      cursor: string,
      apply: (start: DOMRect, dx: number, dy: number) => void,
    ) => {
      const el = dialog.current;
      if (!el || e.button !== 0) return;
      e.preventDefault();
      const start = el.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
      const move = (ev: PointerEvent) => apply(start, ev.clientX - x0, ev.clientY - y0);
      const end = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", end);
        target.removeEventListener("pointercancel", end);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", end);
      target.addEventListener("pointercancel", end);
    },
    [],
  );

  const moveStart = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (frame.maximized || (e.target as HTMLElement).closest("button, input, select")) return;
      track(e, "move", (r, dx, dy) =>
        update({
          rect: {
            x: clamp(r.left + dx, 80 - r.width, window.innerWidth - 80),
            y: clamp(r.top + dy, 0, Math.max(0, window.innerHeight - r.height)),
            w: r.width,
            h: r.height,
          },
        }),
      );
    },
    [frame.maximized, track, update],
  );

  const resizeStart = useCallback(
    (edge: (typeof EDGES)[number]) => (e: React.PointerEvent<HTMLElement>) =>
      track(e, `${edge}-resize`, (r, dx, dy) => {
        let { left, top, right, bottom } = r;
        if (edge.includes("e")) right = clamp(r.right + dx, left + MIN_W, window.innerWidth);
        if (edge.includes("w")) left = clamp(r.left + dx, 0, right - MIN_W);
        if (edge.includes("s")) bottom = clamp(r.bottom + dy, top + MIN_H, window.innerHeight);
        if (edge.includes("n")) top = clamp(r.top + dy, 0, bottom - MIN_H);
        update({ rect: { x: left, y: top, w: right - left, h: bottom - top } });
      }),
    [track, update],
  );

  const style: React.CSSProperties = {
    "--libed-side": `${frame.side}px`,
    "--libed-props": `${frame.props}px`,
    "--libed-libs": `${frame.libs}px`,
  } as React.CSSProperties;
  if (!frame.maximized && frame.rect) {
    // Kept inside the app window if that became smaller
    const w = Math.min(frame.rect.w, window.innerWidth);
    const top = clamp(frame.rect.y, 0, window.innerHeight - MIN_H);
    Object.assign(style, {
      position: "fixed",
      left: clamp(frame.rect.x, 80 - w, window.innerWidth - 80),
      top,
      width: w,
      // The bottom edge stays reachable for resizing
      height: Math.min(frame.rect.h, window.innerHeight - top),
    });
  }

  /** Pane sizes from splitter positions (client coordinates) */
  const panes = {
    side: (x: number) => {
      const r = dialog.current?.getBoundingClientRect();
      if (r) update({ side: clamp(x - r.left, 220, r.width - frame.props - 240) });
    },
    props: (x: number) => {
      const r = dialog.current?.getBoundingClientRect();
      if (r) update({ props: clamp(r.right - x, 280, r.width - frame.side - 240) });
    },
    libs: (y: number, top: number | undefined, bottom: number | undefined) => {
      if (top !== undefined && bottom !== undefined)
        update({ libs: clamp(y - top, 70, bottom - top - 160) });
    },
  };

  return { frame, update, dialog, style, moveStart, resizeStart, panes };
}

/** Kind of a piece, from the keys it has. */
type PieceType = "furniture" | "door" | "stairs" | "light" | "shelf";

function pieceType(v: Record<string, string>): PieceType {
  if (v.doorOrWindow === "true") return "door";
  if (v.staircaseCutOutShape) return "stairs";
  if (v.lightSourceX || v.lightSourceMaterialName) return "light";
  if (v.shelfElevations || v.shelfBoxes) return "shelf";
  return "furniture";
}

const FULL_SHAPE = "M0,0 L1,0 L1,1 L0,1 Z";

function formatSize(item: CatalogItem): string {
  return item.kind === "furniture"
    ? `${formatPrecise(item.width)} × ${formatPrecise(item.depth)} × ${formatPrecise(item.height)}`
    : `${formatPrecise(item.width)} × ${formatPrecise(item.height)}`;
}

/** A text field that commits its value when it loses the focus or Enter is pressed. */
function Field({
  label,
  value,
  onCommit,
  disabled,
  unit,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  unit?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the label wraps an input or a text area
    <label className="libed-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          type="text"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setText(value);
          }}
        />
      )}
      <span className="muted">{unit ?? ""}</span>
    </label>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="libed-check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** Sweet Home 3D's modelRotation (9 numbers, row major) as matrix. */
function rotationMatrix(text: string | undefined): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  const v = (text ?? "").split(/\s+/).map(Number);
  if (v.length === 9 && v.every(Number.isFinite)) {
    m.set(v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, 0, 0, 0, 1);
  }
  return m;
}

function rotationText(m: THREE.Matrix4): string {
  const e = m.elements;
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]]
    .map((v) => String(Math.round(v * 1e6) / 1e6))
    .join(" ");
}

const PREVIEW_ORBIT = { yaw: 0.4636, pitch: 0.373, distance: 3.84 };

/** 3D preview of a library model, turned by dragging; renders the catalog icon on request. */
function ModelPreview({
  url,
  rotation,
  iconRef,
}: {
  url: string | null;
  rotation: string | undefined;
  iconRef: React.MutableRefObject<(() => string | null) | null>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    holder: THREE.Group;
    model: THREE.Object3D | null;
  } | null>(null);
  const orbit = useRef({ ...PREVIEW_ORBIT });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const draw = useCallback(() => {
    const th = three.current;
    if (!th) return;
    const o = orbit.current;
    const r = o.distance * Math.cos(o.pitch);
    th.camera.position.set(
      r * Math.sin(o.yaw),
      o.distance * Math.sin(o.pitch),
      r * Math.cos(o.yaw),
    );
    th.camera.lookAt(0, 0, 0);
    th.renderer.render(th.scene, th.camera);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x666677, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 3, 4);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    const holder = new THREE.Group();
    scene.add(holder);
    three.current = { renderer, scene, camera, holder, model: null };
    const resize = () => {
      const size = Math.max(120, Math.min(el.clientWidth, el.clientHeight));
      renderer.setSize(size, size, false);
      renderer.domElement.style.width = `${size}px`;
      renderer.domElement.style.height = `${size}px`;
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    // Textures load after the model is shown
    const timer = window.setInterval(draw, 400);
    iconRef.current = () => {
      draw();
      const icon = document.createElement("canvas");
      icon.width = 128;
      icon.height = 128;
      icon.getContext("2d")?.drawImage(renderer.domElement, 0, 0, 128, 128);
      return icon.toDataURL("image/png").split(",")[1] ?? null;
    };
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      if (three.current?.model) disposeObject(three.current.model);
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
      iconRef.current = null;
    };
  }, [draw, iconRef]);

  useEffect(() => {
    const th = three.current;
    if (!th) return;
    th.holder.clear();
    if (th.model) disposeObject(th.model);
    th.model = null;
    if (!url) {
      draw();
      return;
    }
    let alive = true;
    setStatus(t("Loading model…"));
    loadModelUncached(url)
      .then((model) => {
        if (!alive || !three.current) return;
        three.current.model = model;
        const rotated = new THREE.Group();
        rotated.add(model);
        rotated.matrixAutoUpdate = false;
        rotated.matrix.copy(rotationMatrix(rotation));
        rotated.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(rotated);
        const extent = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const scale = 1.6 / Math.max(extent.x, extent.y, extent.z, 1e-6);
        const fit = new THREE.Group();
        fit.scale.setScalar(scale);
        fit.position.copy(center.multiplyScalar(-scale));
        fit.add(rotated);
        three.current.holder.add(fit);
        setStatus(null);
        draw();
      })
      .catch((e) => alive && setStatus(errorText(e)));
    return () => {
      alive = false;
    };
  }, [url, rotation, draw]);

  return (
    <div className="libed-model">
      {/* biome-ignore lint/a11y/noStaticElementInteractions: turning the preview is for the mouse */}
      <div
        ref={host}
        className="libed-model-canvas"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const o = orbit.current;
          o.yaw -= (e.clientX - drag.current.x) * 0.01;
          o.pitch = Math.max(-1.4, Math.min(1.4, o.pitch + (e.clientY - drag.current.y) * 0.01));
          drag.current = { x: e.clientX, y: e.clientY };
          draw();
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onWheel={(e) => {
          const o = orbit.current;
          o.distance = Math.max(1.5, Math.min(12, o.distance * (e.deltaY > 0 ? 1.1 : 0.9)));
          draw();
        }}
        onDoubleClick={() => {
          orbit.current = { ...PREVIEW_ORBIT };
          draw();
        }}
      />
      <span className="muted small">
        {status ?? t("Drag to turn · mouse wheel to zoom · double-click: reset")}
      </span>
    </div>
  );
}

export default function LibraryEditor({
  initial,
  onClose: close,
}: {
  /**
   * "path|index" of an item to show first, or "add" / "add:<kind>" to start adding:
   * furniture shows the Add menu, textures open the file dialog right away.
   */
  initial: string | null;
  onClose: () => void;
}) {
  const onClose = useCallback(() => {
    useUi.getState().setLibraryTarget(null);
    close();
  }, [close]);
  const data = useStore((s) => s.catalogAll);
  const loadCatalog = useStore((s) => s.loadCatalog);
  const openDialog = useUi((s) => s.openDialog);
  const setLibraryTarget = useUi((s) => s.setLibraryTarget);
  const adding = initial === "add" || !!initial?.startsWith("add:");
  const [kind, setKind] = useState<CatalogKind>(
    initial === "add:textures" ? "textures" : "furniture",
  );
  const [libPath, setLibPath] = useState<string | null>(null);
  const [selKey, setSelKey] = useState<string | null>(adding ? null : initial);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [message, setMessage] = useState<{ text: string; undo: boolean } | null>(null);
  const [history, setHistory] = useState<History>({ undo: null, redo: null });
  const [extraCats, setExtraCats] = useState<string[]>([]);
  const [details, setDetails] = useState<Details | null>(null);
  const [tab, setTab] = useState<"general" | "size" | "type">("general");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const iconRef = useRef<(() => string | null) | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const { frame, update: updateFrame, dialog, style, moveStart, resizeStart, panes } = useFrame();
  const side = useRef<HTMLElement>(null);
  const toggleMaximized = () => updateFrame({ maximized: !frame.maximized });

  useEffect(() => {
    if (!data) void loadCatalog(language());
  }, [data, loadCatalog]);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory((await api.execute("library_history")) as History);
    } catch {
      // History unknown: the buttons stay as they are
    }
  }, []);

  /** Runs a library command, shows errors, and refreshes history and catalog */
  const run = useCallback(
    async (command: string, params: Record<string, unknown>, note?: string) => {
      try {
        const r = (await api.execute(command, params)) as { history?: History };
        if (r?.history) setHistory(r.history);
        if (note) setMessage({ text: note, undo: true });
        return r as Record<string, unknown>;
      } catch (e) {
        setMessage({ text: errorText(e), undo: false });
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const libraries = useMemo(() => {
    // A file may hold several catalogs: one entry per file, preferably one with a name
    const byPath = new Map<string, LibraryInfo>();
    for (const l of data?.libraries ?? []) {
      if (l.kind !== kind) continue;
      const known = byPath.get(l.path);
      if (!known || (!known.name && l.name)) byPath.set(l.path, l);
    }
    return [...byPath.values()];
  }, [data, kind]);

  const libByIndex = useMemo(() => {
    const m = new Map<number, LibraryInfo>();
    for (const l of data?.libraries ?? []) m.set(l.index, l);
    return m;
  }, [data]);

  // The item to show first selects its library and kind
  useEffect(() => {
    if (!data || !selKey) return;
    const [path] = selKey.split("|");
    const lib = data.libraries.find((l) => l.path === path);
    if (lib) {
      setKind(lib.kind);
      setLibPath((p) => p ?? lib.path);
    }
  }, [data, selKey]);

  // Default library: the user's own one of this kind, else the first
  useEffect(() => {
    if (libPath && libraries.some((l) => l.path === libPath)) return;
    const own = libraries.find((l) => l.editable && /My (furniture|textures)\./i.test(l.path));
    setLibPath((own ?? libraries.find((l) => l.editable) ?? libraries[0])?.path ?? null);
  }, [libraries, libPath]);

  const lib = libraries.find((l) => l.path === libPath) ?? null;

  // New items (Add) go to the selected library if it can be changed
  useEffect(() => {
    setLibraryTarget(lib?.editable ? lib.path : null);
  }, [lib, setLibraryTarget]);

  // Categories created in the library without items yet
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload after catalog changes
  useEffect(() => {
    if (!libPath) return;
    api
      .execute("library_categories", { path: libPath, lang: language() })
      .then((r) => setExtraCats((r as { categories: string[] }).categories))
      .catch(() => setExtraCats([]));
  }, [libPath, data]);

  const searching = query.trim() !== "";
  const items = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const all = (data?.items ?? []).filter((i) => i.kind === kind);
    if (words.length > 0) {
      return all.filter((i) => {
        const hay = [i.name, i.category, i.creator ?? "", ...i.tags].join(" ").toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
    return lib ? all.filter((i) => i.library === lib.index) : [];
  }, [data, kind, lib, query]);

  /** Groups: by library when searching, else by category (with empty created ones) */
  const groups = useMemo(() => {
    const m = new Map<string, CatalogItem[]>();
    if (searching) {
      for (const i of items) {
        const name = libraryName(libByIndex.get(i.library));
        m.set(name, [...(m.get(name) ?? []), i]);
      }
    } else {
      for (const c of extraCats) m.set(c, []);
      for (const i of items) m.set(i.category, [...(m.get(i.category) ?? []), i]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, extraCats, libByIndex, searching]);

  const selected = useMemo(() => {
    if (!selKey || !data) return null;
    const [path, idx] = selKey.split("|");
    const l = data.libraries.find((x) => x.path === path);
    const item = l && data.items.find((i) => i.library === l.index && i.index === Number(idx));
    return item && l ? { item, lib: l } : null;
  }, [selKey, data]);

  // Keys of the selected item, reloaded after each change of the catalog
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload after catalog changes
  useEffect(() => {
    if (!selected) {
      setDetails(null);
      return;
    }
    api
      .execute("library_item", {
        path: selected.lib.path,
        index: selected.item.index,
        lang: language(),
      })
      .then((r) => setDetails(r as Details))
      .catch((e) => setMessage({ text: errorText(e), undo: false }));
  }, [selected, data]);

  const select = useCallback((path: string, index: number) => {
    setSelKey(itemKey(path, index));
    setLibPath(path);
  }, []);

  const notify = useCallback(
    (text: string, undo = false) => {
      setMessage({ text, undo });
      void refreshHistory();
    },
    [refreshHistory],
  );

  const undo = useCallback(async () => {
    const r = await run("library_undo", {});
    if (r)
      setMessage({
        text: t("Undone: {what}", { what: historyLabel(r.undone as string | null) }),
        undo: false,
      });
  }, [run]);
  const redo = useCallback(async () => {
    const r = await run("library_redo", {});
    if (r)
      setMessage({
        text: t("Redone: {what}", { what: historyLabel(r.redone as string | null) }),
        undo: false,
      });
  }, [run]);

  // Escape closes, Ctrl+Z / Ctrl+Y undo and redo library changes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.matches?.("input, textarea, select");
      if (e.key === "Escape" && !menu) onClose();
      else if (!typing && e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undo();
      } else if (!typing && e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, menu, undo, redo]);

  const openItemMenu = async (item: CatalogItem, x: number, y: number) => {
    const l = libByIndex.get(item.library);
    const cats = await categoriesFor(item.kind, l?.path ?? null);
    setMenu({
      x,
      y,
      items: itemMenu(item, l, cats, { notify, edit: select }),
    });
  };

  const libraryMenu = (l: LibraryInfo, x: number, y: number) => {
    const items: MenuItem[] = [];
    if (l.editable) {
      items.push({
        label: t("Rename…"),
        action: () => {
          const name = window.prompt(t("New name of the library"), libraryName(l))?.trim();
          if (name) void run("library_rename", { path: l.path, name }, t("Library renamed"));
        },
      });
      items.push({
        label: t("New category…"),
        action: () => {
          const name = askCategoryName();
          if (name)
            void run("library_add_category", { path: l.path, name }).then(() =>
              loadCatalog(language()),
            );
        },
      });
    }
    items.push({
      label: l.hidden ? t("Show in the catalog") : t("Hide in the catalog"),
      action: () => void run("library_set_visible", { path: l.path, visible: l.hidden }),
    });
    if (l.editable) {
      items.push({ separator: true });
      items.push({
        label: t("Remove…"),
        danger: true,
        action: () => {
          if (
            !window.confirm(
              t("Remove the library “{name}”? The file is moved to the “removed” folder.", {
                name: libraryName(l),
              }),
            )
          )
            return;
          void run("library_remove", { path: l.path }, t("Library removed"));
        },
      });
    }
    if (!l.editable) {
      items.push({ heading: t("Part of the installation: read-only") });
    }
    setMenu({ x, y, items });
  };

  const newLibrary = async () => {
    const name = window.prompt(t("Name of the new library"), "")?.trim();
    if (!name) return;
    const r = await run("library_create", { kind, name }, t("Library created"));
    if (r?.path) setLibPath(String(r.path));
  };

  /** Asks for model or image files and libraries of the shown kind and imports them */
  const addFiles = async () => {
    const chosen = await open({
      multiple: true,
      filters: [
        {
          name: t("Supported files"),
          extensions: [
            ...(kind === "furniture" ? MODEL_EXTENSIONS : TEXTURE_EXTENSIONS),
            ...LIBRARY_EXTENSIONS,
            "zip",
          ],
        },
      ],
    });
    const paths = Array.isArray(chosen) ? chosen : chosen ? [chosen] : [];
    if (paths.length === 0) return;
    try {
      const note = await importFiles(paths, "libraries");
      if (note) notify(note, true);
    } catch (e) {
      notify(errorText(e));
    }
  };

  const addMenu = (x: number, y: number) => {
    const target = lib?.editable ? lib.path : null;
    const items: MenuItem[] = [
      {
        label: t("Files…"),
        note: kind === "furniture" ? t("models, libraries") : t("images, libraries"),
        action: addFiles,
      },
      {
        label: t("Search online…"),
        note: "Sweet Home 3D, Poly Haven",
        action: () => openDialog("online", undefined, "libraries"),
      },
    ];
    if (kind === "furniture") {
      const selection = useStore.getState().selection;
      items.push({
        label: t("From the home"),
        note: t("selected furniture"),
        disabled: selection.length === 0,
        action: () =>
          void run(
            "library_add_from_home",
            { ids: selection, ...(target ? { path: target } : {}) },
            t("The selected furniture was added to the library"),
          ),
      });
    }
    items.push({ separator: true });
    items.push({
      heading: target
        ? t("New items go to “{name}”", { name: libraryName(lib ?? undefined) })
        : t("New items go to your own library"),
    });
    setMenu({ x, y, items });
  };

  // "Add…" opens the editor with its Add menu, or for textures with the file dialog
  const addOnStart = useRef(adding);
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the libraries are known
  useEffect(() => {
    if (!addOnStart.current || !lib || !addButton.current) return;
    addOnStart.current = false;
    if (kind === "textures") {
      void addFiles();
      return;
    }
    const r = addButton.current.getBoundingClientRect();
    addMenu(r.left, r.bottom + 4);
  }, [lib]);

  const sel = selected?.item ?? null;
  const v = details?.values ?? {};
  const editable = !!selected?.lib.editable;
  const setKeys = (set: Record<string, string | null>) => {
    if (!selected) return;
    void run(
      "library_update_item",
      { path: selected.lib.path, index: selected.item.index, set, lang: language() },
      t("Changed"),
    );
  };
  const setKey = (key: string, value: string) =>
    setKeys({ [key]: value.trim() === "" ? null : value });
  const type = pieceType(v);
  const changeType = (next: PieceType) => {
    const clear: Record<string, string | null> = {
      doorOrWindow: null,
      staircaseCutOutShape: null,
      lightSourceX: null,
      lightSourceY: null,
      lightSourceZ: null,
      lightSourceColor: null,
      lightSourceDiameter: null,
      lightSourceMaterialName: null,
      shelfElevations: null,
    };
    const w = Number(v.width) || 50;
    const d = Number(v.depth) || 50;
    const h = Number(v.height) || 50;
    if (next === "door") clear.doorOrWindow = "true";
    if (next === "stairs") clear.staircaseCutOutShape = FULL_SHAPE;
    if (next === "light") {
      clear.lightSourceX = String(Math.round(w / 2));
      clear.lightSourceY = String(Math.round(d / 2));
      clear.lightSourceZ = String(Math.round(h * 0.8));
      clear.lightSourceColor = "#FFFFE0";
      clear.lightSourceDiameter = String(Math.max(1, Math.round(w * 0.1)));
    }
    if (next === "shelf") clear.shelfElevations = String(Math.round(h / 2));
    setKeys(clear);
  };

  const rotate = (axis: "x" | "y" | "z") => {
    const r = new THREE.Matrix4();
    if (axis === "x") r.makeRotationX(Math.PI / 2);
    else if (axis === "y") r.makeRotationY(Math.PI / 2);
    else r.makeRotationZ(Math.PI / 2);
    const next = r.multiply(rotationMatrix(v.modelRotation));
    const [w, h, d] = [v.width, v.height, v.depth];
    // Turning around x or z swaps the size along the turned axes
    const swapped: Record<string, string | null> =
      axis === "x"
        ? { modelRotation: rotationText(next), height: d, depth: h }
        : axis === "z"
          ? { modelRotation: rotationText(next), width: h, height: w }
          : { modelRotation: rotationText(next), width: d, depth: w };
    setKeys(swapped);
  };

  const iconFromView = () => {
    const png = iconRef.current?.();
    if (!png || !selected) return;
    void run(
      "library_set_icon",
      { path: selected.lib.path, index: selected.item.index, png_base64: png },
      t("Icon changed"),
    );
  };

  const lightRows = useMemo(() => {
    const split = (k: string) => (v[k] ?? "").split(/\s+/).filter(Boolean);
    const xs = split("lightSourceX");
    const ys = split("lightSourceY");
    const zs = split("lightSourceZ");
    const cs = split("lightSourceColor");
    const ds = split("lightSourceDiameter");
    return xs.map((x, i) => ({
      x,
      y: ys[i] ?? "",
      z: zs[i] ?? "",
      color: cs[i] ?? "#FFFFFF",
      d: ds[i] ?? "",
    }));
  }, [v]);
  const setLights = (rows: { x: string; y: string; z: string; color: string; d: string }[]) =>
    setKeys({
      lightSourceX: rows.map((r) => r.x).join(" ") || null,
      lightSourceY: rows.map((r) => r.y).join(" ") || null,
      lightSourceZ: rows.map((r) => r.z).join(" ") || null,
      lightSourceColor: rows.map((r) => r.color).join(" ") || null,
      lightSourceDiameter: rows.map((r) => r.d).join(" ") || null,
    });

  const modelUrl =
    sel && sel.kind === "furniture" && sel.model ? libResourceUrl(sel.library, sel.model) : null;
  const imageUrl = sel?.icon ? libResourceUrl(sel.library, sel.icon) : null;

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialog}
        className={`dialog libed${frame.maximized ? " maximized" : ""}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={t("Libraries")}
      >
        {!frame.maximized &&
          EDGES.map((edge) => (
            <div key={edge} className={`libed-resize ${edge}`} onPointerDown={resizeStart(edge)} />
          ))}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: title bar, moved with the mouse */}
        <header
          className="libed-toolbar"
          onPointerDown={moveStart}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest("button, input, select")) toggleMaximized();
          }}
        >
          <h2>{t("Libraries")}</h2>
          <div className="segmented">
            <button
              type="button"
              className={kind === "furniture" ? "active" : ""}
              onClick={() => {
                setKind("furniture");
                setLibPath(null);
                setSelKey(null);
              }}
            >
              {t("Furniture")}
            </button>
            <button
              type="button"
              className={kind === "textures" ? "active" : ""}
              onClick={() => {
                setKind("textures");
                setLibPath(null);
                setSelKey(null);
              }}
            >
              {t("Textures")}
            </button>
          </div>
          <span className="libed-spacer" />
          <button
            type="button"
            title={
              history.undo
                ? t("Undo: {what}", { what: historyLabel(history.undo) })
                : t("Nothing to undo")
            }
            disabled={!history.undo}
            onClick={() => void undo()}
          >
            {t("Undo")}
          </button>
          <button
            type="button"
            title={
              history.redo
                ? t("Redo: {what}", { what: historyLabel(history.redo) })
                : t("Nothing to redo")
            }
            disabled={!history.redo}
            onClick={() => void redo()}
          >
            {t("Redo")}
          </button>
          <button
            ref={addButton}
            type="button"
            className="primary"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              addMenu(r.left, r.bottom + 4);
            }}
          >
            {t("Add")} ▾
          </button>
          <button
            type="button"
            onClick={toggleMaximized}
            aria-label={frame.maximized ? t("Restore") : t("Maximize")}
            title={frame.maximized ? t("Restore") : t("Maximize")}
          >
            <Icon name={frame.maximized ? "restore" : "maximize"} size={16} />
          </button>
          <button type="button" onClick={onClose} aria-label={t("Close")} title={t("Close")}>
            ×
          </button>
        </header>
        <div className="libed-body">
          <aside className="libed-side" ref={side}>
            <div className="libed-libs-pane">
              <div className="libed-heading">{t("Libraries")}</div>
              <ul className="libed-libs">
                {libraries.map((l) => (
                  <li key={l.path} className={l.path === libPath ? "active" : undefined}>
                    <button
                      type="button"
                      className="libed-lib"
                      onClick={() => {
                        setLibPath(l.path);
                        setQuery("");
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        libraryMenu(l, e.clientX, e.clientY);
                      }}
                      title={l.path}
                    >
                      <span className="libed-lib-name">{libraryName(l)}</span>
                      <span className="muted small">
                        {(data?.items ?? []).filter((i) => i.library === l.index).length}
                      </span>
                      {!l.editable && (
                        <span className="muted small" title={t("Read-only")}>
                          🔒
                        </span>
                      )}
                      {l.hidden && <span className="muted small">{t("hidden")}</span>}
                    </button>
                    <button
                      type="button"
                      className="libed-more"
                      aria-label={t("Actions for {name}", { name: libraryName(l) })}
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        libraryMenu(l, r.left, r.bottom);
                      }}
                    >
                      ⋯
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" className="link-button" onClick={() => void newLibrary()}>
                {t("New library…")}
              </button>
            </div>
            <Splitter
              orientation="horizontal"
              className="libed-split-libs"
              title={t("Drag to resize")}
              onDrag={(_x, y) => {
                const r = side.current?.getBoundingClientRect();
                panes.libs(y, r?.top, r?.bottom);
              }}
              onReset={() => updateFrame({ libs: DEFAULT_FRAME.libs })}
            />
            <input
              type="search"
              placeholder={t("Search all libraries…")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t("Search all libraries")}
            />
            <div className="libed-note muted small">
              {searching
                ? t("{n} items found in all libraries", { n: items.length })
                : lib?.editable
                  ? t("Your library: everything can be changed. Sweet Home 3D sees it too.")
                  : t(
                      "Part of the installation: read-only. “Edit as copy” puts a copy into your own library.",
                    )}
            </div>
            <div className="libed-items">
              {groups.map(([group, list]) => (
                <section key={group}>
                  <button
                    type="button"
                    className="libed-group"
                    aria-expanded={!closed.has(group)}
                    onClick={() =>
                      setClosed((prev) => {
                        const next = new Set(prev);
                        if (next.has(group)) next.delete(group);
                        else next.add(group);
                        return next;
                      })
                    }
                  >
                    {closed.has(group) ? "▸" : "▾"} {group}{" "}
                    <span className="muted">{list.length}</span>
                  </button>
                  {!closed.has(group) && (
                    <ul>
                      {list.map((i) => {
                        const l = libByIndex.get(i.library);
                        const key = l ? itemKey(l.path, i.index) : "";
                        return (
                          <li
                            key={`${i.library}:${i.index}`}
                            className={key === selKey ? "active" : undefined}
                          >
                            <button
                              type="button"
                              className="libed-item"
                              onClick={() => l && select(l.path, i.index)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (l) select(l.path, i.index);
                                void openItemMenu(i, e.clientX, e.clientY);
                              }}
                            >
                              {i.icon ? (
                                <img
                                  src={libResourceUrl(i.library, i.icon)}
                                  alt=""
                                  loading="lazy"
                                />
                              ) : (
                                <span className="catalog-icon-placeholder" />
                              )}
                              <span className="libed-item-text">
                                <span>{i.name}</span>
                                <span className="muted small">
                                  {searching ? i.category : formatSize(i)}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              className="libed-more"
                              aria-label={t("Actions for {name}", { name: i.name })}
                              onClick={(e) => {
                                if (l) select(l.path, i.index);
                                const r = e.currentTarget.getBoundingClientRect();
                                void openItemMenu(i, r.left, r.bottom);
                              }}
                            >
                              ⋯
                            </button>
                          </li>
                        );
                      })}
                      {list.length === 0 && (
                        <li className="muted small libed-empty">{t("No items yet")}</li>
                      )}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </aside>
          <Splitter
            orientation="vertical"
            className="libed-split"
            title={t("Drag to resize")}
            onDrag={(x) => panes.side(x)}
            onReset={() => updateFrame({ side: DEFAULT_FRAME.side })}
          />

          <section className="libed-preview">
            {!sel && (
              <div className="muted libed-placeholder">{t("Choose an item on the left.")}</div>
            )}
            {sel?.kind === "furniture" && type === "door" && details && (
              <ShapeEditor
                mode="door"
                width={Number(v.width) || 1}
                height={Number(v.height) || 1}
                image={imageUrl}
                shape={v.doorOrWindowCutOutShape ?? null}
                disabled={!editable}
                onChange={(shape) => setKeys({ doorOrWindowCutOutShape: shape })}
              />
            )}
            {sel?.kind === "furniture" && type === "stairs" && details && (
              <ShapeEditor
                mode="stairs"
                width={Number(v.width) || 1}
                height={Number(v.depth) || 1}
                image={imageUrl}
                shape={v.staircaseCutOutShape ?? FULL_SHAPE}
                disabled={!editable}
                onChange={(shape) => setKeys({ staircaseCutOutShape: shape ?? FULL_SHAPE })}
              />
            )}
            {sel?.kind === "furniture" && (
              <ModelPreview url={modelUrl} rotation={v.modelRotation} iconRef={iconRef} />
            )}
            {sel?.kind === "textures" && imageUrl && (
              <div className="libed-texture">
                <div
                  className="libed-wall"
                  style={{
                    backgroundImage: `url("${imageUrl}")`,
                    // A wall of 4 × 2.5 m shown 400 px wide
                    backgroundSize: `${(sel.width / 400) * 100}% ${(sel.height / 250) * 100}%`,
                  }}
                />
                <span className="muted small">
                  {t("On a wall of 4 × 2.5 m – one tile is {w} × {h} cm", {
                    w: formatPrecise(sel.width),
                    h: formatPrecise(sel.height),
                  })}
                </span>
              </div>
            )}
            {sel?.kind === "furniture" && (
              <div className="libed-preview-tools">
                <button type="button" disabled={!editable} onClick={iconFromView}>
                  {t("Icon from view")}
                </button>
                <span className="libed-spacer" />
                <span className="muted small">{t("Upright")}</span>
                {(["x", "y", "z"] as const).map((a) => (
                  <button key={a} type="button" disabled={!editable} onClick={() => rotate(a)}>
                    ⟳ {a.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </section>
          <Splitter
            orientation="vertical"
            className="libed-split"
            title={t("Drag to resize")}
            onDrag={(x) => panes.props(x)}
            onReset={() => updateFrame({ props: DEFAULT_FRAME.props })}
          />

          <section className="libed-props">
            {sel && details ? (
              <>
                <div className="libed-props-head">
                  <strong>{sel.name}</strong>
                  <span className="muted small">{libraryName(selected?.lib)}</span>
                  {!editable && (
                    <div className="libed-readonly">
                      <span>{t("Read-only (part of the installation).")}</span>
                      <button
                        type="button"
                        onClick={() => {
                          const items = itemMenu(sel, selected?.lib, [], { notify, edit: select });
                          const copy = items.find(
                            (m) => "action" in m && m.label === t("Edit as copy…"),
                          );
                          if (copy && "action" in copy) copy.action();
                        }}
                      >
                        {t("Edit as copy…")}
                      </button>
                    </div>
                  )}
                  <div className="segmented libed-tabs" role="tablist">
                    {(
                      [
                        ["general", t("General")],
                        ["size", sel.kind === "furniture" ? t("Size and model") : t("Tile size")],
                        ...(sel.kind === "furniture" ? [["type", t("Kind")]] : []),
                      ] as [typeof tab, string][]
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={tab === id}
                        className={tab === id ? "active" : ""}
                        onClick={() => setTab(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="libed-props-body">
                  {tab === "general" && (
                    <>
                      <Field
                        label={t("Name")}
                        value={sel.name}
                        disabled={!editable}
                        onCommit={(x) => x.trim() && setKeys({ name: x.trim() })}
                      />
                      <div className="libed-field">
                        <span>{t("Category")}</span>
                        <span className="libed-category">
                          <span>{sel.category}</span>
                          <button
                            type="button"
                            disabled={!editable}
                            onClick={async (e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              const cats = await categoriesFor(
                                sel.kind,
                                selected?.lib.path ?? null,
                              );
                              const entries = itemMenu(sel, selected?.lib, cats, {
                                notify,
                                edit: select,
                              });
                              const move = entries.find((m) => "items" in m);
                              if (move && "items" in move)
                                setMenu({ x: r.left, y: r.bottom, items: move.items });
                            }}
                          >
                            {t("Move to…")}
                          </button>
                        </span>
                        <span />
                      </div>
                      {sel.kind === "furniture" && (
                        <Field
                          label={t("Tags")}
                          value={v.tags ?? ""}
                          disabled={!editable}
                          onCommit={(x) => setKey("tags", x)}
                          placeholder={t("comma separated")}
                        />
                      )}
                      <Field
                        label={t("Creator")}
                        value={v.creator ?? ""}
                        disabled={!editable}
                        onCommit={(x) => setKey("creator", x)}
                      />
                      <Field
                        label={t("License")}
                        value={v.license ?? ""}
                        disabled={!editable}
                        onCommit={(x) => setKey("license", x)}
                        placeholder="CC0, CC-BY 4.0, GPL…"
                      />
                      {sel.kind === "furniture" && (
                        <>
                          <Field
                            label={t("Price")}
                            value={v.price ?? ""}
                            disabled={!editable}
                            onCommit={(x) => setKey("price", x.replace(",", "."))}
                          />
                          <Field
                            label={t("VAT")}
                            value={v.valueAddedTaxPercentage ?? ""}
                            unit="%"
                            disabled={!editable}
                            onCommit={(x) => setKey("valueAddedTaxPercentage", x.replace(",", "."))}
                          />
                          <Field
                            label={t("Description")}
                            value={v.description ?? ""}
                            multiline
                            disabled={!editable}
                            onCommit={(x) => setKey("description", x)}
                          />
                          <Field
                            label={t("Information")}
                            value={v.information ?? ""}
                            disabled={!editable}
                            onCommit={(x) => setKey("information", x)}
                            placeholder={t("Link or note (manufacturer, shop)")}
                          />
                        </>
                      )}
                      <div className="muted small libed-id">{v.id ?? ""}</div>
                    </>
                  )}
                  {tab === "size" && sel.kind === "furniture" && (
                    <>
                      <Field
                        label={t("Width")}
                        value={v.width ?? ""}
                        unit="cm"
                        disabled={!editable}
                        onCommit={(x) => setKey("width", x.replace(",", "."))}
                      />
                      <Field
                        label={t("Depth")}
                        value={v.depth ?? ""}
                        unit="cm"
                        disabled={!editable}
                        onCommit={(x) => setKey("depth", x.replace(",", "."))}
                      />
                      <Field
                        label={t("Height")}
                        value={v.height ?? ""}
                        unit="cm"
                        disabled={!editable}
                        onCommit={(x) => setKey("height", x.replace(",", "."))}
                      />
                      <Field
                        label={t("Elevation")}
                        value={v.elevation ?? "0"}
                        unit="cm"
                        disabled={!editable}
                        onCommit={(x) => setKey("elevation", x.replace(",", "."))}
                      />
                      <hr />
                      {(
                        [
                          ["movable", t("Movable"), true],
                          ["resizable", t("Resizable"), true],
                          [
                            "deformable",
                            t("Deformable (width, depth and height separately)"),
                            true,
                          ],
                          ["texturable", t("Texturable"), true],
                          ["horizontallyRotatable", t("Can be tilted"), true],
                          ["backFaceShown", t("Show back faces"), false],
                        ] as [string, string, boolean][]
                      ).map(([key, label, def]) => (
                        <Check
                          key={key}
                          label={label}
                          checked={v[key] === undefined ? def : v[key] === "true"}
                          disabled={!editable}
                          onChange={(on) => setKeys({ [key]: on === def ? null : String(on) })}
                        />
                      ))}
                    </>
                  )}
                  {tab === "size" && sel.kind === "textures" && (
                    <>
                      <Field
                        label={t("Width")}
                        value={v.width ?? ""}
                        unit="cm"
                        disabled={!editable}
                        onCommit={(x) => setKey("width", x.replace(",", "."))}
                      />
                      <Field
                        label={t("Height")}
                        value={v.height ?? ""}
                        unit="cm"
                        disabled={!editable}
                        onCommit={(x) => setKey("height", x.replace(",", "."))}
                      />
                    </>
                  )}
                  {tab === "type" && sel.kind === "furniture" && (
                    <>
                      <div className="muted small">
                        {t(
                          "An item has exactly one kind. The fields below follow it, the preview shows what fits.",
                        )}
                      </div>
                      <div className="libed-types">
                        {(
                          [
                            ["furniture", t("Furniture")],
                            ["door", t("Door or window")],
                            ["stairs", t("Staircase")],
                            ["light", t("Light")],
                            ["shelf", t("Shelf")],
                          ] as [PieceType, string][]
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            aria-pressed={type === id}
                            className={type === id ? "active" : ""}
                            disabled={!editable}
                            onClick={() => type !== id && changeType(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      {type === "door" && (
                        <>
                          <Field
                            label={t("Wall part of the depth")}
                            value={v.doorOrWindowWallThickness ?? ""}
                            unit="cm"
                            disabled={!editable}
                            onCommit={(x) =>
                              setKey("doorOrWindowWallThickness", x.replace(",", "."))
                            }
                            placeholder={t("whole depth")}
                          />
                          <Field
                            label={t("Distance to the back")}
                            value={v.doorOrWindowWallDistance ?? ""}
                            unit="cm"
                            disabled={!editable}
                            onCommit={(x) =>
                              setKey("doorOrWindowWallDistance", x.replace(",", "."))
                            }
                            placeholder="0"
                          />
                          <Check
                            label={t("Cut the wall on both sides")}
                            checked={v.doorOrWindowWallCutOutOnBothSides === "true"}
                            disabled={!editable}
                            onChange={(on) =>
                              setKeys({ doorOrWindowWallCutOutOnBothSides: on ? "true" : null })
                            }
                          />
                          <div className="muted small">
                            {t("The opening cut into the wall is drawn in the preview (red).")}
                          </div>
                        </>
                      )}
                      {type === "stairs" && (
                        <div className="muted small">
                          {t(
                            "The hole in the floor above is drawn in the preview (top view). In the virtual visit the steps of the model can be walked up.",
                          )}
                        </div>
                      )}
                      {type === "light" && (
                        <>
                          <div className="libed-lights">
                            <span>X</span>
                            <span>Y</span>
                            <span>Z</span>
                            <span>Ø</span>
                            <span>{t("Color")}</span>
                            <span />
                            {lightRows.map((r, i) => (
                              <LightRow
                                // biome-ignore lint/suspicious/noArrayIndexKey: light sources have no ID
                                key={i}
                                row={r}
                                disabled={!editable}
                                onChange={(row) =>
                                  setLights(lightRows.map((x, k) => (k === i ? row : x)))
                                }
                                onRemove={() => setLights(lightRows.filter((_, k) => k !== i))}
                              />
                            ))}
                          </div>
                          <button
                            type="button"
                            disabled={!editable}
                            onClick={() =>
                              setLights([
                                ...lightRows,
                                {
                                  x: String(Math.round((Number(v.width) || 50) / 2)),
                                  y: String(Math.round((Number(v.depth) || 50) / 2)),
                                  z: String(Math.round((Number(v.height) || 50) * 0.8)),
                                  color: "#FFFFE0",
                                  d: "5",
                                },
                              ])
                            }
                          >
                            {t("Add light source")}
                          </button>
                          <div className="muted small">
                            {t("Positions in cm from the left, back and bottom of the piece.")}
                          </div>
                        </>
                      )}
                      {type === "shelf" && (
                        <Field
                          label={t("Shelf heights")}
                          value={v.shelfElevations ?? ""}
                          unit="cm"
                          disabled={!editable}
                          onCommit={(x) => setKey("shelfElevations", x.replace(/[,;]+/g, " "))}
                          placeholder="38 76 114"
                        />
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="muted libed-placeholder">
                {t("Properties of the chosen item appear here.")}
              </div>
            )}
          </section>
        </div>
        {message && (
          <div className="libed-message" role="status">
            <span>{message.text}</span>
            {message.undo && history.undo && (
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  void undo();
                }}
              >
                {t("Undo")}
              </button>
            )}
            <button type="button" onClick={() => setMessage(null)} aria-label={t("Close")}>
              ×
            </button>
          </div>
        )}
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menu.items}
            fixed
            onClose={() => setMenu(null)}
          />
        )}
      </div>
    </div>
  );
}

function LightRow({
  row,
  disabled,
  onChange,
  onRemove,
}: {
  row: { x: string; y: string; z: string; color: string; d: string };
  disabled: boolean;
  onChange: (row: { x: string; y: string; z: string; color: string; d: string }) => void;
  onRemove: () => void;
}) {
  const cell = (key: "x" | "y" | "z" | "d") => (
    <input
      type="text"
      defaultValue={row[key]}
      disabled={disabled}
      aria-label={key.toUpperCase()}
      onBlur={(e) =>
        e.target.value !== row[key] && onChange({ ...row, [key]: e.target.value.replace(",", ".") })
      }
    />
  );
  return (
    <>
      {cell("x")}
      {cell("y")}
      {cell("z")}
      {cell("d")}
      <input
        type="color"
        value={/^#[0-9a-f]{6}$/i.test(row.color) ? row.color : "#ffffff"}
        disabled={disabled}
        aria-label={t("Color")}
        onChange={(e) => onChange({ ...row, color: e.target.value.toUpperCase() })}
      />
      <button type="button" disabled={disabled} onClick={onRemove} aria-label={t("Remove")}>
        ×
      </button>
    </>
  );
}
