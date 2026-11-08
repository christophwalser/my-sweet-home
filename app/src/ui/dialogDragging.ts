// Movable dialogs: dragging the header of any dialog or panel moves it. Works for all
// dialogs without changes to them, as long as they have a `.dialog-header`.

/** Part of a moved dialog that stays inside the window, in CSS pixels. */
const KEEP_VISIBLE = 80;

/** Starts moving dialogs by their header; returns a function that stops it. */
export function enableDialogDragging(): () => void {
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const header = target.closest?.(".dialog-header");
    if (!header || target.closest("button, input, select, textarea, a, label")) return;
    const box = header.closest<HTMLElement>('.dialog, [role="dialog"]');
    if (!box) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const dx0 = Number(box.dataset.dragX ?? 0);
    const dy0 = Number(box.dataset.dragY ?? 0);
    const rect = box.getBoundingClientRect();
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
    const onMove = (m: PointerEvent) => {
      // The header stays reachable: never above the window, always partly inside it
      const dx = clamp(
        dx0 + m.clientX - startX,
        dx0 - rect.left - rect.width + KEEP_VISIBLE,
        dx0 + window.innerWidth - rect.left - KEEP_VISIBLE,
      );
      const dy = clamp(
        dy0 + m.clientY - startY,
        dy0 - rect.top,
        dy0 + window.innerHeight - rect.top - KEEP_VISIBLE / 2,
      );
      box.dataset.dragX = String(dx);
      box.dataset.dragY = String(dy);
      box.style.translate = `${dx}px ${dy}px`;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("moving-dialog");
    };
    document.body.classList.add("moving-dialog");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  window.addEventListener("pointerdown", onDown);
  return () => window.removeEventListener("pointerdown", onDown);
}
