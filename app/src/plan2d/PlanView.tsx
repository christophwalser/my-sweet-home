// 2D plan view: drawing, zoom/pan, selection and editing tools.
//
// Mouse: left button selects (Shift adds), drags selected elements, the handles
// of a single selected element or a rubber band; right or middle button drags
// pan; wheel zooms.
//
// Drawing (walls, rooms, lines, dimensions): click the points; magnetism snaps
// to points, alignment guides, right angles to the joined wall, multiples of 45°,
// the directions of nearby walls and 5° steps (1° with Shift); Alt disables it. Typing a number sets the length of the current segment (Enter
// confirms). A drawing is finished by clicking its first point (closes it),
// Enter, Escape, a right click or a double-click; Backspace removes the last
// point. Dragging with the wall tool draws a single wall. A double-click inside
// walls with the room tool creates the room of the enclosed area.
//
// Ctrl+C / X / V / D copy, cut, paste and duplicate, Ctrl+A selects everything
// on the level. Every change is a registry command (one undo step), like changes
// from the CLI or MCP.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CATALOG_DRAG_TYPE, type CatalogDragData, docResourceUrl } from "../api";
import { forEachPiece, type Piece, type Pt } from "../model";
import { type Tool, useStore } from "../store";
import {
  drawPlan,
  type PlanColors,
  type PlanInput,
  planBounds,
  type ViewTransform,
} from "./drawPlan";
import {
  dragHandle,
  elementHandles,
  HANDLE_HINT,
  type Handle,
  type HandleDrag,
  handleAt,
} from "./handles";
import { elementsInRect, hitTest, nearestWall } from "./interaction";
import { constrainMove, type Docked, dockToWall, movePreview, selectionJoints } from "./moving";
import { type DraftKind, drawOverlay, type PlanOverlay } from "./overlay";
import { type SnapPurpose, type Snapped, snapContext, snapDraw } from "./snapping";

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
const SNAP_PX = 10;
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
  | { kind: "pan"; last: [number, number]; screen: [number, number]; moved: boolean }
  | { kind: "press"; start: Pt; screen: [number, number]; hitId: string | null; shift: boolean }
  | { kind: "move"; start: Pt; offset: Pt; dock: Docked | null }
  | { kind: "band"; start: Pt; end: Pt }
  | { kind: "handle"; handle: Handle; drag: HandleDrag | null; cursor: Pt }
  /** First point of a drawing pressed: a drag draws a single segment */
  | { kind: "draw"; screen: [number, number]; dragged: boolean };

/** Tools that draw a path of points. */
const PATH_TOOLS: Tool[] = ["wall", "room", "dimension", "polyline"];
const isPathTool = (t: Tool) => PATH_TOOLS.includes(t);

/** Minimum number of points of a finished drawing. */
const MIN_POINTS: Record<DraftKind, number> = { wall: 2, room: 3, polyline: 2, dimension: 2 };

