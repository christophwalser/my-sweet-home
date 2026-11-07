// 2D plan view: drawing, zoom/pan, selection and editing tools.
//
// Mouse: left button selects (Shift adds), drags selected elements, the handles
// of a single selected element or a rubber band; right or middle button pans;
// wheel zooms. Drawing tools add points with clicks; double-click or Enter
// finishes, Escape cancels; a double-click inside walls with the room tool creates
// the room of the enclosed area. Ctrl+C / X / V / D copy, cut, paste and
// duplicate, Ctrl+A selects everything on the level. Every change is a registry
// command (one undo step), like changes from the CLI or MCP.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATALOG_DRAG_TYPE, type CatalogDragData, docResourceUrl } from "../api";
import { forEachPiece, type Pt } from "../model";
import { type Tool, useStore } from "../store";
import {
  drawPlan,
  type PlanColors,
  type PlanInput,
  planBounds,
  type ViewTransform,
} from "./drawPlan";
import { dragHandle, elementHandles, type Handle, type HandleDrag, handleAt } from "./handles";
import {
  elementsInRect,
  hitTest,
  nearestWall,
  snapPoint,
  wallEndPoints,
  wallSideCorners,
} from "./interaction";
import { drawOverlay, type PlanOverlay } from "./overlay";

const LIGHT: PlanColors = {
  background: "#ffffff",
  grid: "#eef0f3",
  wallFill: "#6b6f76",
  wallStroke: "#3a3d42",
  roomFill: "#808080",
  roomStroke: "#4b5058",
  furnitureStroke: "#4b5058",
  text: "#1c2026",
  dimension: "#2f6fde",
};

const DARK: PlanColors = {
  background: "#1b1d21",
  grid: "#24272c",
  wallFill: "#9aa0a8",
  wallStroke: "#c8ccd2",
  roomFill: "#4a4d52",
  roomStroke: "#8a8f96",
  furnitureStroke: "#aab0b8",
  text: "#e6e8eb",
  dimension: "#6c9cf2",
};

/** Pick and snap radius in screen pixels. */
const PICK_PX = 6;
const SNAP_PX = 12;
/** Pointer movement in screen pixels before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

function useDarkMode(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return dark;
}

type Gesture =
  | { kind: "pan"; last: [number, number] }
  | { kind: "press"; start: Pt; screen: [number, number]; hitId: string | null; shift: boolean }
  | { kind: "move"; start: Pt; offset: Pt }
  | { kind: "band"; start: Pt; end: Pt }
  | { kind: "handle"; handle: Handle; drag: HandleDrag | null; cursor: Pt };

/** Tools that draw a path of points. */
const PATH_TOOLS: Tool[] = ["wall", "room", "dimension", "polyline"];
const isPathTool = (t: Tool) => PATH_TOOLS.includes(t);

/** Cursor over a handle. */
const HANDLE_CURSOR: Record<Handle["kind"], string> = {
  "wall-start": "move",
  "wall-end": "move",
  "room-point": "move",
  "polyline-point": "move",
  "dimension-start": "move",
  "dimension-end": "move",
  "piece-resize": "nwse-resize",
  "piece-rotate": "grab",
};

const cursorStyle: Record<Tool, string> = {
  select: "default",
  wall: "crosshair",
  room: "crosshair",
  polyline: "crosshair",
  dimension: "crosshair",
  label: "text",
};

