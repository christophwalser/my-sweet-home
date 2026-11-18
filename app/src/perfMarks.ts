// Marks of a performance run (see perf.ts). Outside a run a mark costs one comparison.

type Mark = [name: string, at: number];

export const perfState = {
  on: false,
  /** Changes of the home the window received since it started */
  events: 0,
  marks: [] as Mark[],
  /** Called when the window applied a new state of the home */
  applied: null as (() => void) | null,
  /** Numbers of the 3D view of the last frame (set by the view) */
  scene: null as Record<string, number> | null,
};

/** Whether a performance run is going on (the 3D view then waits for the graphics card). */
export function perfOn(): boolean {
  return perfState.on;
}

/** Notes when a stage was reached; nothing outside a performance run. */
export function perfMark(name: string): void {
  if (name === "event") perfState.events++;
  if (!perfState.on) return;
  perfState.marks.push([name, performance.now()]);
  if (name === "applied") perfState.applied?.();
}

export function perfScene(info: Record<string, number>): void {
  if (perfState.on) perfState.scene = info;
}