/** Cursor over a handle. */
const HANDLE_CURSOR: Record<Handle["kind"], string> = {
  "wall-start": "move",
  "wall-end": "move",
  "wall-thickness": "ew-resize",
  "wall-arc": "pointer",
  "wall-rotate": "grab",
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

const FINISH = "Enter, Esc, right-click or double-click to finish · Backspace: remove last point";

/** Side lines of the selected walls for the overlay. */
function selectedWallSides(
  input: PlanInput,
  selection: string[],
  highlight: "left" | "right" | null,
): PlanOverlay["wallSides"] {
  const left: Pt[][] = [];
  const right: Pt[][] = [];
  input.home.walls.forEach((w, i) => {
    if (!selection.includes(w.attrs.id)) return;
    left.push(input.wallShapes[i].left);
    right.push(input.wallShapes[i].right);
  });
  return left.length > 0 ? { left, right, highlight } : null;
}

export default function PlanView() {
  const opened = useStore((s) => s.opened);
  const levelId = useStore((s) => s.selectedLevel);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const wallThickness = useStore((s) => s.wallThickness);
  const highlightSide = useStore((s) => s.highlightSide);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [icons, setIcons] = useState(() => new Map<string, HTMLImageElement>());
  const [, setRedraw] = useState(0);
  const [hint, setHint] = useState("");
  const dark = useDarkMode();
  const colors = dark ? DARK : LIGHT;
  const accent = dark ? "#5b8ff0" : "#2f6fde";
  const guideColor = dark ? "#e0a030" : "#d07a00";

  const gesture = useRef<Gesture | null>(null);
  const draft = useRef<Pt[]>([]);
  const cursor = useRef<Pt | null>(null);
  const snapState = useRef<Snapped | null>(null);
  const snapHints = useRef<{ pt: Pt; label: string }[] | null>(null);
  const typed = useRef<string | null>(null);
  const hoverHandle = useRef<Handle | null>(null);

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

  const pxToCm = (px: number) => (px * devicePixelRatio) / viewRef.current.scale;

  const selectedWallCount = () => {
    const sel = useStore.getState().selection;
    return input ? input.home.walls.filter((w) => sel.includes(w.attrs.id)).length : 0;
  };

  /** Explanation of what the next mouse action does, shown below the plan. */
  const hintText = (): string => {
    const g = gesture.current;
    if (g?.kind === "handle") return `${HANDLE_HINT[g.handle.kind]} · Alt: no magnetism`;
    if (g?.kind === "move")
      return "Release to drop · a single wall moves straight, furniture docks to walls · Alt: free";
    const drawing = draft.current.length > 0;
    switch (tool) {
      case "wall":
        return drawing
          ? `Click the next point, or type a length + Enter · click the first point to close · ${FINISH}`
          : "Click the start point, or drag to draw a single wall · Shift: 1° steps · Alt: no magnetism";
      case "room":
        return drawing
          ? `Click the next corner · click the first corner, ${FINISH}`
          : "Double-click inside walls to create the room of that area, or click the first corner";
      case "polyline":
        return drawing
          ? `Click the next point, or type a length + Enter · click the first point to close · ${FINISH}`
          : "Click the first point";
      case "dimension":
        return drawing
          ? "Click the end point, or type a length + Enter · Esc to cancel"
          : "Click the start point, or drag";
      case "label":
        return "Click to place a text";
      default:
        if (hoverHandle.current) return HANDLE_HINT[hoverHandle.current.kind];
        if (selectedWallCount() === 2)
          return "J or Join walls: connect both walls at the intersection of their axes · Shift+click: change the selection";
        return useStore.getState().selection.length > 0
          ? "Drag to move · drag the handles to edit · Del: delete · Ctrl+C/V: copy/paste · Ctrl+D: duplicate"
          : "Click to select, drag for a rubber band · Shift: add to the selection · double-click: fit";
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: hintText and pxToCm read refs only
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    setHint(hintText());
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
    const sel = useStore.getState().selection;
    const snap = drawing ? snapState.current : null;
    const handleDrag = g?.kind === "handle" && g.drag ? { drag: g.drag, cursor: g.cursor } : null;
    const overlay: PlanOverlay = {
      selection: sel,
      dragOffset: g?.kind === "move" ? g.offset : null,
      dragGhost: g?.kind === "move" && g.dock ? g.dock.outline : null,
      movePreview:
        g?.kind === "move" && !g.dock
          ? movePreview(input.home, input.wallShapes, sel, g.offset[0], g.offset[1])
          : null,
      selectionJoints: tool === "select" ? selectionJoints(input.home, sel) : [],
      wallSides: tool === "select" ? selectedWallSides(input, sel, highlightSide) : null,
      draft:
        drawing && points.length > 0
          ? { points, kind: tool as DraftKind, thickness: wallThickness }
          : null,
      guides: handleDrag?.drag.guides ?? snap?.guides ?? [],
      note: snap?.note ?? null,
      noteAt: snap?.pt ?? null,
      hints: drawing ? (snapHints.current ?? []) : [],
      typedLength: drawing ? typed.current : null,
      handles:
        tool === "select" && sel.length === 1 ? elementHandles(input.home, sel[0], pxToCm(1)) : [],
      handleDrag,
      rubberBand: g?.kind === "band" ? [g.start, g.end] : null,
      snap: snap?.marker ?? null,
      accent,
      guide: guideColor,
    };
    drawOverlay(ctx, viewRef.current, input.home, input.wallShapes, overlay);
  }, [input, colors, tool, accent, guideColor, wallThickness, highlightSide]);

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

  // Fit when another home is opened or the level changes. Edits in the plan stop
  // the automatic fitting, so the plan does not jump while the user works.
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
    snapState.current = null;
    typed.current = null;
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

  const levelParam = () => (effectiveLevel ? { level: effectiveLevel } : {});

  /** Cursor point for drawing tools, with magnetism unless Alt is pressed. */
  const snapped = (p: Pt, altKey: boolean, shiftKey = false): Pt => {
    if (!input || altKey || !isPathTool(tool)) {
      snapState.current = null;
      snapHints.current = null;
      return p;
    }
    const path = draft.current;
    const previous = path.length > 0 ? path[path.length - 1] : null;
    const ctx = snapContext(
      tool as SnapPurpose,
      input.home,
      input.wallShapes,
      effectiveLevel,
      pxToCm(SNAP_PX),
      {
        path,
        near: p,
        thickness: wallThickness,
        anchor: previous ?? undefined,
        fine: shiftKey,
      },
    );
    const s = snapDraw(p, previous, ctx);
    snapState.current = s;
    snapHints.current = ctx.hints ?? null;
    return s.pt;
  };

  // ---------------------------------------------------------------- commands

  const { run, setSelection } = useStore.getState();

  const resetDraft = () => {
    draft.current = [];
    cursor.current = null;
    snapState.current = null;
    typed.current = null;
  };

  /** Finishes the drawing: keeps it if it has enough points, otherwise discards it. */
  const finishDraft = async () => {
    const pts = draft.current;
    resetDraft();
    draw();
    if (!isPathTool(tool) || pts.length < MIN_POINTS[tool as DraftKind]) return;
    userMoved.current = true;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed = pts.length >= 4 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1;
    const points = closed ? pts.slice(0, -1) : pts;
    let result: unknown;
    if (tool === "wall") {
      result = await run("wall_add_path", {
        points,
        closed,
        thickness: wallThickness,
        ...levelParam(),
      });
    } else if (tool === "room") {
      result = await run("room_add", { points, ...levelParam() });
    } else if (tool === "polyline") {
      result = await run("polyline_add", { points, closed, ...levelParam() });
    } else if (tool === "dimension") {
      result = await run("dimension_add", {
        x_start: first[0],
        y_start: first[1],
        x_end: last[0],
        y_end: last[1],
        ...levelParam(),
      });
    }
    const r = result as { id?: string; ids?: string[] } | undefined;
    if (r?.ids) setSelection(r.ids);
    else if (r?.id) setSelection([r.id]);
  };

  /** Room of the area enclosed by walls around `p` (double-click with the room tool). */
  const addRoomAt = async (p: Pt) => {
    resetDraft();
    draw();
    userMoved.current = true;
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
    typed.current = null;
    // Clicking the first point again closes walls and lines and finishes rooms
    const first = pts[0];
    if (first && pts.length >= 2 && Math.hypot(first[0] - p[0], first[1] - p[1]) < 0.5) {
      if (tool === "room") {
        await finishDraft();
        return;
      }
      if ((tool === "wall" || tool === "polyline") && pts.length >= 3) {
        pts.push(p);
        await finishDraft();
        return;
      }
    }
    pts.push(p);
    if (tool === "dimension" && pts.length === 2) {
      await finishDraft();
      return;
    }
    draw();
  };

  /** Adds the point at the typed length in the direction of the cursor. */
  const addTypedPoint = () => {
    const pts = draft.current;
    const length = Number.parseFloat((typed.current ?? "").replace(",", "."));
    typed.current = null;
    if (pts.length === 0 || !Number.isFinite(length) || length <= 0) {
      draw();
      return;
    }
    const last = pts[pts.length - 1];
    const c = cursor.current ?? [last[0] + 1, last[1]];
    const len = Math.hypot(c[0] - last[0], c[1] - last[1]);
    const dir: Pt = len > 1e-6 ? [(c[0] - last[0]) / len, (c[1] - last[1]) / len] : [1, 0];
    const round = (v: number) => Math.round(v * 100) / 100;
    void addDraftPoint([round(last[0] + dir[0] * length), round(last[1] + dir[1] * length)]);
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

  const handleUnder = (p: Pt): Handle | null => {
    const sel = useStore.getState().selection;
    if (!input || tool !== "select" || sel.length !== 1) return null;
    return handleAt(elementHandles(input.home, sel[0], pxToCm(1)), p, pxToCm(PICK_PX + 2));
  };

  const findPiece = (id: string): Piece | null => {
    let found: Piece | null = null;
    if (input) {
      forEachPiece(input.home.furniture, (p) => {
        if (p.attrs.id === id) found = p;
      });
    }
    return found;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      gesture.current = {
        kind: "pan",
        last: [e.clientX, e.clientY],
        screen: [e.clientX, e.clientY],
        moved: false,
      };
      return;
    }
    if (e.button !== 0 || !input) return;
    const p = toWorld(e.clientX, e.clientY);
    if (tool === "select") {
      const handle = handleUnder(p);
      if (handle) {
        userMoved.current = true;
        gesture.current = { kind: "handle", handle, drag: null, cursor: p };
        draw();
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
      const s = snapped(p, e.altKey, e.shiftKey);
      if (draft.current.length === 0) {
        gesture.current = { kind: "draw", screen: [e.clientX, e.clientY], dragged: false };
      }
      void addDraftPoint(s);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g?.kind === "pan") {
      if (Math.hypot(e.clientX - g.screen[0], e.clientY - g.screen[1]) >= DRAG_THRESHOLD_PX) {
        g.moved = true;
        userMoved.current = true;
      }
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
        e.shiftKey,
      );
      draw();
      return;
    }
    if (g?.kind === "draw" && !g.dragged) {
      if (Math.hypot(e.clientX - g.screen[0], e.clientY - g.screen[1]) >= DRAG_THRESHOLD_PX * 2) {
        g.dragged = true;
      }
    }
    if (!g && tool === "select" && input && canvasRef.current) {
      // Cursor feedback and hint over the handles of the selected element
      const handle = handleUnder(p);
      if (
        handle?.kind !== hoverHandle.current?.kind ||
        handle?.index !== hoverHandle.current?.index
      ) {
        hoverHandle.current = handle;
        setHint(hintText());
      }
      canvasRef.current.style.cursor = handle ? HANDLE_CURSOR[handle.kind] : cursorStyle.select;
    }
    if (g?.kind === "press") {
      if (Math.hypot(e.clientX - g.screen[0], e.clientY - g.screen[1]) < DRAG_THRESHOLD_PX) return;
      userMoved.current = true;
      if (g.hitId) {
        // Dragging an unselected element selects it first
        const sel = useStore.getState().selection;
        if (!sel.includes(g.hitId)) setSelection(g.shift ? [...sel, g.hitId] : [g.hitId]);
        gesture.current = { kind: "move", start: g.start, offset: [0, 0], dock: null };
      } else {
        gesture.current = { kind: "band", start: g.start, end: p };
      }
    }
    const g2 = gesture.current;
    if (g2?.kind === "move" && input) {
      const sel = useStore.getState().selection;
      let offset: Pt = [Math.round(p[0] - g2.start[0]), Math.round(p[1] - g2.start[1])];
      g2.dock = null;
      if (!e.altKey) {
        offset = constrainMove(input.home, sel, offset);
        const piece = sel.length === 1 ? findPiece(sel[0]) : null;
        if (piece) {
          g2.dock = dockToWall(
            input.home,
            input.wallShapes,
            effectiveLevel,
            piece,
            [piece.attrs.x + offset[0], piece.attrs.y + offset[1]],
            pxToCm(SNAP_PX),
          );
        }
      }
      g2.offset = offset;
      draw();
    } else if (g2?.kind === "band") {
      g2.end = p;
      draw();
    } else if (isPathTool(tool)) {
      // Before the first click the snap marker and guides already show where it lands
      const s = snapped(p, e.altKey, e.shiftKey);
      cursor.current = draft.current.length > 0 ? s : null;
      draw();
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !input) return;
    const sel = useStore.getState().selection;
    if (g.kind === "pan") {
      // A right click without dragging finishes the drawing (or leaves the tool)
      if (!g.moved) {
        if (isPathTool(tool) && draft.current.length > 0) void finishDraft();
        else if (tool !== "select") useStore.getState().setTool("select");
      }
      return;
    }
    if (g.kind === "draw") {
      // Press, drag, release: a single wall, line or dimension
      if (g.dragged && tool !== "room" && draft.current.length === 1 && cursor.current) {
        const end = cursor.current;
        void addDraftPoint(end).then(() => {
          if (tool !== "dimension") void finishDraft();
        });
      }
      return;
    }
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
      if (g.dock && sel.length === 1) {
        void run("furniture_update", {
          id: sel[0],
          x: g.dock.x,
          y: g.dock.y,
          angle_deg: g.dock.angleDeg,
        });
      } else if ((dx !== 0 || dy !== 0) && sel.length > 0) {
        void run("edit_move", { ids: sel, dx, dy });
      }
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
    } else if (isPathTool(tool)) {
      // The second click of the double-click added no point (same position)
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

  /** Keys while drawing; returns false for keys it does not handle. */
  const onDrawingKey = (e: KeyboardEvent): boolean => {
    const drawing = draft.current.length > 0;
    if (drawing && /^[0-9]$/.test(e.key)) {
      typed.current = (typed.current ?? "") + e.key;
    } else if (drawing && (e.key === "." || e.key === ",") && !typed.current?.includes(".")) {
      typed.current = `${typed.current ?? "0"}.`;
    } else if (e.key === "Backspace" && typed.current !== null) {
      typed.current = typed.current.length > 1 ? typed.current.slice(0, -1) : null;
    } else if (e.key === "Backspace" && drawing) {
      draft.current.pop();
      if (draft.current.length === 0) cursor.current = null;
    } else if (e.key === "Enter" && typed.current !== null) {
      addTypedPoint();
      return true;
    } else if (e.key === "Enter" && drawing) {
      void finishDraft();
      return true;
    } else if (e.key === "Escape" && typed.current !== null) {
      typed.current = null;
    } else if (e.key === "Escape" && drawing) {
      // Escape keeps what was drawn (if it is complete), like Enter
      void finishDraft();
      return true;
    } else {
      return false;
    }
    draw();
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
      if (isPathTool(state.tool) && onDrawingKey(e)) {
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (state.tool !== "select") state.setTool("select");
        else setSelection([]);
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
      } else if ((e.key === "j" || e.key === "J") && state.opened) {
        // Join the two selected walls
        const walls = state.opened.home.walls.filter((w) => sel.includes(w.attrs.id));
        if (walls.length !== 2) return;
        void run("wall_join", { ids: walls.map((w) => w.attrs.id) });
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
  }, [tool, input, wallThickness]);

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
      {opened && hint && <div className="plan-hint">{hint}</div>}
      {opened && (
        <button type="button" className="overlay-button" onClick={refit} title="Fit plan to window">
          Fit
        </button>
      )}
    </div>
  );
}
