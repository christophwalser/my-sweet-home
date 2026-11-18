// Actions of the plan view that menus, tool bar and command search trigger. The plan view
// registers them while it is shown, because they need its view transform and level.

export type PlanActions = {
  /** Zooms around the center of the plan by `factor` (> 1 zooms in) */
  zoom: (factor: number) => void;
  /** Selects all elements of the selected level */
  selectAll: () => void;
  /** Selects the elements of the level that are of the same kind as the selected ones */
  selectSimilar: () => void;
  /** Pastes the clipboard on the selected level and selects the pasted elements */
  paste: () => void;
  /** A drawing or measure is in progress (digits then type a length) */
  isDrawing: () => boolean;
};

let current: PlanActions | null = null;

/** Registers the actions of the plan view; returns a function that removes them. */
export function registerPlanActions(actions: PlanActions): () => void {
  current = actions;
  return () => {
    if (current === actions) current = null;
  };
}

/** The actions of the plan view, if it is shown. */
export function planActions(): PlanActions | null {
  return current;
}
