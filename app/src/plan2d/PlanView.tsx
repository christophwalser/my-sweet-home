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
import {
  CATALOG_DRAG_TYPE,
  type CatalogDragData,
  currentCatalogDrag,
  docResourceUrl,
  TEXTURE_DRAG_TYPE,
  type TextureDragData,
} from "../api";
import { useCatalogPrefs } from "../catalog/catalogPrefs";
import { evalLength } from "../expression";
import { t } from "../i18n";
import { forEachPiece, type Home, type Piece, type Pt } from "../model";
import { perfMark } from "../perfMarks";
import {
  magnetismActive,
  newLabelParams,
  newRoomParams,
  newWallParams,
  prefs,
  usePreferences,
} from "../preferences";
import { currentVisitor, setVisitor, type Tool, useStore, VISITOR_ID } from "../store";
import { rotateSelection } from "../ui/commands";
import Icon from "../ui/Icon";
import { keyTarget, modalOpen } from "../ui/keyTarget";
import { commandItem } from "../ui/menuItems";
import { registerPlanActions } from "../ui/planBridge";
import { useDarkMode, useUi } from "../ui/uiStore";
import { formatFieldValue, toUnit, unitSymbol } from "../units";
import { levelOfEye } from "../view3d/visitor";
import { autoDimensions } from "./autoDims";
import ContextMenu, { type MenuItem } from "./ContextMenu";
import { type CursorInput, inputKey, inputPoint, inputText } from "./cursorInput";
import { existingDimensions, existingHeightDimension } from "./dimensionMatch";
import {
  drawPlan,
  type PlanColors,
  type PlanInput,
  planBounds,
  type ViewTransform,
} from "./drawPlan";
import { type Dock, type DropPreview, dropPreview } from "./dropPreview";
import { gridAnchor, gridOffset, setPlanScale, snapGridStep } from "./gridSnap";
import { drawGuides, guideAt, guidesInRect, levelGuides, movedGuides } from "./guides";
import {
  dragHandle,
  elementHandles,
  HANDLE_HINT,
  type Handle,
  type HandleDrag,
  handleAt,
} from "./handles";
import {
  distanceToSegment,
  elementOutlines,
  elementsInRect,
  hitTest,
  hitTestAll,
  nearestWall,
  similarElements,
} from "./interaction";
import {
  type Box,
  type Distance,
  type Gap,
  type MoveSnap,
  type MoveTargets,
  moveTargets,
  pieceDistances,
  selectionBox,
  snapMove,
} from "./moveSnap";
import { dragStep, lockAxis, moveAxis, nudgeStep, roundTo } from "./moveStep";
import {
  constrainMove,
  type Docked,
  dockToWall,
  movePreview,
  type Slid,
  type SlideState,
  selectionJoints,
  slideInWall,
} from "./moving";
import { type NudgeQueue, newNudgeQueue, nudgeDone, queueNudge } from "./nudge";
import {
  type DraftKind,
  drawOverlay,
  type PlanOverlay,
  VISITOR_PICK_RADIUS,
  visitorHandlePos,
} from "./overlay";
import { edgeOffset } from "./roomEdit";
import { drawRuler, type RulerColors } from "./rulers";
import { usePointer } from "./StatusBar";
import { sectionCut } from "./section";
import {
  projectOnSegment,
  type SnapPurpose,
  type Snapped,
  sideAxis,
  snapAngleDeg,
  snapContext,
  snapDraw,
} from "./snapping";
import { dropElevation } from "./support";
import { type SurfaceTarget, surfaceAt } from "./surfaces";
import TextEditor, { type TextEdit } from "./TextEditor";
import { topView } from "./topView";

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
  section: "#0f766e",
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
  section: "#5eead4",
};

const LIGHT_RULER: RulerColors = {
  background: "#f4f5f7",
  text: "#4b5058",
  tick: "#9aa0a8",
  marker: "#2f6fde",
};

const DARK_RULER: RulerColors = {
  background: "#23262b",
  text: "#aab0b8",
  tick: "#5d636b",
  marker: "#5b8ff0",
};

/** Pick and snap radius in screen pixels. */
const PICK_PX = 6;
/** Radius of the magnetism in screen pixels (preference). */
const snapPx = () => usePreferences.getState().snapRadius;
/** Pointer movement in screen pixels before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 4;

type Gesture =
  | { kind: "pan"; last: [number, number]; screen: [number, number]; moved: boolean }
  | {
      kind: "press";
      start: Pt;
      screen: [number, number];
      hitId: string | null;
      /** Shift or Ctrl held: the click toggles the element, a rubber band adds to the selection */
      extend: boolean;
    }
  | {
      kind: "move";
      start: Pt;
      offset: Pt;
      dock: Docked | null;
      slide: Slid | null;
      /** Wall and side a door or window slid in at the last step of the drag */
      held?: SlideState | null;
      /** Point of the selection the grid catches (see `gridAnchor`), found at the first step */
      anchor?: Pt | null;
      /** Smart guides: what the selection snapped to */
      snap?: MoveSnap | null;
      /** Distances of a single moved piece to its neighbors */
      distances?: Gap[];
      /** Targets and box of the selection, collected when the drag starts */
      targets?: MoveTargets;
      box?: Box | null;
    }
  | { kind: "band"; start: Pt; end: Pt; extend: boolean }
  | { kind: "handle"; handle: Handle; drag: HandleDrag | null; cursor: Pt }
  /** The handle in front of the visitor is dragged: its new direction */
  | { kind: "visitor-rotate"; yaw: number }
  /** First point of a drawing pressed: a drag draws a single segment */
  | { kind: "draw"; screen: [number, number]; dragged: boolean };

/** Tools that draw a path of points. */
const PATH_TOOLS: Tool[] = ["wall", "arcwall", "room", "dimension", "polyline"];
const isPathTool = (t: Tool) => PATH_TOOLS.includes(t);
/** Kind of drawing of a path tool: round walls are drawn like walls. */
const draftKind = (t: Tool): DraftKind => (t === "arcwall" ? "wall" : (t as DraftKind));
/** Tools whose clicks snap to the plan: drawing tools and the measuring tool. */
const isSnapTool = (t: Tool) => isPathTool(t) || t === "measure" || t === "ruler";

/** Real depth of a piece from its catalog item, if that is loaded. */
function catalogDepth(piece: Piece): number | undefined {
  const id = piece.attrs.catalog_id;
  if (!id) return undefined;
  return useStore.getState().catalog?.items.find((i) => i.kind === "furniture" && i.id === id)
    ?.depth;
}

/** Minimum number of points of a finished drawing. */
const MIN_POINTS: Record<DraftKind, number> = { wall: 2, room: 3, polyline: 2, dimension: 2 };

