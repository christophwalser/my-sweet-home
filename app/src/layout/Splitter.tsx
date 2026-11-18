// Drag handle between two panes. Reports pointer positions while dragging; with the focus on
// it the arrow keys resize in steps and Enter restores the default size.

import type { ReactNode } from "react";

interface SplitterProps {
  /** "vertical": a vertical bar that resizes horizontally; "horizontal": the opposite */
  orientation: "vertical" | "horizontal";
  /** Called with the pointer position (client coordinates) while dragging */
  onDrag: (x: number, y: number) => void;
  /** Called on double-click or Enter (e.g. back to the default size) */
  onReset?: () => void;
  /** Called with -1 or 1 for the arrow keys towards the start or the end of the axis */
  onStep?: (direction: -1 | 1) => void;
  className?: string;
  title?: string;
  /** Name for screen readers, e.g. "Width of the catalog" */
  label?: string;
  children?: ReactNode;
}

export default function Splitter({
  orientation,
  onDrag,
  onReset,
  onStep,
  className,
  title,
  label,
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
  const [back, forward] =
    orientation === "vertical" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  return (
    // biome-ignore lint/a11y/useSemanticElements: an hr cannot hold the buttons shown in a collapsed splitter
    <div
      className={`splitter splitter-${orientation} ${className ?? ""}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={0}
      tabIndex={onStep ? 0 : -1}
      onPointerDown={start}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === back) onStep?.(-1);
        else if (e.key === forward) onStep?.(1);
        else if (e.key === "Enter") onReset?.();
        else return;
        // Not keys of the plan (the arrows would move the selection there)
        e.preventDefault();
        e.stopPropagation();
      }}
      title={title}
    >
      {children}
    </div>
  );
}
