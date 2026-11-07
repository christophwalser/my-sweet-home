// 2D plan view: canvas with zoom (mouse wheel), pan (drag) and fit-to-content.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { docResourceUrl } from "../api";
import { forEachPiece } from "../model";
import { useStore } from "../store";
import {
  drawPlan,
  type PlanColors,
  type PlanInput,
  planBounds,
  type ViewTransform,
} from "./drawPlan";

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

export default function PlanView() {
  const opened = useStore((s) => s.opened);
  const levelId = useStore((s) => s.selectedLevel);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const [icons, setIcons] = useState(() => new Map<string, HTMLImageElement>());
  const [, setRedraw] = useState(0);
  const dark = useDarkMode();
  const colors = dark ? DARK : LIGHT;

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

  // Load furniture icons of the home
  useEffect(() => {
    if (!opened) return;
    const map = new Map<string, HTMLImageElement>();
    let pending = 0;
    forEachPiece(opened.home.furniture, (p) => {
      const key = p.attrs.plan_icon ?? p.attrs.icon;
      if (!key || map.has(key)) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      pending++;
      img.onload = img.onerror = () => {
        pending--;
        if (pending === 0) setRedraw((n) => n + 1);
      };
      img.src = docResourceUrl(opened.id, key);
      map.set(key, img);
    });
    // Floor textures are drawn as patterns in the plan
    for (const room of opened.home.rooms) {
      const key = room.textures?.find((t) => t.role === "floorTexture")?.image;
      if (!key || map.has(key)) continue;
      const img = new Image();
      img.crossOrigin = "anonymous";
      pending++;
      img.onload = img.onerror = () => {
        pending--;
        if (pending === 0) setRedraw((n) => n + 1);
      };
      img.src = docResourceUrl(opened.id, key);
      map.set(key, img);
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
  }, [input, colors]);

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

  // Fit when a home is opened or the level changes
  // Explicit fit: follow live edits again
  const refit = () => {
    userMoved.current = false;
    fit();
  };

  // Fit when another home is opened or the level changes. Live edits (UI, CLI, MCP)
  // keep fitting until the user zooms or pans.
  const userMoved = useRef(false);
  const fitKey = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit only on home/level change
  useEffect(() => {
    const key = `${opened?.id ?? ""}:${levelId ?? ""}`;
    if (fitKey.current !== key) {
      fitKey.current = key;
      userMoved.current = false;
    }
    if (!userMoved.current) fit();
  }, [opened, levelId]);

  useEffect(() => draw());

  // Zoom with the mouse wheel around the cursor
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

  // Pan by dragging
  const drag = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    userMoved.current = true;
    drag.current = { x: e.clientX, y: e.clientY };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const v = viewRef.current;
    viewRef.current = {
      ...v,
      offsetX: v.offsetX + (e.clientX - drag.current.x) * devicePixelRatio,
      offsetY: v.offsetY + (e.clientY - drag.current.y) * devicePixelRatio,
    };
    drag.current = { x: e.clientX, y: e.clientY };
    draw();
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="plan-view">
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={refit}
      />
      {opened && (
        <button type="button" className="overlay-button" onClick={refit} title="Fit plan to window">
          Fit
        </button>
      )}
    </div>
  );
}