/** An SVG cursor (24 x 24, hot spot in the middle) with a white outline for any background. */
function svgCursor(paths: string, fallback: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="#ffffff" stroke-width="4">${paths}</g><g stroke="#1c2026" stroke-width="1.8">${paths}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, ${fallback}`;
}

const ROTATE_CURSOR = svgCursor(
  '<path d="M6.5 8.5 A7 7 0 1 1 5.5 15"/><path d="M3.5 6 L6.5 8.5 L9 5.5"/>',
  "grab",
);
const ELEVATION_CURSOR = svgCursor(
  '<path d="M5 19 H19"/><path d="M12 16 V4"/><path d="M8.5 7.5 L12 4 L15.5 7.5"/>',
  "ns-resize",
);
const HEIGHT_CURSOR = svgCursor(
  '<path d="M7 3 H17"/><path d="M7 21 H17"/><path d="M12 6 V18"/><path d="M9 9 L12 6 L15 9"/><path d="M9 15 L12 18 L15 15"/>',
  "ns-resize",
);
const ARC_CURSOR = svgCursor('<path d="M4 16 Q12 4 20 16"/><path d="M12 13 V7"/>', "pointer");

/** Resize cursor for a direction in the plan (radians, y down). */
function resizeCursor(angle: number): string {
  const deg = ((((angle * 180) / Math.PI) % 180) + 180) % 180;
  if (deg < 22.5 || deg >= 157.5) return "ew-resize";
  if (deg < 67.5) return "nwse-resize";
  if (deg < 112.5) return "ns-resize";
  return "nesw-resize";
}

/** Cursor over a handle (resize directions follow the element's rotation). */
function handleCursor(home: Home, h: Handle): string {
  switch (h.kind) {
    case "wall-rotate":
    case "piece-rotate":
    case "compass-rotate":
      return ROTATE_CURSOR;
    case "compass-resize":
    case "piece-elevation":
      return ELEVATION_CURSOR;
    case "piece-height":
      return HEIGHT_CURSOR;
    case "wall-arc":
      return ARC_CURSOR;
    case "piece-resize":
      return h.anchor
        ? resizeCursor(Math.atan2(h.pos[1] - h.anchor[1], h.pos[0] - h.anchor[0]))
        : "nwse-resize";
    case "wall-thickness": {
      const w = home.walls.find((x) => x.attrs.id === h.id);
      if (!w) return "ew-resize";
      const a = w.attrs;
      // Across the wall
      return resizeCursor(Math.atan2(a.y_end - a.y_start, a.x_end - a.x_start) + Math.PI / 2);
    }
    case "room-name":
    case "room-area":
      return "grab";
    default:
      return "move";
  }
}

const cursorStyle: Record<Tool, string> = {
  select: "default",
  pan: "grab",
  wall: "crosshair",
  arcwall: "crosshair",
  roomauto: "cell",
  heightdim: "crosshair",
  room: "crosshair",
  polyline: "crosshair",
  dimension: "crosshair",
  label: "text",
  measure: "crosshair",
  ruler: "crosshair",
};

const FINISH = t(
  "Enter, right-click or double-click to finish · Esc: discard · Backspace: remove last point",
);

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
  /** Space is held: the left button pans */
  const spaceHeld = useRef(false);
  const wallLine = useStore((s) => s.wallLine);
  const arcExtent = useStore((s) => s.arcExtent);
  const highlightSide = useStore((s) => s.highlightSide);
  const fitRequest = useStore((s) => s.fitRequest);
  const viewMode = useStore((s) => s.viewMode);
  const visitorPose = useStore((s) => s.visitorPose);
  const cameraPathShown = useStore((s) => s.cameraPathShown);
  /** A fit was requested; repeated once the images of the home have loaded */
  const pendingFit = useRef(false);
  const showRulers = usePreferences((s) => s.rulers);
  const showGrid = usePreferences((s) => s.grid);
  const gridSpacing = usePreferences((s) => s.gridSpacing);
  const backgroundOpacity = usePreferences((s) => s.backgroundOpacity);
  const lengthDecimals = usePreferences((s) => s.lengthDecimals);
  const unit = usePreferences((s) => s.unit);
  const roomRendering = usePreferences((s) => s.roomRendering);
  const underlay = usePreferences((s) => s.underlay);
  const leftSideColor = usePreferences((s) => s.leftSideColor);
  const rightSideColor = usePreferences((s) => s.rightSideColor);
  const magnetism = usePreferences((s) => s.magnetism);
  const furnitureTopView = usePreferences((s) => s.furnitureTopView);
  const rulerColorPref = usePreferences((s) => s.rulerColor);
  const rulerDashStyle = usePreferences((s) => s.rulerDashStyle);
  const measureColorPref = usePreferences((s) => s.measureColor);
  /** Redraw once per frame when top views of furniture become ready */
  const redrawFrame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRulerRef = useRef<HTMLCanvasElement>(null);
  const leftRulerRef = useRef<HTMLCanvasElement>(null);
  /** World position of the mouse over the plan (for the ruler marks) */
  const mouseWorld = useRef<Pt | null>(null);
  /** Distance measured with the measuring tool; `b` follows the mouse until `done` */
  const measure = useRef<{ a: Pt; b: Pt | null; done: boolean } | null>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [icons, setIcons] = useState(() => new Map<string, HTMLImageElement>());
  const [, setRedraw] = useState(0);
  const [hint, setHint] = useState("");
  /** Open context menu: position in CSS pixels in the plan area and its items */
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  /** Text typed in the plan */
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  /** Catalog piece dragged over the plan */
  const drop = useRef<{ preview: DropPreview; icon: HTMLImageElement | null } | null>(null);
  /** Surface under a dragged texture or under the pipette */
  const surfaceHover = useRef<SurfaceTarget | null>(null);
  /** A click awaited in the plan: the pipette, or a catalog piece being placed */
  const pick = useUi((s) => s.pick);
  const placing = useUi((s) => s.placing);
  /** Points awaited in the plan (e.g. to align a reference object) and the pointer for them */
  const pointPick = useUi((s) => s.pointPick);
  const pickCursor = useRef<Pt | null>(null);
  const dark = useDarkMode();
  const colors = dark ? DARK : LIGHT;
  const rulerColors = dark ? DARK_RULER : LIGHT_RULER;
  const accent = dark ? "#5b8ff0" : "#2f6fde";
  const guideColor = dark ? "#e0a030" : "#d07a00";
  /** Color of the ruler guides (not the orange of the snap guides) */
  const rulerColor = rulerColorPref || (dark ? "#e879c6" : "#b0267e");
  /** Color of the measuring tool (by default the one of the snap guides) */
  const measureColor = measureColorPref || guideColor;

  const gesture = useRef<Gesture | null>(null);
  // A finished move or handle drag whose command is still running: the plan keeps showing it
  // until the changed home arrives, so that nothing jumps back to its old place in between
  const settling = useRef<{ gesture: Gesture; home: Home } | null>(null);
  const draft = useRef<Pt[]>([]);
  const cursor = useRef<Pt | null>(null);
  const snapState = useRef<Snapped | null>(null);
  const snapHints = useRef<{ pt: Pt; label: string }[] | null>(null);
  /**
   * "Ruler at a distance": the line (axis of a wall or a ruler) the new ruler runs parallel
   * to, half the wall thickness (the distance counts from the face) and the current offset
   * along the left normal of the line.
   */
  const offsetFrom = useRef<{ a: Pt; b: Pt; half: number; offset: number } | null>(null);
  /** Focuses a field opened by a click once the click is over, with its text selected. */
  const focusField = useCallback((el: HTMLInputElement | null) => {
    if (el)
      requestAnimationFrame(() => {
        el.focus();
        el.select();
      });
  }, []);
  /**
   * The plan takes typed values (a drawing, a measure, "Ruler at a distance" or a value being
   * typed): digits and letters are input then, not shortcuts.
   */
  const takesTypedInput = () =>
    draft.current.length > 0 ||
    (measure.current !== null && !measure.current.done) ||
    offsetFrom.current !== null ||
    typed.current !== null;
  /** Distance of the selected piece being typed (clicked on its label) */
  const [distanceEdit, setDistanceEdit] = useState<{ id: string; d: Distance } | null>(null);
  /** Distances of the selected piece to its neighbors, kept while home and selection stay */
  const distanceCache = useRef<{ home: unknown; id: string; value: Distance[] } | null>(null);
  /** Length, angle or point typed at the cursor while drawing or measuring */
  const typed = useRef<CursorInput | null>(null);
  /** Dimension tool: offset of the dimension line while it is placed (after two points) */
  const dimOffset = useRef<number | null>(null);
  const hoverHandle = useRef<Handle | null>(null);

  const input: PlanInput | null = useMemo(() => {
    if (!opened) return null;
    const redraw = () => {
      if (!redrawFrame.current) {
        redrawFrame.current = requestAnimationFrame(() => {
          redrawFrame.current = 0;
          drawRef.current();
        });
      }
    };
    return {
      home: opened.home,
      wallShapes: opened.wallShapes,
      levelId: opened.home.levels.length ? levelId : null,
      icons,
      topView: furnitureTopView ? (p) => topView(p, opened.id, redraw) : undefined,
      section: (p, height) => sectionCut(p, opened.id, height, redraw),
    };
  }, [opened, levelId, icons, furnitureTopView]);
  const effectiveLevel = input?.levelId ?? null;

  // Load furniture icons and floor textures of the home. Images loaded for an earlier state of
  // the same home are kept: reloading them after every change drew the floors grey until
  // they arrived again (e.g. while moving furniture with the arrow keys).
  const imageCache = useRef<{ doc: number | null; images: Map<string, HTMLImageElement> }>({
    doc: null,
    images: new Map(),
  });
  useEffect(() => {
    if (!opened) return;
    const cache = imageCache.current;
    if (cache.doc !== opened.id) {
      cache.doc = opened.id;
      cache.images = new Map();
    }
    const map = new Map<string, HTMLImageElement>();
    let pending = 0;
    const load = (key: string) => {
      if (map.has(key)) return;
      const known = cache.images.get(key);
      if (known) {
        map.set(key, known);
        return;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      pending++;
      img.onload = img.onerror = () => {
        pending--;
        if (pending === 0) {
          setRedraw((n) => n + 1);
          if (pendingFit.current) {
            pendingFit.current = false;
            setTimeout(() => refitRef.current(), 0);
          }
        }
      };
      img.src = docResourceUrl(opened.id, key);
      map.set(key, img);
      cache.images.set(key, img);
    };
    forEachPiece(opened.home.furniture, (p) => {
      const key = p.attrs.plan_icon ?? p.attrs.icon;
      if (key) load(key);
    });
    for (const room of opened.home.rooms) {
      const key = room.textures?.find((t) => t.role === "floorTexture")?.image;
      if (key) load(key);
    }
    // Background images of the home and its levels
    for (const b of [
      opened.home.background_image,
      ...opened.home.levels.map((l) => l.background_image),
    ]) {
      if (b) load(b.image);
    }
    // The same images as before: keep the map, so the plan input does not change for it
    setIcons((prev) =>
      prev.size === map.size && [...map].every(([k, v]) => prev.get(k) === v) ? prev : map,
    );
  }, [opened]);

  const pxToCm = (px: number) => (px * devicePixelRatio) / viewRef.current.scale;

  const selectedWallCount = () => {
    const sel = useStore.getState().selection;
    return input ? input.home.walls.filter((w) => sel.includes(w.attrs.id)).length : 0;
  };

  /** Explanation of what the next mouse action does, shown below the plan. */
  const hintText = (): string => {
    const g = gesture.current;
    const alt = magnetism ? t("Alt: no magnetism") : t("Alt: magnetism (off in the preferences)");
    if (g?.kind === "handle") return `${HANDLE_HINT[g.handle.kind]} · ${alt}`;
    if (g?.kind === "visitor-rotate")
      return t("Drag to turn the visitor · Shift: 1° steps · {alt}", { alt });
    const selected = useStore.getState().selection;
    if (!g && tool === "select" && selected.length === 1 && selected[0] === VISITOR_ID) {
      return t(
        "Drag to move the visitor, the handle in front of it to turn it · arrow keys: move · R: turn by 15°",
      );
    }
    if (g?.kind === "move")
      return magnetism
        ? t("Release to drop · a single wall moves straight, furniture docks to walls · Alt: free")
        : t("Release to drop · Alt: magnetism");
    const drawing = draft.current.length > 0;
    switch (tool) {
      case "measure": {
        const m = measure.current;
        if (m && !m.done)
          return t(
            "Click the end point, or type a length (Tab: angle) + Enter · Shift: 1° steps · {alt}",
            { alt },
          );
        if (m?.done) return t("Click to measure again · Esc: clear · nothing is added to the plan");
        return t("Click the start point, or drag · {alt}", { alt });
      }
      case "ruler": {
        const m = measure.current;
        if (m && !m.done)
          return t(
            "Click the end point of the guide line, or type a length (Tab: angle) + Enter · Shift: 1° steps · {alt}",
            { alt },
          );
        return t(
          "Click the start point of a guide line, or drag · it stays in the plan; select it and press Del to remove it · {alt}",
          { alt },
        );
      }
      case "wall":
        return drawing
          ? t(
              "Click the next point, or type a length (Tab: angle) + Enter · click the first point to close · {FINISH}",
              { FINISH },
            )
          : t("Click the start point, or drag to draw a single wall · Shift: 1° steps · {alt}", {
              alt,
            });
      case "arcwall":
        return drawing
          ? t(
              "Click the next point · each wall becomes a {ARC_WALL_EXTENT_DEG}° arc, changeable in its properties · {FINISH}",
              { ARC_WALL_EXTENT_DEG: arcExtent, FINISH },
            )
          : t("Click the start point of the round wall · Shift: 1° steps · {alt}", { alt });
      case "pan":
        return t("Drag to move the plan · wheel: zoom");
      case "roomauto":
        return t("Click inside walls to create the room of that area");
      case "heightdim":
        return t("Click where the height dimension goes; it measures the height of the level");
      case "room":
        return drawing
          ? t("Click the next corner · click the first corner, {FINISH}", { FINISH })
          : t(
              "Double-click inside walls to create the room of that area, or click the first corner",
            );
      case "polyline":
        return drawing
          ? t(
              "Click the next point, or type a length (Tab: angle) + Enter · click the first point to close · {FINISH}",
              { FINISH },
            )
          : t("Click the first point");
      case "dimension":
        if (dimOffset.current !== null)
          return t(
            "Move the mouse to place the dimension line, click to finish · or type its distance + Enter · Esc to cancel",
          );
        return drawing
          ? t("Click the end point, or type a length (Tab: angle) + Enter · Esc to cancel")
          : t("Click the start point, or drag");
      case "label":
        return t(
          "Click where the text goes and type it · Enter: finish · Shift+Enter: new line · Esc: cancel",
        );
      default:
        if (hoverHandle.current) return HANDLE_HINT[hoverHandle.current.kind];
        if (selectedWallCount() >= 2)
          return t(
            "J or Join walls: connect the walls at the intersections of their axes · Shift+click: change the selection",
          );
        return useStore.getState().selection.length > 0
          ? t(
              "Drag to move · drag the handles to edit · click a distance to type it · Del: delete · Ctrl+C/V: copy/paste · Ctrl+D: duplicate",
            )
          : t(
              "Click to select, drag for a rubber band (to the left: also what it touches) · Shift+click: add to the selection · Tab: next element under the mouse",
            );
    }
  };

  /** Rulers along the plan; also redrawn on every mouse move for the position mark. */
  const drawRulers = useCallback(() => {
    const mouse = mouseWorld.current;
    if (topRulerRef.current)
      drawRuler(topRulerRef.current, true, viewRef.current, mouse?.[0] ?? null, rulerColors);
    if (leftRulerRef.current)
      drawRuler(leftRulerRef.current, false, viewRef.current, mouse?.[1] ?? null, rulerColors);
  }, [rulerColors]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: hintText and pxToCm read refs only
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Nothing can be drawn at a scale that is no positive number (canvas calls would throw)
    if (!(viewRef.current.scale > 0)) return;
    setHint(hintText());
    if (!input) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = colors.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    drawPlan(ctx, canvas.width, canvas.height, viewRef.current, input, colors, {
      grid: showGrid,
      gridSpacing,
      backgroundOpacity: backgroundOpacity / 100,
    });
    // The status bar names the zoom and the distance of the grid lines
    const shownScale = viewRef.current.scale;
    // The grid that catches is the one that is drawn
    setPlanScale(shownScale);
    if (usePointer.getState().scale !== shownScale) {
      queueMicrotask(() => usePointer.setState({ scale: shownScale }));
    }
    if (settling.current && settling.current.home !== input.home) settling.current = null;
    const g = gesture.current ?? settling.current?.gesture ?? null;
    const drawing = isPathTool(tool);
    // A complete typed input shows where the next point lands
    const typedAt = typedPoint();
    const points =
      cursor.current && drawing ? [...draft.current, typedAt ?? cursor.current] : draft.current;
    const sel = useStore.getState().selection;
    const picking = useUi.getState().pointPick;
    const snap = isSnapTool(tool) || picking ? snapState.current : null;
    const m = tool === "measure" ? measure.current : null;
    // A ruler being drawn shows like a guide, without its length
    const rulerDraft = tool === "ruler" ? measure.current : null;
    const measureEnd = (mm: { a: Pt; b: Pt | null }) => typedAt ?? mm.b ?? mm.a;
    const parallel = offsetFrom.current ? offsetGuide(offsetFrom.current) : null;
    const handleDrag = g?.kind === "handle" && g.drag ? { drag: g.drag, cursor: g.cursor } : null;
    const overlay: PlanOverlay = {
      selection: sel,
      dragOffset: g?.kind === "move" ? g.offset : null,
      dragGhost:
        g?.kind === "move" && (g.dock || g.slide) ? ((g.dock ?? g.slide)?.outline ?? null) : null,
      movePreview:
        g?.kind === "move" && !g.dock && !g.slide
          ? movePreview(input.home, input.wallShapes, sel, g.offset[0], g.offset[1])
          : null,
      gaps:
        g?.kind === "move"
          ? g.slide
            ? g.slide.gaps
            : [...(g.snap?.gaps ?? []), ...(g.distances ?? [])]
          : !g
            ? selectedDistances().map((d): Gap => [d.a, d.b])
            : [],
      // Size of the selected wall or piece while nothing is dragged
      autoDims:
        tool === "select" && sel.length === 1 && !g
          ? autoDimensions(input.home, input.wallShapes, sel[0])
          : [],
      dimensionDraft:
        tool === "dimension" && dimOffset.current !== null && draft.current.length === 2
          ? { start: draft.current[0], end: draft.current[1], offset: dimOffset.current }
          : null,
      selectionJoints: tool === "select" ? selectionJoints(input.home, sel) : [],
      wallSides: tool === "select" ? selectedWallSides(input, sel, highlightSide) : null,
      // A dimension being placed shows as dimensionDraft instead
      draft:
        drawing && points.length > 0 && dimOffset.current === null
          ? {
              points,
              kind: draftKind(tool),
              thickness: wallThickness,
              axis: tool === "wall" ? sideAxis(points, wallLine, wallThickness) : undefined,
            }
          : null,
      guides:
        g?.kind === "move"
          ? (g.slide?.guides ?? g.snap?.guides ?? [])
          : (handleDrag?.drag.guides ?? snap?.guides ?? []),
      note: g?.kind === "move" ? (g.slide?.note ?? g.snap?.note ?? null) : (snap?.note ?? null),
      // At the pointer: beside the wall the distances already take the space
      noteAt:
        g?.kind === "move" && g.slide
          ? (mouseWorld.current ?? [g.slide.x, g.slide.y])
          : g?.kind === "move"
            ? mouseWorld.current
            : (snap?.pt ?? null),
      hints: isSnapTool(tool) ? (snapHints.current ?? []) : [],
      typedLength: typedText(),
      typedAt:
        !drawing && typed.current
          ? measure.current
            ? measureEnd(measure.current)
            : (parallel?.distance[1] ?? null)
          : null,
      handles:
        tool === "select" && sel.length === 1 ? elementHandles(input.home, sel[0], pxToCm(1)) : [],
      handleDrag,
      rubberBand: g?.kind === "band" ? [g.start, g.end] : null,
      measure: m ? [m.a, measureEnd(m)] : (parallel?.distance ?? null),
      pointPairs: picking ? { points: picking.points, cursor: pickCursor.current } : null,
      snap: snap?.marker ?? null,
      visitor: shownVisitor(g),
      visitorHandle: (() => {
        const v = shownVisitor(g);
        return v && tool === "select" && sel.length === 1 && sel[0] === VISITOR_ID
          ? visitorHandlePos(v, pxToCm(1))
          : null;
      })(),
      cameraPath: cameraPathShown
        ? (input.home.environment?.cameras ?? [])
            .filter((c) => c.attrs.role === "cameraPath")
            .map((c) => ({ x: c.attrs.x, y: c.attrs.y, yaw: c.attrs.yaw }))
        : null,
      dropPreview: drop.current,
      surfaceTarget: surfaceHover.current,
      accent,
      guide: guideColor,
      measureColor,
    };
    drawOverlay(ctx, viewRef.current, input.home, input.wallShapes, overlay);
    perfMark("plan-draw");
    // Rulers follow a move of the selection and the drag of one of their ends
    const shownGuides = movedGuides(
      levelGuides(input.home, effectiveLevel),
      g?.kind === "move" && !g.dock && !g.slide ? sel : [],
      g?.kind === "move" ? g.offset : [0, 0],
      handleDrag?.drag.command === "guide_update" ? handleDrag.drag.params : null,
    );
    if (parallel) {
      const [a, b] = parallel.line;
      shownGuides.push({
        id: "",
        level: null,
        x_start: a[0],
        y_start: a[1],
        x_end: b[0],
        y_end: b[1],
      });
    }
    if (rulerDraft?.b) {
      const [a, b] = [rulerDraft.a, measureEnd(rulerDraft)];
      shownGuides.push({
        id: "",
        level: null,
        x_start: a[0],
        y_start: a[1],
        x_end: b[0],
        y_end: b[1],
      });
    }
    drawGuides(
      ctx,
      shownGuides,
      sel,
      rulerColor,
      accent,
      1 / viewRef.current.scale,
      rulerDashStyle,
    );
    drawRulers();
  }, [
    input,
    colors,
    tool,
    accent,
    guideColor,
    rulerColor,
    rulerDashStyle,
    measureColor,
    wallThickness,
    wallLine,
    highlightSide,
    showGrid,
    showRulers,
    magnetism,
    drawRulers,
    viewMode,
    visitorPose,
    cameraPathShown,
    // Without these two the drawing kept the grid distance and the opacity of the background
    // image it was created with: a new choice showed only after the next change of a tool
    gridSpacing,
    backgroundOpacity,
  ]);

  drawRef.current = draw;

  /** The plan was too small to fit the home into it; done when it has a size again */
  const fitWhenShown = useRef(false);
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !input) return;
    const b = planBounds(input);
    if (!b) return;
    const margin = 40 * devicePixelRatio;
    const w = Math.max(b[2] - b[0], 100);
    const h = Math.max(b[3] - b[1], 100);
    // A plan that is collapsed (only the 3D view shown) has no room to fit into: the scale
    // would be negative. It is fitted when it is shown again.
    if (canvas.width <= 2 * margin + 20 || canvas.height <= 2 * margin + 20) {
      fitWhenShown.current = true;
      return;
    }
    fitWhenShown.current = false;
    const scale = Math.min((canvas.width - 2 * margin) / w, (canvas.height - 2 * margin) / h);
    const view = {
      scale,
      offsetX: canvas.width / 2 - ((b[0] + b[2]) / 2) * scale,
      offsetY: canvas.height / 2 - ((b[1] + b[3]) / 2) * scale,
    };
    const before = viewRef.current;
    // The same view as before (most changes of the home leave its bounds alone): the plan
    // is drawn for the change anyway, not a second time here
    if (
      Math.abs(view.scale - before.scale) < 1e-9 &&
      Math.abs(view.offsetX - before.offsetX) < 1e-6 &&
      Math.abs(view.offsetY - before.offsetY) < 1e-6
    ) {
      return;
    }
    viewRef.current = view;
    draw();
  }, [input, draw]);

  // Resize the canvas to its CSS size in device pixels
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
      if (fitWhenShown.current) refitRef.current();
      else drawRef.current();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
    // Observed once: observing again after every change of the home would clear and draw
    // the plan a second time
  }, []);

  // Fit when another home is opened or the level changes. Edits in the plan stop
  // the automatic fitting, so the plan does not jump while the user works.
  const userMoved = useRef(false);
  const fitKey = useRef<string | null>(null);
  const refit = () => {
    userMoved.current = false;
    fit();
  };
  const refitRef = useRef(refit);
  refitRef.current = refit;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when a fit is requested
  useEffect(() => {
    if (fitRequest === 0) return;
    pendingFit.current = true;
    refit();
  }, [fitRequest]);
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
    dimOffset.current = null;
    measure.current = null;
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

  /** Cursor point for drawing tools and the measuring tool, with magnetism if active. */
  const snapped = (p: Pt, altKey: boolean, shiftKey = false): Pt => {
    if (!input || !magnetismActive(altKey) || !isSnapTool(tool)) {
      snapState.current = null;
      snapHints.current = null;
      return p;
    }
    const m = measure.current;
    const measuring = tool === "measure" || tool === "ruler";
    const path = measuring ? (m && !m.done ? [m.a] : []) : draft.current;
    const previous = path.length > 0 ? path[path.length - 1] : null;
    const ctx = snapContext(
      (measuring ? "dimension" : tool) as SnapPurpose,
      input.home,
      input.wallShapes,
      effectiveLevel,
      pxToCm(snapPx()),
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

  /** A point awaited in the plan (see `pointPick`): corners, edges and cut lines catch it. */
  const pickPoint = (p: Pt, altKey: boolean): Pt => {
    if (!input || !magnetismActive(altKey)) {
      snapState.current = null;
      return p;
    }
    const s = snapDraw(
      p,
      null,
      snapContext("dimension", input.home, input.wallShapes, effectiveLevel, pxToCm(snapPx()), {
        near: p,
      }),
    );
    snapState.current = s;
    return s.pt;
  };

  // ---------------------------------------------------------------- commands

  const { run, setSelection } = useStore.getState();

  const resetDraft = () => {
    draft.current = [];
    cursor.current = null;
    snapState.current = null;
    typed.current = null;
    dimOffset.current = null;
    setHint(hintText());
  };

  /** Finishes the drawing: keeps it if it has enough points, otherwise discards it. */
  const finishDraft = async () => {
    const pts = draft.current;
    const offset = dimOffset.current;
    resetDraft();
    draw();
    if (!isPathTool(tool) || pts.length < MIN_POINTS[draftKind(tool)]) return;
    userMoved.current = true;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const closed = pts.length >= 4 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1;
    const points = closed ? pts.slice(0, -1) : pts;
    let result: unknown;
    if (tool === "wall" || tool === "arcwall") {
      // The options of the tool bar above the plan
      const options = useStore.getState();
      result = await run("wall_add_path", {
        points,
        closed,
        thickness: options.wallThickness,
        ...(options.wallHeight !== null && { height: options.wallHeight }),
        ...newWallParams(),
        ...(tool === "arcwall"
          ? { arc_extent_deg: options.arcExtent }
          : options.wallLine !== "axis" && { side: options.wallLine }),
        ...levelParam(),
      });
    } else if (tool === "room") {
      result = await run("room_add", { points, ...newRoomParams(), ...levelParam() });
    } else if (tool === "polyline") {
      result = await run("polyline_add", { points, closed, ...levelParam() });
    } else if (tool === "dimension") {
      // Only a placed dimension is added (Esc while placing cancels it)
      if (offset === null) return;
      result = await run("dimension_add", {
        x_start: first[0],
        y_start: first[1],
        x_end: last[0],
        y_end: last[1],
        offset,
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
      ...newRoomParams(),
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
      if ((tool === "wall" || tool === "arcwall" || tool === "polyline") && pts.length >= 3) {
        pts.push(p);
        await finishDraft();
        return;
      }
    }
    pts.push(p);
    if (tool === "dimension" && pts.length === 2) {
      // The end point is set: now the mouse places the dimension line, a click finishes it
      cursor.current = null;
      dimOffset.current = mouseWorld.current ? offsetAt(mouseWorld.current) : 0;
      setHint(hintText());
    }
    draw();
  };

  /** Dimension tool: offset of the dimension line through the point (whole cm). */
  const offsetAt = (p: Pt): number => {
    const [s, e] = draft.current;
    const dx = e[0] - s[0];
    const dy = e[1] - s[1];
    const len = Math.hypot(dx, dy) || 1;
    return Math.round(((p[0] - s[0]) * -dy + (p[1] - s[1]) * dx) / len);
  };

  /** Adds the point at the typed length in the direction of the cursor. */
  const addTypedPoint = () => {
    const length =
      evalLength(typed.current?.length ?? "", usePreferences.getState().unit) ?? Number.NaN;
    const p = typedPoint();
    typed.current = null;
    if (dimOffset.current !== null) {
      // Placing a dimension: the typed distance on the side of the mouse
      if (Number.isFinite(length) && length >= 0) {
        dimOffset.current = dimOffset.current < 0 ? -length : length;
        void finishDraft();
      } else draw();
      return;
    }
    if (p) void addDraftPoint(p);
    else draw();
  };

  /**
   * Point the typed input gives from the last point (or the start of the measure) toward the
   * cursor; null without a complete input.
   */
  const typedPoint = (): Pt | null => {
    const i = typed.current;
    if (!i) return null;
    const unit = usePreferences.getState().unit;
    if (isPathTool(tool)) {
      const pts = draft.current;
      if (pts.length === 0 || dimOffset.current !== null) return null;
      return inputPoint(i, pts[pts.length - 1], cursor.current, unit);
    }
    const m = measure.current;
    return m && !m.done ? inputPoint(i, m.a, m.b, unit) : null;
  };

  /** Text of the typed input shown at the cursor. */
  const typedText = (): string | null =>
    typed.current
      ? inputText(typed.current, unitSymbol(), {
          length: t("Length"),
          angle: t("Angle"),
          point: t("Point"),
        })
      : null;

  // ---------------------------------------------------------------- mouse

  const onWheel = (e: React.WheelEvent) => {
    zoomAt(
      e.nativeEvent.offsetX * devicePixelRatio,
      e.nativeEvent.offsetY * devicePixelRatio,
      Math.exp(-e.deltaY * 0.0015),
    );
  };

  /** Zooms by `factor` around the canvas point (mx, my) in device pixels. */
  const zoomAt = (mx: number, my: number, factor: number) => {
    userMoved.current = true;
    const v = viewRef.current;
    const scale = Math.min(Math.max(v.scale * factor, 0.01), 50);
    viewRef.current = {
      scale,
      offsetX: mx - ((mx - v.offsetX) * scale) / v.scale,
      offsetY: my - ((my - v.offsetY) * scale) / v.scale,
    };
    draw();
  };

  /** The visitor drawn in the plan, moved or turned by the gesture in progress. */
  const shownVisitor = (g: Gesture | null) => {
    if (!input || viewMode !== "observer") return null;
    const v = visitorInPlan(input, visitorPose);
    if (!v) return null;
    if (g?.kind === "visitor-rotate") return { ...v, yaw: g.yaw };
    if (g?.kind === "move" && useStore.getState().selection.includes(VISITOR_ID)) {
      return { ...v, x: v.x + g.offset[0], y: v.y + g.offset[1] };
    }
    return v;
  };

  /** What is under the pointer of the visitor: its turning handle, its body or nothing. */
  const visitorUnder = (p: Pt): "handle" | "body" | null => {
    const v = shownVisitor(null);
    if (!v || tool !== "select") return null;
    const sel = useStore.getState().selection;
    if (sel.length === 1 && sel[0] === VISITOR_ID) {
      const h = visitorHandlePos(v, pxToCm(1));
      if (Math.hypot(p[0] - h[0], p[1] - h[1]) <= pxToCm(PICK_PX + 4)) return "handle";
    }
    if (Math.hypot(p[0] - v.x, p[1] - v.y) <= VISITOR_PICK_RADIUS + pxToCm(PICK_PX)) return "body";
    return null;
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
    // The middle or right button, the pan tool, or the left button with Space held
    if (
      e.button === 1 ||
      e.button === 2 ||
      (e.button === 0 && (tool === "pan" || spaceHeld.current))
    ) {
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
    const ui = useUi.getState();
    if (ui.pointPick) {
      const points = [...ui.pointPick.points, pickPoint(p, e.altKey)];
      if (points.length >= ui.pointPick.labels.length) {
        ui.pointPick.onDone(points);
        ui.setPointPick(null);
      } else {
        ui.setPointPick({ ...ui.pointPick, points });
      }
      return;
    }
    if (ui.pick) {
      // The pipette: the clicked surface gives its look
      const from = surfaceAt(input.home, input.wallShapes, effectiveLevel, p, pxToCm(PICK_PX));
      if (from) ui.pick.onPick(from);
      ui.setPick(null);
      return;
    }
    if (ui.placing) {
      // Shift+click places the piece and keeps it at the pointer for the next one
      void placeCatalogItem(ui.placing.data, p, e.altKey);
      if (!e.shiftKey) ui.setPlacing(null);
      return;
    }
    if (offsetFrom.current) {
      finishOffsetGuide();
      return;
    }
    if (tool === "select") {
      const dist = distanceUnder(p);
      const selId = useStore.getState().selection[0];
      if (dist && selId) {
        // No focus change by the mouse press: it would take the focus from the new field
        e.preventDefault();
        (e.target as Element).releasePointerCapture(e.pointerId);
        setDistanceEdit({ id: selId, d: dist });
        return;
      }
      const onVisitor = visitorUnder(p);
      if (onVisitor === "handle") {
        userMoved.current = true;
        gesture.current = { kind: "visitor-rotate", yaw: shownVisitor(null)?.yaw ?? 0 };
        draw();
        return;
      }
      const handle = onVisitor ? null : handleUnder(p);
      if (handle) {
        userMoved.current = true;
        gesture.current = { kind: "handle", handle, drag: null, cursor: p };
        draw();
        return;
      }
      // The visitor stands on top of the plan, the ruler guides above the elements
      const guide = onVisitor ? null : guideAt(input.home, effectiveLevel, p, pxToCm(PICK_PX));
      const hit = onVisitor
        ? { id: VISITOR_ID }
        : guide
          ? { id: guide.id }
          : hitTest(input.home, input.wallShapes, effectiveLevel, p, pxToCm(PICK_PX));
      gesture.current = {
        kind: "press",
        start: p,
        screen: [e.clientX, e.clientY],
        hitId: hit?.id ?? null,
        extend: (e.shiftKey || e.ctrlKey || e.metaKey) && hit?.id !== VISITOR_ID,
      };
    } else if (tool === "measure" || tool === "ruler") {
      const s = snapped(p, e.altKey, e.shiftKey);
      const m = measure.current;
      if (!m || m.done) {
        measure.current = { a: s, b: null, done: false };
        typed.current = null;
        gesture.current = { kind: "draw", screen: [e.clientX, e.clientY], dragged: false };
      } else {
        m.b = typedPoint() ?? s;
        m.done = true;
        typed.current = null;
        if (tool === "ruler") addRuler();
      }
      draw();
    } else if (tool === "roomauto") {
      void addRoomAt(p);
    } else if (tool === "heightdim") {
      const s = snapped(p, e.altKey, e.shiftKey);
      const level = input.home.levels.find((l) => l.attrs.id === effectiveLevel);
      void run("dimension_add_height", {
        x: Math.round(s[0] * 10) / 10,
        y: Math.round(s[1] * 10) / 10,
        elevation_end: level?.attrs.height ?? input.home.attrs.wall_height ?? 250,
        ...levelParam(),
      }).then((r) => {
        const id = (r as { id?: string } | undefined)?.id;
        if (id) setSelection([id]);
      });
    } else if (tool === "label") {
      // Typed at the clicked position (the click finishes a text being typed elsewhere first)
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      setTextEdit({
        at: [Math.round(p[0]), Math.round(p[1])],
        id: null,
        text: "",
        size: prefs().newTextSize,
      });
    } else if (tool === "dimension" && dimOffset.current !== null) {
      dimOffset.current = offsetAt(p);
      void finishDraft();
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
    mouseWorld.current = toWorld(e.clientX, e.clientY);
    usePointer.setState({ pt: mouseWorld.current });
    const ui = useUi.getState();
    if (!g && input && ui.pointPick) {
      pickCursor.current = pickPoint(mouseWorld.current, e.altKey);
      if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
      draw();
      return;
    }
    if (!g && input && (ui.pick || ui.placing)) {
      // The surface the pipette would take, or the piece where the click would place it
      if (ui.pick) {
        surfaceHover.current = surfaceAt(
          input.home,
          input.wallShapes,
          effectiveLevel,
          mouseWorld.current,
          pxToCm(PICK_PX),
        );
      } else if (ui.placing) {
        drop.current = {
          preview: dropPreview(
            input.home,
            effectiveLevel,
            ui.placing.data,
            mouseWorld.current,
            pxToCm(40),
            catalogDock(e.altKey),
          ),
          icon: ui.placing.icon,
        };
      }
      if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
      draw();
      return;
    }
    const o = offsetFrom.current;
    if (o && !g) {
      // The side and distance of the parallel ruler follow the mouse (whole cm with magnetism)
      const raw = edgeOffset(o.a, o.b, mouseWorld.current);
      const d = Math.max(0, Math.abs(raw) - o.half);
      const snappedD = magnetismActive(e.altKey) ? Math.round(d) : Math.round(d * 10) / 10;
      o.offset = (raw < 0 ? -1 : 1) * (snappedD + o.half);
      draw();
      return;
    }
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
    if (g?.kind === "visitor-rotate") {
      const v = shownVisitor(null);
      if (v && Math.hypot(p[0] - v.x, p[1] - v.y) > 1) {
        // Direction (-sin yaw, cos yaw) towards the pointer; 5° steps, Shift: 1°
        let deg = (Math.atan2(-(p[0] - v.x), p[1] - v.y) * 180) / Math.PI;
        deg = magnetismActive(e.altKey) ? snapAngleDeg(deg, e.shiftKey) : Math.round(deg);
        g.yaw = (deg * Math.PI) / 180;
        setHint(t("Direction {v0}°", { v0: (((Math.round(deg) % 360) + 360) % 360).toString() }));
      }
      draw();
      return;
    }
    if (g?.kind === "handle" && input) {
      g.cursor = p;
      g.drag = dragHandle(
        input.home,
        input.wallShapes,
        effectiveLevel,
        g.handle,
        p,
        pxToCm(snapPx()),
        magnetismActive(e.altKey),
        e.shiftKey,
        useUi.getState().keepProportions,
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
      const onVisitor = visitorUnder(p);
      canvasRef.current.style.cursor =
        onVisitor === "handle"
          ? ROTATE_CURSOR
          : onVisitor === "body"
            ? "move"
            : handle
              ? handleCursor(input.home, handle)
              : cursorStyle.select;
      drawRulers();
    }
    if (g?.kind === "press") {
      if (Math.hypot(e.clientX - g.screen[0], e.clientY - g.screen[1]) < DRAG_THRESHOLD_PX) return;
      userMoved.current = true;
      if (g.hitId) {
        // Dragging an unselected element selects it first
        const sel = useStore.getState().selection;
        if (g.hitId === VISITOR_ID) setSelection([VISITOR_ID]);
        // (Shift while dragging locks the move to an axis; Shift or Ctrl+click extends the selection)
        else if (!sel.includes(g.hitId)) setSelection([g.hitId]);
        gesture.current = { kind: "move", start: g.start, offset: [0, 0], dock: null, slide: null };
      } else {
        gesture.current = { kind: "band", start: g.start, end: p, extend: g.extend };
      }
    }
    const g2 = gesture.current;
    if (g2?.kind === "move" && input) {
      const sel = useStore.getState().selection;
      let raw: Pt = [p[0] - g2.start[0], p[1] - g2.start[1]];
      if (e.shiftKey) raw = lockAxis(raw, moveAxis(input.home, sel));
      // Finer steps when zoomed in, 1 cm at most
      const step = dragStep(pxToCm(1), magnetismActive(e.altKey));
      let offset: Pt = [roundTo(raw[0], step), roundTo(raw[1], step)];
      g2.dock = null;
      g2.slide = null;
      const single = sel.length === 1 ? findPiece(sel[0]) : null;
      if (single?.kind === "DoorOrWindow") {
        // Doors and windows slide along the wall they are moved into
        g2.slide = slideInWall(
          input.home,
          input.wallShapes,
          effectiveLevel,
          single,
          [single.attrs.x + offset[0], single.attrs.y + offset[1]],
          pxToCm(30),
          pxToCm(snapPx()),
          magnetismActive(e.altKey),
          catalogDepth(single),
          g2.held ?? null,
          step,
        );
        g2.held = g2.slide?.state ?? null;
      } else if (magnetismActive(e.altKey) && !sel.includes(VISITOR_ID)) {
        offset = constrainMove(input.home, sel, offset);
        const singleWall = sel.length === 1 && input.home.walls.some((w) => w.attrs.id === sel[0]);
        // The grid, if it catches: the selection lands on its lines. What the objects catch
        // below wins over it. A single wall that moves at a slant across itself keeps that
        // move.
        const grid = snapGridStep();
        if (grid > 0 && !(singleWall && offset[0] !== 0 && offset[1] !== 0)) {
          if (g2.anchor === undefined) {
            g2.anchor = gridAnchor(input.home, input.wallShapes, sel);
          }
          if (g2.anchor) offset = gridOffset(g2.anchor, offset, grid);
        }
        // Smart guides: edges and middles to nearby furniture and wall faces, equal gaps
        // (not for a single wall, which keeps its straight move, nor with the axis lock)
        g2.snap = null;
        if (!singleWall && !e.shiftKey && usePreferences.getState().snapObjects) {
          g2.targets ??= moveTargets(input.home, input.wallShapes, effectiveLevel, sel);
          if (g2.box === undefined) g2.box = selectionBox(input.home, input.wallShapes, sel);
          if (g2.box) {
            g2.snap = snapMove(g2.box, g2.targets, offset, pxToCm(snapPx()));
            offset = g2.snap.offset;
          }
        }
        const piece = sel.length === 1 ? findPiece(sel[0]) : null;
        if (piece) {
          g2.dock = dockToWall(
            input.home,
            input.wallShapes,
            effectiveLevel,
            piece,
            [piece.attrs.x + offset[0], piece.attrs.y + offset[1]],
            pxToCm(snapPx()),
          );
          if (g2.dock) g2.snap = null;
        }
      }
      // A single piece shows its distances to the next wall or piece in every direction
      g2.distances = [];
      const lone = sel.length === 1 ? findPiece(sel[0]) : null;
      if (lone && lone.kind !== "DoorOrWindow") {
        g2.targets ??= moveTargets(input.home, input.wallShapes, effectiveLevel, sel);
        const at: Pt = g2.dock
          ? [g2.dock.x, g2.dock.y]
          : [lone.attrs.x + offset[0], lone.attrs.y + offset[1]];
        const angle = g2.dock ? (g2.dock.angleDeg * Math.PI) / 180 : (lone.attrs.angle ?? 0);
        g2.distances = pieceDistances(lone, at, angle, g2.targets.segments, 500).map(
          (d): Gap => [d.a, d.b],
        );
      }
      g2.offset = offset;
      draw();
    } else if (g2?.kind === "band") {
      g2.end = p;
      draw();
    } else if (tool === "dimension" && dimOffset.current !== null) {
      dimOffset.current = offsetAt(p);
      draw();
    } else if (isPathTool(tool)) {
      // Before the first click the snap marker and guides already show where it lands
      const s = snapped(p, e.altKey, e.shiftKey);
      cursor.current = draft.current.length > 0 ? s : null;
      draw();
    } else if (tool === "measure" || tool === "ruler") {
      const s = snapped(p, e.altKey, e.shiftKey);
      const m = measure.current;
      if (m && !m.done) m.b = s;
      draw();
    } else if (!g) {
      drawRulers();
    }
  };

  /** Keeps showing the finished gesture `g` until its command has changed the home. */
  const settle = (g: Gesture, pending: Promise<unknown>) => {
    if (!input) return;
    const entry = { gesture: g, home: input.home };
    settling.current = entry;
    const done = () => {
      if (settling.current !== entry) return;
      settling.current = null;
      draw();
    };
    // Failed (or changed nothing): show the home as it is; otherwise the new home ends it
    void pending.then((r) => (r === undefined ? done() : setTimeout(done, 1000)));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || !input) return;
    const sel = useStore.getState().selection;
    if (g.kind === "pan") {
      // A right click without dragging opens the context menu (select mode), finishes the
      // drawing, or leaves the tool
      if (!g.moved) {
        if (offsetFrom.current) {
          offsetFrom.current = null;
          typed.current = null;
          setHint(hintText());
          draw();
        } else if (tool === "select" && e.button === 2) openMenu(e.clientX, e.clientY);
        else if (isPathTool(tool) && draft.current.length > 0) void finishDraft();
        else if ((tool === "measure" || tool === "ruler") && measure.current) {
          measure.current = null;
          draw();
        } else if (tool !== "select") useStore.getState().setTool("select");
      }
      return;
    }
    if (g.kind === "draw" && (tool === "measure" || tool === "ruler")) {
      // Press, drag, release measures the dragged distance (or draws a ruler)
      const m = measure.current;
      if (g.dragged && m && !m.done && m.b) {
        m.done = true;
        if (tool === "ruler") addRuler();
        draw();
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
      if (g.drag) settle(g, run(g.drag.command, g.drag.params));
      draw();
      return;
    }
    if (g.kind === "visitor-rotate") {
      void setVisitor({ yaw: g.yaw });
      setHint(hintText());
      draw();
      return;
    }
    if (g.kind === "press") {
      // Plain click: select the element under the cursor (Shift or Ctrl toggles)
      if (g.hitId) {
        if (g.extend) {
          setSelection(
            sel.includes(g.hitId) ? sel.filter((s) => s !== g.hitId) : [...sel, g.hitId],
          );
        } else {
          setSelection([g.hitId]);
        }
      } else if (!g.extend) {
        setSelection([]);
      }
    } else if (g.kind === "move") {
      const [dx, dy] = g.offset;
      // A single piece moved onto a table or shelf, or off it back to the floor
      const single = sel.length === 1 ? findPiece(sel[0]) : null;
      const drop =
        single && (dx !== 0 || dy !== 0) && magnetismActive(e.altKey)
          ? dropElevation(input.home, single, [single.attrs.x + dx, single.attrs.y + dy])
          : null;
      let pending: Promise<unknown> | null = null;
      if (g.slide && sel.length === 1) {
        pending = run("furniture_update", {
          id: sel[0],
          x: g.slide.x,
          y: g.slide.y,
          angle_deg: g.slide.angleDeg,
          depth: g.slide.depth,
          ...(g.slide.cutThrough ? { wall_cut_out_on_both_sides: true } : {}),
        });
      } else if (g.dock && sel.length === 1) {
        const docked =
          single && magnetismActive(e.altKey)
            ? dropElevation(input.home, single, [g.dock.x, g.dock.y])
            : null;
        pending = run("furniture_update", {
          id: sel[0],
          x: g.dock.x,
          y: g.dock.y,
          angle_deg: g.dock.angleDeg,
          ...(docked ? { elevation: docked.elevation } : {}),
        });
      } else if (single && drop) {
        // Move and change the elevation in one step
        pending = run("furniture_update", {
          id: sel[0],
          x: single.attrs.x + dx,
          y: single.attrs.y + dy,
          elevation: drop.elevation,
        });
      } else if ((dx !== 0 || dy !== 0) && sel.includes(VISITOR_ID)) {
        const v = currentVisitor();
        if (v) void setVisitor({ x: v.x + dx, y: v.y + dy });
      } else if ((dx !== 0 || dy !== 0) && sel.length > 0) {
        pending = run("edit_move", { ids: sel, dx, dy });
      }
      if (pending) settle(g, pending);
      draw();
    } else if (g.kind === "band") {
      // Dragged from right to left: also what the band only touches
      const crossing = g.end[0] < g.start[0];
      const ids = [
        ...elementsInRect(input.home, effectiveLevel, g.start, g.end, crossing),
        ...guidesInRect(input.home, effectiveLevel, g.start, g.end, crossing).map((x) => x.id),
      ];
      // With Shift or Ctrl the band adds to the selection
      setSelection(
        g.extend ? [...new Set([...sel.filter((id) => id !== VISITOR_ID), ...ids])] : ids,
      );
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
    } else if (tool === "select" && input) {
      // Double-click on a text: change it where it is
      const p = toWorld(e.clientX, e.clientY);
      const hit = hitTest(input.home, input.wallShapes, effectiveLevel, p, pxToCm(PICK_PX));
      const label = hit ? input.home.labels.find((l) => l.attrs.id === hit.id) : undefined;
      if (label?.attrs.id) {
        setTextEdit({
          at: [label.attrs.x, label.attrs.y],
          id: label.attrs.id,
          text: label.text,
          size: label.text_style?.font_size ?? 18,
        });
      }
    }
  };

  /** Adds the typed text, or changes (or deletes, when emptied) the edited one. */
  const commitText = (edit: TextEdit, text: string) => {
    setTextEdit(null);
    if (edit.id) {
      if (text === edit.text) return;
      if (!text.trim()) void run("edit_delete", { ids: [edit.id] });
      else void run("label_update", { id: edit.id, text });
      return;
    }
    if (!text.trim()) return;
    void run("label_add", {
      text,
      ...newLabelParams(),
      x: edit.at[0],
      y: edit.at[1],
      ...levelParam(),
    }).then((r) => {
      const id = (r as { id?: string } | undefined)?.id;
      if (id) setSelection([id]);
    });
  };

  // ---------------------------------------------------------------- context menu

  /** Opens the context menu for the element under the pointer (selecting it first). */
  const openMenu = (clientX: number, clientY: number) => {
    if (!input) return;
    const p = toWorld(clientX, clientY);
    let sel = useStore.getState().selection;
    // A selected room or line keeps the selection near its outline, which often lies under
    // a wall, so its points can be added or deleted
    const tol = pxToCm(PICK_PX + 4);
    const outline = (pts: { x: number; y: number }[], closed: boolean) =>
      pts.some((q, i) => {
        const next = pts[(i + 1) % pts.length];
        return (
          (closed || i + 1 < pts.length) &&
          distanceToSegment(p, [q.x, q.y], [next.x, next.y]) <= tol
        );
      });
    const room = sel.length === 1 ? input.home.rooms.find((r) => r.attrs.id === sel[0]) : undefined;
    const line =
      sel.length === 1 ? input.home.polylines.find((l) => l.attrs.id === sel[0]) : undefined;
    const keep =
      (room && outline(room.points, true)) ||
      (line && outline(line.points, !!line.attrs.closed_path));
    if (!keep) {
      // Rulers lie above the elements, as for a click
      const guide = guideAt(input.home, effectiveLevel, p, pxToCm(PICK_PX));
      const hit = guide
        ? { id: guide.id }
        : hitTest(input.home, input.wallShapes, effectiveLevel, p, pxToCm(PICK_PX));
      if (hit && !sel.includes(hit.id)) sel = [hit.id];
      else if (!hit) sel = [];
    }
    setSelection(sel);
    const rect = canvasRef.current?.getBoundingClientRect();
    setMenu({
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
      items: menuItems(p, sel),
    });
  };

  /** "Add point here" / "Delete point" for the outline of a room or a polyline. */
  const pointItems = (
    p: Pt,
    pts: Pt[],
    closed: boolean,
    minPoints: number,
    apply: (pts: Pt[]) => void,
  ): MenuItem[] => {
    const tol = pxToCm(PICK_PX + 4);
    const near = pts.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol);
    if (near >= 0) {
      return [
        {
          label: t("Delete point"),
          disabled: pts.length <= minPoints,
          action: () => apply(pts.filter((_, i) => i !== near)),
        },
      ];
    }
    const edges = closed ? pts.length : pts.length - 1;
    let best = -1;
    let bestDist = tol;
    for (let k = 0; k < edges; k++) {
      const d = distanceToSegment(p, pts[k], pts[(k + 1) % pts.length]);
      if (d <= bestDist) {
        best = k;
        bestDist = d;
      }
    }
    if (best < 0) return [];
    const q = projectOnSegment(p, [pts[best], pts[(best + 1) % pts.length]]);
    const r = (v: number) => Math.round(v * 10) / 10;
    return [
      {
        label: t("Add point here"),
        action: () => {
          const next = [...pts];
          next.splice(best + 1, 0, [r(q[0]), r(q[1])]);
          apply(next);
        },
      },
    ];
  };

  /** Menu entry of a command of the registry: the same label, shortcut and state as in the menus. */
  const reg = commandItem;

  /** Opens the context menu for the selection as it is, from the keyboard (Shift+F10). */
  const openMenuForSelection = () => {
    const c = canvasRef.current;
    if (!input || !c) return;
    const rect = c.getBoundingClientRect();
    const x = rect.width / 2;
    const y = rect.height / 2;
    const sel = useStore.getState().selection;
    setMenu({ x, y, items: menuItems(toWorld(rect.left + x, rect.top + y), sel) });
  };

  /** Items of the context menu for the selection `sel` at the plan point `p`. */
  const menuItems = (p: Pt, sel: string[]): MenuItem[] => {
    if (!input) return [];
    const home = input.home;
    const has = (id: string | null | undefined) => !!id && sel.includes(id);
    const walls = home.walls.filter((w) => has(w.attrs.id));
    const furniture = home.furniture.filter((f) => has(f.attrs.id));
    const groups = furniture.filter((f) => f.type === "group");
    const rooms = home.rooms.filter((r) => has(r.attrs.id));
    const lines = home.polylines.filter((l) => has(l.attrs.id));
    const selectNew = (r: unknown) => {
      const ids = (r as { ids?: string[] } | undefined)?.ids;
      if (ids) setSelection(ids);
    };
    const items: MenuItem[] = [];
    if (sel.includes(VISITOR_ID)) {
      return [
        {
          label: t("Look from here in 3D"),
          action: () => useStore.getState().setViewMode("observer"),
        },
        { separator: true },
        { label: t("Fit plan to window"), action: () => refit() },
      ];
    }
    if (sel.length === 1 && sel[0] === "compass") {
      return [
        { label: t("Hide compass"), action: () => void run("compass_update", { visible: false }) },
        { separator: true },
        { label: t("Fit plan to window"), action: () => refit() },
      ];
    }
    // The commands of the menus, with their labels and shortcuts; they act on the selection,
    // which is the one this menu was opened for
    if (sel.length > 0) items.push(reg("edit.cut"), reg("edit.copy"));
    items.push(reg("edit.paste"));
    if (sel.length > 0) {
      items.push(
        reg("edit.pasteStyle"),
        reg("edit.duplicate"),
        reg("edit.delete"),
        reg("edit.selectSimilar"),
        { separator: true },
        reg("edit.moveBy"),
        reg("edit.rotateBy"),
        reg("furniture.rotate"),
        reg("edit.flipH"),
        reg("edit.flipV"),
      );
    }
    if (furniture.length > 1 || groups.length > 0) {
      items.push({ separator: true });
      if (furniture.length > 1) items.push(reg("furniture.group"));
      if (groups.length > 0) items.push(reg("furniture.ungroup"));
    }
    if (furniture.length > 1) {
      items.push({
        label: t("Align"),
        items: [
          { heading: t("Align to the piece selected last") },
          ...["left", "right", "front", "back", "top", "bottom", "side_by_side"].map((how) =>
            reg(`furniture.align.${how}`),
          ),
        ],
      });
      if (furniture.length > 2) {
        items.push(reg("furniture.distributeH"), reg("furniture.distributeV"));
      }
    }
    // A ruler parallel to the selected wall or ruler, at a typed or dragged distance
    const guide =
      sel.length === 1 ? levelGuides(home, effectiveLevel).find((g) => g.id === sel[0]) : undefined;
    if (sel.length === 1 && (walls.length === 1 || guide)) {
      items.push({
        label: t("Guide line at a distance…"),
        action: () => {
          if (guide) {
            startOffsetGuide([guide.x_start, guide.y_start], [guide.x_end, guide.y_end], 0);
          } else {
            const w = walls[0].attrs;
            startOffsetGuide([w.x_start, w.y_start], [w.x_end, w.y_end], (w.thickness ?? 0) / 2);
          }
        },
      });
    }
    if (walls.length > 0) {
      const wallIds = walls.map((w) => w.attrs.id);
      items.push({ separator: true });
      items.push(reg("wall.reverse"));
      if (walls.length === 1) {
        // At the clicked point; the menu command splits in the middle
        items.push({
          label: t("Split wall here"),
          action: () =>
            void run("wall_split", {
              id: wallIds[0],
              at: [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10],
            }).then(selectNew),
        });
      }
      if (walls.length >= 2) items.push(reg("wall.join"));
      if (walls.some((w) => w.attrs.wall_at_start || w.attrs.wall_at_end)) {
        items.push(reg("wall.detach"));
      }
    }
    // Dimensions of a single wall or piece
    if (sel.length === 1 && (walls.length === 1 || furniture.length === 1)) {
      const dims = autoDimensions(home, input.wallShapes, sel[0]);
      const r = (v: number) => Math.round(v * 10) / 10;
      items.push({ separator: true });
      const existing = existingDimensions(home, effectiveLevel, dims);
      if (existing) {
        items.push({
          label: walls.length
            ? t("Remove dimensions of the wall")
            : t("Remove dimensions of the piece"),
          action: () => void run("edit_delete", { ids: existing }),
        });
      } else if (dims.length > 0) {
        items.push({
          label: walls.length ? t("Add dimensions of the wall") : t("Add dimensions of the piece"),
          action: () => {
            for (const d of dims) {
              void run("dimension_add", {
                x_start: r(d.start[0]),
                y_start: r(d.start[1]),
                x_end: r(d.end[0]),
                y_end: r(d.end[1]),
                offset: d.offset,
                ...levelParam(),
              });
            }
          },
        });
      }
      // Height dimension: at the wall start, or at the front right corner of the piece
      let height: { at: Pt; bottom: number; top: number } | null = null;
      if (walls.length) {
        const a = walls[0].attrs;
        height = {
          at: [r(a.x_start), r(a.y_start)],
          bottom: 0,
          top: a.height ?? home.attrs.wall_height ?? 250,
        };
      } else {
        let piece: Piece | null = null;
        forEachPiece(home.furniture, (q) => {
          if (q.attrs.id === sel[0]) piece = q;
        });
        if (piece) {
          const a = (piece as Piece).attrs;
          const corner = dims[1]?.end ?? [a.x, a.y];
          const bottom = a.elevation ?? 0;
          height = {
            at: [r(corner[0]), r(corner[1])],
            bottom,
            top: bottom + (a.height_in_plan ?? a.height),
          };
        }
      }
      if (height) {
        const h = height;
        const existing = existingHeightDimension(home, effectiveLevel, h.at, h.bottom, h.top);
        items.push(
          existing
            ? {
                label: t("Remove height dimension"),
                action: () => void run("edit_delete", { ids: [existing] }),
              }
            : {
                label: t("Add height dimension"),
                action: () =>
                  void run("dimension_add_height", {
                    x: h.at[0],
                    y: h.at[1],
                    ...(h.bottom ? { elevation_start: h.bottom } : {}),
                    elevation_end: h.top,
                    ...levelParam(),
                  }),
              },
        );
      }
    }
    if (rooms.length === 1 && sel.length === 1) {
      const room = rooms[0];
      const pts: Pt[] = room.points.map((q) => [q.x, q.y]);
      const extra = pointItems(
        p,
        pts,
        true,
        3,
        (next) => void run("room_update", { id: room.attrs.id, points: next }),
      );
      if (extra.length) items.push({ separator: true }, ...extra);
    }
    if (lines.length === 1 && sel.length === 1) {
      const line = lines[0];
      const pts: Pt[] = line.points.map((q) => [q.x, q.y]);
      const closed = !!line.attrs.closed_path;
      const extra = pointItems(
        p,
        pts,
        closed,
        closed ? 3 : 2,
        (next) => void run("polyline_update", { id: line.attrs.id, points: next }),
      );
      if (extra.length) items.push({ separator: true }, ...extra);
    }
    items.push({ separator: true });
    if (sel.length === 0) items.push(reg("edit.selectAll"), reg("plan.fit"));
    items.push(reg("edit.lockBasePlan"));
    return items;
  };

  // ---------------------------------------------------------------- keyboard

  /** Ctrl shortcuts of the plan; returns false for keys it does not handle. */
  const onShortcut = (key: string, selected: string[], shift = false): boolean => {
    if (!input) return false;
    // The visitor is no element of the home: it cannot be copied or grouped
    const sel = selected.filter((id) => id !== VISITOR_ID);
    const topLevelFurniture = (ids: string[]) =>
      input.home.furniture
        .map((f) => f.attrs.id)
        .filter((id): id is string => !!id && ids.includes(id));
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
    } else if (key === "v" && !shift) {
      void run("edit_paste", levelParam()).then(selectNew);
    } else if (key === "d" && sel.length > 0) {
      void run("edit_duplicate", { ids: sel }).then(selectNew);
    } else if (key === "g" && !shift && sel.length > 1) {
      void run("furniture_group", { ids: topLevelFurniture(sel) }).then((r) => {
        const id = (r as { id?: string } | undefined)?.id;
        if (id) setSelection([id]);
      });
    } else if (key === "g" && shift && sel.length > 0) {
      void run("furniture_ungroup", { ids: sel }).then(selectNew);
    } else {
      return false;
    }
    return true;
  };

  /** Keys while drawing; returns false for keys it does not handle. */
  const onDrawingKey = (e: KeyboardEvent): boolean => {
    const drawing = draft.current.length > 0;
    // Length (Tab: angle) or point typed at the cursor, with units and arithmetic
    const next = drawing ? inputKey(typed.current, e.key) : undefined;
    if (next !== undefined) {
      typed.current = next;
    } else if (typed.current !== null && e.key.length === 1) {
      // Other characters while a value is typed are no shortcuts (e.g. R would rotate)
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
      // Escape discards what is being drawn; Enter or a double-click keeps it
      resetDraft();
    } else {
      return false;
    }
    draw();
    return true;
  };

  /**
   * Tab: selects the next of the elements under the mouse (Shift+Tab the previous one), so an
   * element covered by another one can be selected.
   */
  const cycleSelection = (back: boolean): boolean => {
    const p = mouseWorld.current;
    if (!input || !p) return false;
    const hits = hitTestAll(input.home, input.wallShapes, effectiveLevel, p, pxToCm(PICK_PX));
    const guide = guideAt(input.home, effectiveLevel, p, pxToCm(PICK_PX));
    const ids = [...hits.map((h) => h.id), ...(guide ? [guide.id] : [])];
    if (ids.length === 0) return false;
    const sel = useStore.getState().selection;
    const i = sel.length === 1 ? ids.indexOf(sel[0]) : -1;
    const next = i < 0 ? 0 : (i + (back ? ids.length - 1 : 1)) % ids.length;
    setSelection([ids[next]]);
    draw();
    return true;
  };

  /** Keys while measuring or drawing a ruler: the typed length, angle or end point. */
  const onMeasureKey = (e: KeyboardEvent): boolean => {
    const m = measure.current;
    if (!m) return false;
    if (e.key === "Enter" && typed.current) {
      const p = typedPoint();
      typed.current = null;
      if (p) {
        m.b = p;
        m.done = true;
        if (tool === "ruler") addRuler();
      }
    } else if (e.key === "Escape" && typed.current) {
      typed.current = null;
    } else {
      const next = inputKey(typed.current, e.key);
      // Other characters while a value is typed are no shortcuts
      if (next === undefined) return typed.current !== null && e.key.length === 1;
      typed.current = next;
    }
    draw();
    setHint(hintText());
    return true;
  };

  /** Stores the ruler just drawn as a guide of the shown level; the tool stays for the next. */
  const addRuler = () => {
    const m = measure.current;
    measure.current = null;
    if (m?.b) addGuide(m.a, m.b);
  };

  /**
   * The parallel ruler of "Ruler at a distance" and the measured distance from the face of
   * the wall (or the ruler) to it; a typed distance wins over the mouse.
   */
  const offsetGuide = (o: { a: Pt; b: Pt; half: number; offset: number }) => {
    const len = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]) || 1;
    const n: Pt = [(o.b[1] - o.a[1]) / len, -(o.b[0] - o.a[0]) / len];
    const side = o.offset < 0 ? -1 : 1;
    const typedDistance = typed.current
      ? evalLength(typed.current.length, usePreferences.getState().unit)
      : null;
    const offset =
      typedDistance !== null && typedDistance >= 0 ? side * (typedDistance + o.half) : o.offset;
    const at = (q: Pt, k: number): Pt => [q[0] + n[0] * k, q[1] + n[1] * k];
    const mid: Pt = [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2];
    return {
      line: [at(o.a, offset), at(o.b, offset)] as [Pt, Pt],
      distance: [at(mid, side * o.half), at(mid, offset)] as [Pt, Pt],
    };
  };

  /**
   * Distances of the single selected piece to the next wall or piece in its four directions;
   * a click on one of them types it.
   */
  const selectedDistances = (): Distance[] => {
    const sel = useStore.getState().selection;
    if (!input || tool !== "select" || sel.length !== 1) return [];
    const c = distanceCache.current;
    if (c && c.home === input.home && c.id === sel[0]) return c.value;
    const piece = findPiece(sel[0]);
    const value =
      piece && piece.kind !== "DoorOrWindow"
        ? pieceDistances(
            piece,
            [piece.attrs.x, piece.attrs.y],
            piece.attrs.angle ?? 0,
            moveTargets(input.home, input.wallShapes, effectiveLevel, sel).segments,
            500,
          )
        : [];
    distanceCache.current = { home: input.home, id: sel[0], value };
    return value;
  };

  /** The distance whose label is at `p` (where drawGap draws it), if any. */
  const distanceUnder = (p: Pt): Distance | null => {
    const px = pxToCm(1);
    for (const d of selectedDistances()) {
      const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) || 1;
      const n: Pt = [(d.b[1] - d.a[1]) / len, -(d.b[0] - d.a[0]) / len];
      const label: Pt = [
        (d.a[0] + d.b[0]) / 2 + n[0] * 18 * px,
        (d.a[1] + d.b[1]) / 2 + n[1] * 18 * px,
      ];
      const mid: Pt = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
      if (
        Math.min(
          Math.hypot(p[0] - label[0], p[1] - label[1]),
          Math.hypot(p[0] - mid[0], p[1] - mid[1]),
        ) <
        16 * px
      ) {
        return d;
      }
    }
    return null;
  };

  /** Moves the selected piece so that the edited distance gets the typed value. */
  const commitDistance = (edit: { id: string; d: Distance }, text: string) => {
    setDistanceEdit(null);
    const v = evalLength(text, usePreferences.getState().unit, edit.d.value);
    if (v === null || v < 0) return;
    const delta = edit.d.value - v;
    const r = (x: number) => Math.round(x * 100) / 100;
    if (Math.abs(delta) > 0.001) {
      void run("edit_move", {
        ids: [edit.id],
        dx: r(edit.d.dir[0] * delta),
        dy: r(edit.d.dir[1] * delta),
      });
    }
  };

  /** Starts "Ruler at a distance" from the line a→b (`half`: half the wall thickness). */
  const startOffsetGuide = (a: Pt, b: Pt, half: number) => {
    offsetFrom.current = { a, b, half, offset: half + 50 };
    typed.current = null;
    setHint(
      t(
        "Move the mouse to the side of the new guide line and click, or type the distance + Enter · Esc: cancel",
      ),
    );
    draw();
  };

  /** Finishes "Ruler at a distance": adds the parallel ruler. */
  const finishOffsetGuide = () => {
    const o = offsetFrom.current;
    if (o) addGuide(...offsetGuide(o).line);
    offsetFrom.current = null;
    typed.current = null;
    setHint(hintText());
    draw();
  };

  /** Adds a ruler from a to b on the shown level, with the defaults of the preferences. */
  const addGuide = (a: Pt, b: Pt) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) return;
    const r = (v: number) => Math.round(v * 100) / 100;
    void run("guide_add", {
      x_start: r(a[0]),
      y_start: r(a[1]),
      x_end: r(b[0]),
      y_end: r(b[1]),
      ...(effectiveLevel ? { level: effectiveLevel } : {}),
      // The defaults of the preferences become the ruler's own values
      ...(rulerColorPref ? { color: rulerColorPref } : {}),
      dash_style: rulerDashStyle,
    });
  };

  /**
   * Moves the selection with the arrow keys. While a move is running, further key presses
   * (also the repeats of a held key) add up and go as one move when it is done, so the plan
   * follows the keys instead of working off a queue of moves after they are released.
   */
  const nudges = useRef<NudgeQueue>(newNudgeQueue());
  const nudge = (ids: string[], dx: number, dy: number) => {
    const next = queueNudge(nudges.current, ids, dx, dy);
    if (next) sendNudge(next);
  };
  const sendNudge = (move: { ids: string[]; dx: number; dy: number }) => {
    void run("edit_move", move).finally(() => {
      const next = nudgeDone(nudges.current);
      if (next) sendNudge(next);
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read current state on each key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // A dialog takes all keys: Del must not delete the selection behind it
      if (modalOpen()) return;
      // Text fields type; check boxes and drop-downs keep their plain keys (Space, arrows)
      const focus = keyTarget(target);
      if (focus === "text" || (focus === "control" && !e.ctrlKey && !e.metaKey)) return;
      // Keys typed in the 3D view (walking in the virtual visit, turning the aerial view) are
      // not for the plan, except the ones that act on the selection shown there too: Escape
      // drops it, Del deletes it
      if (
        target.closest?.(".view3d-canvas") &&
        !e.ctrlKey &&
        !e.metaKey &&
        e.key !== "Escape" &&
        e.key !== "Delete"
      ) {
        return;
      }
      const state = useStore.getState();
      const sel = state.selection;
      if (!e.ctrlKey && !e.metaKey && sel.length === 1 && sel[0] === VISITOR_ID) {
        // Arrow keys move the selected visitor, R / Shift+R turn it by 15°
        const v = currentVisitor();
        const d = e.shiftKey ? 10 : 1;
        if (v && e.key.startsWith("Arrow")) {
          const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
          const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
          void setVisitor({ x: v.x + dx, y: v.y + dy });
          e.preventDefault();
          return;
        }
        if (v && (e.key === "r" || e.key === "R")) {
          void setVisitor({ yaw: v.yaw + ((e.shiftKey ? -15 : 15) * Math.PI) / 180 });
          e.preventDefault();
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") return;
      }
      // AltGr (e.g. @ on German keyboards) comes as Ctrl+Alt on Windows; it types, it is no shortcut
      if ((e.ctrlKey || e.metaKey) && !e.getModifierState("AltGraph")) {
        const key = e.key.toLowerCase();
        // Keys of the plan never trigger WebView functions (Ctrl+G is "find next" there)
        if (onShortcut(key, sel, e.shiftKey) || "acdgvx".includes(key)) e.preventDefault();
        return;
      }
      // The menu key or Shift+F10 opens the context menu of the selection
      if (state.tool === "select" && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"))) {
        openMenuForSelection();
        e.preventDefault();
        return;
      }
      // Space held: dragging with the left button pans the plan, whatever the tool
      if (e.key === " " && typed.current === null && target.tagName !== "BUTTON") {
        spaceHeld.current = true;
        e.preventDefault();
        return;
      }
      if (offsetFrom.current) {
        // "Guide line at a distance": the typed distance, Enter adds the line, Esc cancels
        if (e.key === "Enter") finishOffsetGuide();
        else if (e.key === "Escape") {
          offsetFrom.current = null;
          typed.current = null;
          setHint(hintText());
        } else if (e.key !== "Tab") {
          const next = inputKey(typed.current, e.key);
          if (next === undefined) return;
          typed.current = next;
        }
        draw();
        e.preventDefault();
        return;
      }
      if (isPathTool(state.tool) && onDrawingKey(e)) {
        e.preventDefault();
        return;
      }
      if (
        (state.tool === "measure" || state.tool === "ruler") &&
        !measure.current?.done &&
        onMeasureKey(e)
      ) {
        e.preventDefault();
        return;
      }
      if (
        (state.tool === "measure" || state.tool === "ruler") &&
        e.key === "Escape" &&
        measure.current
      ) {
        measure.current = null;
        draw();
        e.preventDefault();
        return;
      }
      if (e.key === "Tab" && state.tool === "select" && !e.altKey && cycleSelection(e.shiftKey)) {
        e.preventDefault();
        return;
      }
      if (
        e.key === "Escape" &&
        (useUi.getState().pick || useUi.getState().placing || useUi.getState().pointPick)
      ) {
        // Ends the pipette, the placing of a catalog piece or the clicking of points
        useUi.getState().setPick(null);
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (state.tool !== "select") state.setTool("select");
        else setSelection([]);
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel.length > 0) {
        void run("edit_delete", { ids: sel });
      } else if ((e.key === "r" || e.key === "R") && sel.length > 0 && state.opened) {
        // Rotate the selection by 15° (Shift: other direction)
        rotateSelection(e.shiftKey ? -15 : 15);
      } else if ((e.key === "j" || e.key === "J") && state.opened) {
        // Join the selected walls
        const walls = state.opened.home.walls.filter((w) => sel.includes(w.attrs.id));
        if (walls.length < 2) return;
        void run("wall_join", { ids: walls.map((w) => w.attrs.id) });
      } else if (e.key.startsWith("Arrow") && sel.length > 0) {
        // Alt: 1 mm, Shift: 10 cm, else 1 cm
        const d = nudgeStep(e.altKey, e.shiftKey);
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        nudge(sel, dx, dy);
      } else {
        return;
      }
      e.preventDefault();
    };
    const release = (e: KeyboardEvent | FocusEvent) => {
      if (!("key" in e) || e.key === " ") spaceHeld.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", release);
    };
  }, [tool, input, wallThickness]);

  // Preferences read while drawing: redraw plan and rulers when they change
  // biome-ignore lint/correctness/useExhaustiveDependencies: the values are read from the preferences store while drawing
  useEffect(() => {
    draw();
    drawRulers();
  }, [
    unit,
    roomRendering,
    underlay,
    leftSideColor,
    rightSideColor,
    gridSpacing,
    lengthDecimals,
    backgroundOpacity,
  ]);

  // Actions of the menus, the tool bar and the command search
  // biome-ignore lint/correctness/useExhaustiveDependencies: handlers read current state when called
  useEffect(
    () =>
      registerPlanActions({
        zoom: (factor) => {
          const c = canvasRef.current;
          if (c) zoomAt(c.width / 2, c.height / 2, factor);
        },
        zoomToSelection: () => {
          const canvas = canvasRef.current;
          if (!input || !canvas) return;
          const pts = useStore
            .getState()
            .selection.flatMap((id) => elementOutlines(input.home, input.wallShapes, id))
            .flatMap((o) => o.pts);
          if (pts.length === 0) return;
          const xs = pts.map((p) => p[0]);
          const ys = pts.map((p) => p[1]);
          const [x0, y0, x1, y1] = [
            Math.min(...xs),
            Math.min(...ys),
            Math.max(...xs),
            Math.max(...ys),
          ];
          const margin = 60 * devicePixelRatio;
          const scale = Math.max(
            0.01,
            Math.min(
              (canvas.width - 2 * margin) / Math.max(x1 - x0, 50),
              (canvas.height - 2 * margin) / Math.max(y1 - y0, 50),
              50,
            ),
          );
          userMoved.current = true;
          viewRef.current = {
            scale,
            offsetX: canvas.width / 2 - ((x0 + x1) / 2) * scale,
            offsetY: canvas.height / 2 - ((y0 + y1) / 2) * scale,
          };
          draw();
          drawRulers();
        },
        selectAll: () => void onShortcut("a", useStore.getState().selection),
        selectSimilar: () => {
          if (!input) return;
          setSelection(similarElements(input.home, effectiveLevel, useStore.getState().selection));
          draw();
        },
        paste: () => void onShortcut("v", useStore.getState().selection),
        isDrawing: takesTypedInput,
      }),
    [input, effectiveLevel],
  );

  // ---------------------------------------------------------------- drag & drop from the catalog

  /** Docks a catalog piece dropped near a wall with its back to it (with magnetism). */
  const catalogDock =
    (altKey: boolean): Dock | null =>
    (center, width, depth) => {
      if (!input || !magnetismActive(altKey)) return null;
      const piece = { kind: "Piece", attrs: { width, depth } } as unknown as Piece;
      const d = dockToWall(
        input.home,
        input.wallShapes,
        effectiveLevel,
        piece,
        center,
        pxToCm(2 * snapPx()),
      );
      return d && { x: d.x, y: d.y, angleDeg: d.angleDeg };
    };

  // The pipette or the placing ended: nothing of it stays in the plan
  // biome-ignore lint/correctness/useExhaustiveDependencies: draw reads the current state
  useEffect(() => {
    if (pointPick) {
      // The next point of the same series: its marker follows the pointer again
      draw();
      return;
    }
    pickCursor.current = null;
    if (pick || placing) return;
    drop.current = null;
    surfaceHover.current = null;
    if (!isSnapTool(tool)) snapState.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = cursorStyle[tool];
    draw();
  }, [pick, placing, pointPick]);

  /** Places a catalog piece at a point of the plan: in a wall, docked to one, or free. */
  const placeCatalogItem = async (item: CatalogDragData, p: Pt, altKey: boolean) => {
    if (!input) return;
    let result: unknown;
    const wall = item.doorOrWindow ? nearestWall(input.home, effectiveLevel, p, pxToCm(40)) : null;
    if (wall) {
      // Opens to the side of the wall it is dropped on (front of the piece: left of the wall)
      const w = input.home.walls.find((x) => x.attrs.id === wall.id)?.attrs;
      const side = w
        ? (p[0] - w.x_start) * -(w.y_end - w.y_start) + (p[1] - w.y_start) * (w.x_end - w.x_start)
        : 0;
      result = await run("furniture_add_in_wall", {
        catalog_id: item.catalogId,
        name: item.name,
        wall_id: wall.id,
        offset: Math.round(wall.offset),
        ...(side < 0 ? { flip: true } : {}),
      });
    } else {
      // Where the preview showed it: at the cursor, or docked to a wall
      const at = dropPreview(input.home, effectiveLevel, item, p, pxToCm(40), catalogDock(altKey));
      const angleDeg = Math.round(((at.angle * 180) / Math.PI) * 100) / 100;
      result = await run("furniture_add", {
        catalog_id: item.catalogId,
        name: item.name,
        x: at.center[0],
        y: at.center[1],
        ...(angleDeg ? { angle_deg: angleDeg } : {}),
        ...levelParam(),
      });
    }
    const id = (result as { id?: string } | undefined)?.id;
    if (id) {
      setSelection([id]);
      useCatalogPrefs.getState().noteUsed(item.catalogId);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(TEXTURE_DRAG_TYPE) && input) {
      // A texture: the floor, wall side or piece it would land on
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY);
      const target = surfaceAt(input.home, input.wallShapes, effectiveLevel, p, pxToCm(PICK_PX));
      e.dataTransfer.dropEffect = target ? "copy" : "none";
      surfaceHover.current = target;
      draw();
      return;
    }
    if (e.dataTransfer.types.includes(CATALOG_DRAG_TYPE) && input) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      // The piece at its size where it will land
      const drag = currentCatalogDrag();
      if (drag) {
        const p = toWorld(e.clientX, e.clientY);
        drop.current = {
          preview: dropPreview(
            input.home,
            effectiveLevel,
            drag.data,
            p,
            pxToCm(40),
            catalogDock(e.altKey),
          ),
          icon: drag.icon,
        };
        draw();
      }
    }
  };

  const onDragLeave = () => {
    if (!drop.current && !surfaceHover.current) return;
    drop.current = null;
    surfaceHover.current = null;
    draw();
  };

  const onDrop = async (e: React.DragEvent) => {
    drop.current = null;
    surfaceHover.current = null;
    draw();
    if (!input) return;
    const p = toWorld(e.clientX, e.clientY);
    const texture = e.dataTransfer.getData(TEXTURE_DRAG_TYPE);
    if (texture) {
      e.preventDefault();
      const { catalogId } = JSON.parse(texture) as TextureDragData;
      const target = surfaceAt(input.home, input.wallShapes, effectiveLevel, p, pxToCm(PICK_PX));
      if (!target) return;
      useUi.getState().noteTexture(catalogId);
      await run("texture_apply", { id: target.id, surface: target.surface, texture: catalogId });
      setSelection([target.id]);
      return;
    }
    const raw = e.dataTransfer.getData(CATALOG_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    await placeCatalogItem(JSON.parse(raw) as CatalogDragData, p, e.altKey);
  };

  return (
    <div className={`plan-view${showRulers && opened ? " with-rulers" : ""}`}>
      {showRulers && opened && (
        <>
          <div className="ruler-corner" title={t("Unit of the rulers (see the preferences)")}>
            {unit === "inch" ? "ft" : unitSymbol(unit)}
          </div>
          <canvas ref={topRulerRef} className="ruler ruler-top" />
          <canvas ref={leftRulerRef} className="ruler ruler-left" />
        </>
      )}
      <div className="plan-area">
        <canvas
          ref={canvasRef}
          style={{ cursor: cursorStyle[tool] }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            cursor.current = null;
            mouseWorld.current = null;
            if (useUi.getState().pick || useUi.getState().placing) {
              drop.current = null;
              surfaceHover.current = null;
            }
            usePointer.setState({ pt: null });
            draw();
          }}
          onDoubleClick={onDoubleClick}
          onContextMenu={(e) => e.preventDefault()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={(e) => void onDrop(e)}
        />
        {opened && (pick || placing || pointPick || hint) && (
          <div className="plan-hint">
            {pointPick
              ? pointPick.labels[pointPick.points.length]
              : pick
                ? pick.label
                : placing
                  ? t("Click to place “{name}” · Shift+click places several · Esc cancels", {
                      name: placing.data.name,
                    })
                  : hint}
          </div>
        )}
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
        )}
        {distanceEdit && (
          <input
            className="plan-distance-editor"
            ref={focusField}
            aria-label={t("Distance")}
            style={(() => {
              const v = viewRef.current;
              const d = distanceEdit.d;
              const mid: Pt = [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2];
              return {
                left: (mid[0] * v.scale + v.offsetX) / devicePixelRatio,
                top: (mid[1] * v.scale + v.offsetY) / devicePixelRatio,
              };
            })()}
            defaultValue={formatFieldValue(toUnit(distanceEdit.d.value))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitDistance(distanceEdit, e.currentTarget.value);
              else if (e.key === "Escape") setDistanceEdit(null);
            }}
            onBlur={() => setDistanceEdit(null)}
          />
        )}
        {textEdit && (
          <TextEditor
            key={`${textEdit.id ?? "new"}-${textEdit.at.join(",")}`}
            left={
              (textEdit.at[0] * viewRef.current.scale + viewRef.current.offsetX) / devicePixelRatio
            }
            top={
              (textEdit.at[1] * viewRef.current.scale + viewRef.current.offsetY) / devicePixelRatio
            }
            fontPx={(textEdit.size * viewRef.current.scale) / devicePixelRatio}
            initial={textEdit.text}
            onCommit={(text) => commitText(textEdit, text)}
            onCancel={() => setTextEdit(null)}
          />
        )}
        {opened && (
          <button
            type="button"
            className="overlay-button icon-button"
            onClick={refit}
            title={t("Fit plan to window")}
            aria-label={t("Fit plan to window")}
          >
            <Icon name="zoomfit" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

/** The visitor drawn in the plan: its live position, else the camera stored in the home. */
function visitorInPlan(
  input: PlanInput,
  live: { x: number; y: number; z: number; yaw: number; fov: number } | null,
): { x: number; y: number; yaw: number; fov: number } | null {
  const levels = input.home.levels;
  let pose = live;
  if (!pose) {
    const c = input.home.cameras.find((cam) => cam.attrs.role === "observerCamera")?.attrs;
    if (!c) return null;
    pose = { x: c.x, y: c.y, z: c.z, yaw: c.yaw, fov: c.field_of_view };
  }
  // Only on the level the visitor stands on
  if (levels.length > 1 && input.levelId && levelOfEye(input.home, pose.z) !== input.levelId) {
    return null;
  }
  return pose;
}