export default function PlanView() {
  const opened = useStore((s) => s.opened);
  const levelId = useStore((s) => s.selectedLevel);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [icons, setIcons] = useState(() => new Map<string, HTMLImageElement>());
  const [, setRedraw] = useState(0);
  const dark = useDarkMode();
  const colors = dark ? DARK : LIGHT;
  const accent = dark ? "#5b8ff0" : "#2f6fde";

  const gesture = useRef<Gesture | null>(null);
  const draft = useRef<Pt[]>([]);
  const cursor = useRef<Pt | null>(null);
  const snapMarker = useRef<Pt | null>(null);

  const input: PlanInput | null = useMemo(
    () =>
      opened
        ? {
            home: opened.home,
            wallShapes: opened.wallShapes,
            levelId: opened.home.levels.length ? levelId : null,
            icons,
          }
        : null,
    [opened, levelId, icons],
  );
  const effectiveLevel = input?.levelId ?? null;

  // Load furniture icons and floor textures of the home
  useEffect(() => {
    if (!opened) return;
    const map = new Map<string, HTMLImageElement>();
    let pending = 0;
    const load = (key: string) => {
      if (map.has(key)) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      pending++;
      img.onload = img.onerror = () => {
        pending--;
        if (pending === 0) setRedraw((n) => n + 1);
      };
      img.src = docResourceUrl(opened.id, key);
      map.set(key, img);
    };
    forEachPiece(opened.home.furniture, (p) => {
      const key = p.attrs.plan_icon ?? p.attrs.icon;
      if (key) load(key);
    });
    for (const room of opened.home.rooms) {
      const key = room.textures?.find((t) => t.role === "floorTexture")?.image;
      if (key) load(key);
    }
    setIcons(map);
  }, [opened]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!input) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawPlan(ctx, canvas.width, canvas.height, viewRef.current, input, colors);
    const g = gesture.current;
    const drawing = isPathTool(tool);
    const points = cursor.current && drawing ? [...draft.current, cursor.current] : draft.current;
    const selection = useStore.getState().selection;
    const overlay: PlanOverlay = {
      selection,
      dragOffset: g?.kind === "move" ? g.offset : null,
      draft:
        drawing && points.length > 0
          ? { points, kind: tool as "wall" | "room" | "dimension" | "polyline" }
          : null,
      rubberBand: g?.kind === "band" ? [g.start, g.end] : null,
      snap: drawing ? snapMarker.current : null,
      handles:
        tool === "select" && selection.length === 1 ? elementHandles(input.home, selection[0]) : [],
      handleDrag: g?.kind === "handle" && g.drag ? { drag: g.drag, cursor: g.cursor } : null,
      accent,
    };
    drawOverlay(ctx, viewRef.current, input.home, input.wallShapes, overlay);
  }, [input, colors, tool, accent]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !input) return;
    const b = planBounds(input);
    if (!b) return;
    const margin = 40 * devicePixelRatio;
    const w = Math.max(b[2] - b[0], 100);
    const h = Math.max(b[3] - b[1], 100);
    const scale = Math.min((canvas.width - 2 * margin) / w, (canvas.height - 2 * margin) / h);
    viewRef.current = {
      scale,
      offsetX: canvas.width / 2 - ((b[0] + b[2]) / 2) * scale,
      offsetY: canvas.height / 2 - ((b[1] + b[3]) / 2) * scale,
    };
    draw();
  }, [input, draw]);

  // Resize the canvas to its CSS size in device pixels
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
      draw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [draw]);

  // Fit when another home is opened or the level changes. Live edits (UI, CLI, MCP)
  // keep fitting until the user zooms or pans.
  const userMoved = useRef(false);
  const fitKey = useRef<string | null>(null);
  const refit = () => {
    userMoved.current = false;
    fit();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit only on home/level change
  useEffect(() => {
    const key = `${opened?.id ?? ""}:${levelId ?? ""}`;
    if (fitKey.current !== key) {
      fitKey.current = key;
      userMoved.current = false;
    }
    if (!userMoved.current) fit();
  }, [opened, levelId]);

  // Switching tools cancels a drawing in progress
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on tool change only
  useEffect(() => {
    draft.current = [];
    snapMarker.current = null;
    draw();
  }, [tool]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw when the selection changes
  useEffect(() => draw(), [draw, selection]);

  // ---------------------------------------------------------------- coordinates

  const toWorld = (clientX: number, clientY: number): Pt => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const v = viewRef.current;
    const x = ((clientX - (rect?.left ?? 0)) * devicePixelRatio - v.offsetX) / v.scale;
    const y = ((clientY - (rect?.top ?? 0)) * devicePixelRatio - v.offsetY) / v.scale;
    return [x, y];
  };
  const pxToCm = (px: number) => (px * devicePixelRatio) / viewRef.current.scale;

  const levelParam = () => (effectiveLevel ? { level: effectiveLevel } : {});

  /** Cursor point for drawing tools, with magnetism unless Alt is pressed. */
  const snapped = (p: Pt, altKey: boolean): Pt => {
    if (!input || altKey) {
      snapMarker.current = null;
      return p;
    }
    const previous = draft.current.length > 0 ? draft.current[draft.current.length - 1] : null;
    // Walls snap to wall ends (axis), rooms to the corners of the wall sides,
    // polylines only to their own first point
    const walls =
      tool === "room"
        ? wallSideCorners(input.home, input.wallShapes, effectiveLevel)
        : tool === "polyline"
          ? []
          : wallEndPoints(input.home, effectiveLevel);
    const targets = [...walls, ...draft.current.slice(0, 1)];
    const s = snapPoint(p, previous, targets, pxToCm(SNAP_PX));
    const onTarget = targets.some((t) => t[0] === s[0] && t[1] === s[1]);
    snapMarker.current = onTarget ? s : null;
    return s;
  };

  // ---------------------------------------------------------------- commands

  const { run, setSelection } = useStore.getState();

  const finishDraft = async () => {
    const pts = draft.current;
    draft.current = [];
    cursor.current = null;
    snapMarker.current = null;
    draw();
    if (tool === "wall" && pts.length >= 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      const closed = pts.length >= 4 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1;
      const points = closed ? pts.slice(0, -1) : pts;
      const result = (await run("wall_add_path", { points, closed, ...levelParam() })) as
        | { ids?: string[] }
        | undefined;
      if (result?.ids) setSelection(result.ids);
    } else if (tool === "room" && pts.length >= 3) {
      const result = (await run("room_add", { points: pts, ...levelParam() })) as
        | { id?: string }
        | undefined;
      if (result?.id) setSelection([result.id]);
    } else if (tool === "polyline" && pts.length >= 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      const closed = pts.length >= 4 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1;
      const points = closed ? pts.slice(0, -1) : pts;
      const result = (await run("polyline_add", { points, closed, ...levelParam() })) as
        | { id?: string }
        | undefined;
      if (result?.id) setSelection([result.id]);
    }
  };

  /** Room of the area enclosed by walls around `p` (double-click with the room tool). */
  const addRoomAt = async (p: Pt) => {
    draft.current = [];
    cursor.current = null;
    snapMarker.current = null;
    draw();
    const result = (await run("room_add", {
      inside_point: [Math.round(p[0]), Math.round(p[1])],
      ...levelParam(),
    })) as { id?: string } | undefined;
    if (result?.id) setSelection([result.id]);
  };

  const addDraftPoint = async (p: Pt) => {
    const pts = draft.current;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.5) return;
    pts.push(p);
    if (tool === "dimension" && pts.length === 2) {
      const [a, b] = pts;
      draft.current = [];
      draw();
      const result = (await run("dimension_add", {
        x_start: a[0],
        y_start: a[1],
        x_end: b[0],
        y_end: b[1],
        ...levelParam(),
      })) as { id?: string } | undefined;
      if (result?.id) setSelection([result.id]);
      return;
    }
    // Clicking the first point of a wall path or polyline again closes it
    if ((tool === "wall" || tool === "polyline") && pts.length >= 3) {
      const first = pts[0];
      if (Math.hypot(first[0] - p[0], first[1] - p[1]) < 0.5) {
        await finishDraft();
        return;
      }
    }
    draw();
  };

  // ---------------------------------------------------------------- mouse

  const onWheel = (e: React.WheelEvent) => {
    userMoved.current = true;
    const v = viewRef.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const mx = e.nativeEvent.offsetX * devicePixelRatio;
    const my = e.nativeEvent.offsetY * devicePixelRatio;
    const scale = Math.min(Math.max(v.scale * factor, 0.01), 50);
    viewRef.current = {
      scale,
      offsetX: mx - ((mx - v.offsetX) * scale) / v.scale,
      offsetY: my - ((my - v.offsetY) * scale) / v.scale,
    };
    draw();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      userMoved.current = true;
      gesture.current = { kind: "pan", last: [e.clientX, e.clientY] };
      return;
    }
    if (e.button !== 0 || !input) return;
    const p = toWorld(e.clientX, e.clientY);
    if (tool === "select") {
      const sel = useStore.getState().selection;
      const handle =
        sel.length === 1
          ? handleAt(elementHandles(input.home, sel[0]), p, pxToCm(PICK_PX + 2))
          : null;
      if (handle) {
        gesture.current = { kind: "handle", handle, drag: null, cursor: p };
        return;
      }
      const hit = hitTest(input.home, input.wallShapes, effectiveLevel, p, pxToCm(PICK_PX));
      gesture.current = {
        kind: "press",
        start: p,
        screen: [e.clientX, e.clientY],
        hitId: hit?.id ?? null,
        shift: e.shiftKey,
      };
    } else if (tool === "label") {
      const text = window.prompt("Label text");
      if (text?.trim()) {
        void run("label_add", {
          text,
          x: Math.round(p[0]),
          y: Math.round(p[1]),
          ...levelParam(),
        }).then((r) => {
          const id = (r as { id?: string } | undefined)?.id;
          if (id) setSelection([id]);
        });
      }
    } else {
      void addDraftPoint(snapped(p, e.altKey));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g?.kind === "pan") {
      const v = viewRef.current;
      viewRef.current = {
        ...v,
        offsetX: v.offsetX + (e.clientX - g.last[0]) * devicePixelRatio,
        offsetY: v.offsetY + (e.clientY - g.last[1]) * devicePixelRatio,
      };
      g.last = [e.clientX, e.clientY];
      draw();
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (g?.kind === "handle" && input) {
      g.cursor = p;
      g.drag = dragHandle(
        input.home,
        input.wallShapes,
        effectiveLevel,
        g.handle,
        p,
        pxToCm(SNAP_PX),
        !e.altKey,
      );
      draw();
      return;
    }
    if (!g && tool === "select" && input && canvasRef.current) {
      // Cursor feedback over the handles of the selected element
      const sel = useStore.getState().selection;
      const handle =
        sel.length === 1
          ? handleAt(elementHandles(input.home, sel[0]), p, pxToCm(PICK_PX + 2))
          : null;
      canvasRef.current.style.cursor = handle ? HANDLE_CURSOR[handle.kind] : cursorStyle.select;
    }
    if (g?.kind === "press") {
      if (Math.hypot(e.clientX - g.screen[0], e.clientY - g.screen[1]) < DRAG_THRESHOLD_PX) return;
      if (g.hitId) {
        // Dragging an unselected element selects it first
        const sel = useStore.getState().selection;
        if (!sel.includes(g.hitId)) setSelection(g.shift ? [...sel, g.hitId] : [g.hitId]);
        gesture.current = { kind: "move", start: g.start, offset: [0, 0] };
      } else {
        gesture.current = { kind: "band", start: g.start, end: p };
      }
    }
    const g2 = gesture.current;
    if (g2?.kind === "move") {
      g2.offset = [Math.round(p[0] - g2.start[0]), Math.round(p[1] - g2.start[1])];
      draw();
    } else if (g2?.kind === "band") {
      g2.end = p;
      draw();
    } else if (tool !== "select" && tool !== "label") {
      cursor.current = draft.current.length > 0 || tool !== "dimension" ? snapped(p, e.altKey) : p;
      draw();
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !input) return;
    const sel = useStore.getState().selection;
    if (g.kind === "handle") {
      if (g.drag) void run(g.drag.command, g.drag.params);
      draw();
      return;
    }
    if (g.kind === "press") {
      // Plain click: select the element under the cursor (Shift toggles)
      if (g.hitId) {
        if (g.shift) {
          setSelection(
            sel.includes(g.hitId) ? sel.filter((s) => s !== g.hitId) : [...sel, g.hitId],
          );
        } else {
          setSelection([g.hitId]);
        }
      } else if (!g.shift) {
        setSelection([]);
      }
    } else if (g.kind === "move") {
      const [dx, dy] = g.offset;
      if ((dx !== 0 || dy !== 0) && sel.length > 0) void run("edit_move", { ids: sel, dx, dy });
      draw();
    } else if (g.kind === "band") {
      const ids = elementsInRect(input.home, effectiveLevel, g.start, g.end);
      setSelection(ids);
      draw();
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool === "room" && draft.current.length <= 1) {
      // Double-click without a drawn outline: room of the area enclosed by walls
      void addRoomAt(toWorld(e.clientX, e.clientY));
    } else if (tool === "wall" || tool === "room" || tool === "polyline") {
      // The second click of the double-click added a duplicate point: it is ignored
      void finishDraft();
    } else if (tool === "select" && useStore.getState().selection.length === 0) {
      refit();
    }
  };

  // ---------------------------------------------------------------- keyboard

  /** Ctrl shortcuts of the plan; returns false for keys it does not handle. */
  const onShortcut = (key: string, sel: string[]): boolean => {
    if (!input) return false;
    const selectNew = (r: unknown) => {
      const ids = (r as { ids?: string[] } | undefined)?.ids;
      if (ids) setSelection(ids);
    };
    if (key === "a") {
      setSelection(elementsInRect(input.home, effectiveLevel, [-1e9, -1e9], [1e9, 1e9]));
    } else if (key === "c" && sel.length > 0) {
      void run("edit_copy", { ids: sel });
    } else if (key === "x" && sel.length > 0) {
      void run("edit_copy", { ids: sel }).then((r) => {
        if (r) void run("edit_delete", { ids: sel });
      });
    } else if (key === "v") {
      void run("edit_paste", levelParam()).then(selectNew);
    } else if (key === "d" && sel.length > 0) {
      void run("edit_duplicate", { ids: sel }).then(selectNew);
    } else {
      return false;
    }
    return true;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read current state on each key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      )
        return;
      const state = useStore.getState();
      const sel = state.selection;
      if (e.ctrlKey || e.metaKey) {
        if (!onShortcut(e.key.toLowerCase(), sel)) return;
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (draft.current.length > 0) {
          draft.current = [];
          draw();
        } else if (state.tool !== "select") {
          state.setTool("select");
        } else {
          setSelection([]);
        }
      } else if (
        e.key === "Enter" &&
        (state.tool === "wall" || state.tool === "room" || state.tool === "polyline")
      ) {
        void finishDraft();
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel.length > 0) {
        void run("edit_delete", { ids: sel });
      } else if ((e.key === "r" || e.key === "R") && sel.length > 0 && state.opened) {
        // Rotate the selected furniture by 15° (Shift: other direction)
        const step = e.shiftKey ? -15 : 15;
        forEachPiece(state.opened.home.furniture, (p) => {
          if (p.attrs.id && sel.includes(p.attrs.id)) {
            const angle = ((p.attrs.angle ?? 0) * 180) / Math.PI + step;
            void run("furniture_update", {
              id: p.attrs.id,
              angle_deg: ((angle % 360) + 360) % 360,
            });
          }
        });
      } else if (e.key.startsWith("Arrow") && sel.length > 0) {
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        void run("edit_move", { ids: sel, dx, dy });
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tool, input]);

  // ---------------------------------------------------------------- drag & drop from the catalog

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(CATALOG_DRAG_TYPE) && input) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const onDrop = async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(CATALOG_DRAG_TYPE);
    if (!raw || !input) return;
    e.preventDefault();
    const item = JSON.parse(raw) as CatalogDragData;
    const p = toWorld(e.clientX, e.clientY);
    let result: unknown;
    const wall = item.doorOrWindow ? nearestWall(input.home, effectiveLevel, p, pxToCm(40)) : null;
    if (wall) {
      result = await run("furniture_add_in_wall", {
        catalog_id: item.catalogId,
        name: item.name,
        wall_id: wall.id,
        offset: Math.round(wall.offset),
      });
    } else {
      result = await run("furniture_add", {
        catalog_id: item.catalogId,
        name: item.name,
        x: Math.round(p[0]),
        y: Math.round(p[1]),
        ...levelParam(),
      });
    }
    const id = (result as { id?: string } | undefined)?.id;
    if (id) setSelection([id]);
  };

  return (
    <div className="plan-view">
      <canvas
        ref={canvasRef}
        style={{ cursor: cursorStyle[tool] }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          cursor.current = null;
          draw();
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={onDragOver}
        onDrop={(e) => void onDrop(e)}
      />
      {opened && (
        <button type="button" className="overlay-button" onClick={refit} title="Fit plan to window">
          Fit
        </button>
      )}
    </div>
  );
}
