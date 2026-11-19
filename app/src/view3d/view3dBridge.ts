// Actions of the 3D view that menus, tool bar and command search trigger. The 3D view
// registers them while it is shown; if it is shown in its own window they are sent there.

import { sendView3DAction } from "../layout/view3dWindow";
import { useUi } from "../ui/uiStore";
import { STANDARD_VIEWS, type StandardView } from "./standardViews";

/** Actions the 3D view carries out itself (the others open dialogs, see `View3DAction`). */
export type ViewAction = "fit" | "zoomSelection" | "parallel" | `view:${StandardView}`;

const VIEW_ACTIONS = new Set<string>([
  "fit",
  "zoomSelection",
  "parallel",
  ...STANDARD_VIEWS.map((v) => `view:${v}`),
]);

/** Whether an action sent to the 3D window is one of the view itself. */
export function isViewAction(action: string): action is ViewAction {
  return VIEW_ACTIONS.has(action);
}

let current: ((action: ViewAction) => void) | null = null;

/** Registers the 3D view; returns a function that removes it. */
export function registerView3D(handler: (action: ViewAction) => void): () => void {
  current = handler;
  return () => {
    if (current === handler) current = null;
  };
}

/** Runs an action of the 3D view of this window (if it shows one). */
export function runViewAction(action: ViewAction): void {
  current?.(action);
}

/** Runs an action in the 3D view, wherever it is shown. */
export function view3dAction(action: ViewAction): void {
  if (useUi.getState().detached) void sendView3DAction(action);
  else runViewAction(action);
}
