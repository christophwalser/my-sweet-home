// Drag handle between two panes. Reports pointer positions while dragging.

import type { ReactNode } from "react";

interface SplitterProps {
  /** "vertical": a vertical bar that resizes horizontally; "horizontal": the opposite */
  orientation: "vertical" | "horizontal";
  /** Called with the pointer position (client coordinates) while dragging */
  onDrag: (x: number, y: number) => void;
  /** Called on double-click (e.g. back to the default size) */
  onReset?: () => void;
  className?: string;
  title?: string;
  children?: ReactNode;
}

export default function Splitter({
  orientation,
  onDrag,
  onReset,
  className,
  title,
  children,
}: SplitterProps) {
  const start = (e: React.PointerEvent<HTMLDivElement>) => {
    // Buttons inside the splitter keep their own clicks
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    document.body.classList.add(`resizing-${orientation}`);
    const move = (ev: PointerEvent) => onDrag(ev.clientX, ev.clientY);
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      document.body.classList.remove(`resizing-${orientation}`);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse-only resize handle
    <div
      className={`splitter splitter-${orientation} ${className ?? ""}`}
      onPointerDown={start}
      onDoubleClick={onReset}
      title={title}
    >
      {children}
    </div>
  );
}
