// Performance run of the real app (scripts/perf.ps1). Started with the environment variable
// MSH_PERF_OUT, the window runs typical edits through the same path as the user's actions
// (command in the core, new state sent to the window, plan and 3D view updated) and writes how
// long every stage took to that file. Without the variable the marks cost one comparison.

import { invoke } from "@tauri-apps/api/core";
import { api } from "./api";
import { useLayoutStore } from "./layout/layout";
import { forEachPiece, type Home } from "./model";
import { perfState as state } from "./perfMarks";
import { useStore } from "./store";
import { waitForModels } from "./view3d/models";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

type Step = { name: string; select: string | null; run: (i: number) => [string, object] | null };

function steps(home: Home, level: string | null): Step[] {
  const onLevel = (l: string | null) => home.levels.length === 0 || l === level;
  const wall =
    home.walls.find(
      (w) => onLevel(w.attrs.level) && w.attrs.wall_at_start && w.attrs.wall_at_end,
    ) ?? home.walls.find((w) => onLevel(w.attrs.level));
  let piece: { id: string; width: number } | null = null;
  forEachPiece(home.furniture, (p) => {
    if (!piece && p.attrs.id && p.attrs.model && p.kind === "Piece" && onLevel(p.attrs.level)) {
      piece = { id: p.attrs.id, width: p.attrs.width };
    }
  });
  const room = home.rooms.find((r) => r.attrs.id && onLevel(r.attrs.level));
  const sign = (i: number) => (i % 2 === 0 ? 1 : -1);
  const p = piece as { id: string; width: number } | null;
  const out: Step[] = [];
  if (wall) {
    const id = wall.attrs.id;
    out.push({
      name: "move a wall",
      select: id,
      run: (i) => ["edit_move", { ids: [id], dx: 10 * sign(i), dy: 0 }],
    });
    out.push({
      name: "color a wall side",
      select: id,
      run: (i) => ["wall_update", { id, left_side_color: i % 2 ? "#aabbcc" : "#ccbbaa" }],
    });
  }
  if (p) {
    out.push({
      name: "move a piece of furniture",
      select: p.id,
      run: (i) => ["edit_move", { ids: [p.id], dx: 10 * sign(i), dy: 0 }],
    });
    out.push({
      name: "resize a piece of furniture",
      select: p.id,
      run: (i) => ["furniture_update", { id: p.id, width: p.width + (i % 2 ? 0 : 5) }],
    });
  }
  if (room?.attrs.id) {
    const id = room.attrs.id;
    out.push({
      name: "color a floor",
      select: id,
      run: (i) => ["room_update", { id, floor_color: i % 2 ? "#ddccbb" : "#bbccdd" }],
    });
  }
  out.push({ name: "undo", select: null, run: () => ["edit_undo", {}] });
  out.push({ name: "redo", select: null, run: () => ["edit_redo", {}] });
  return out;
}

function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return Math.round(v[Math.floor(v.length / 2)] * 10) / 10;
}

/** Runs the scenario if the app was started for it; ends the app when it is done. */
export async function runPerfIfAsked(): Promise<void> {
  const out = await invoke<string | null>("perf_out").catch(() => null);
  if (!out) return;
  const report: Record<string, unknown> = { started: new Date().toISOString() };
  // Written as the run goes on, so a run that hangs shows where
  const progress = (stage: string) =>
    invoke("perf_write", { text: JSON.stringify({ ...report, stage }, null, 2), done: false });
  await progress("started");
  let restoreLayout = () => {};
  const errors: string[] = [];
  window.addEventListener("error", (e) =>
    errors.push(`error: ${e.message} @ ${e.filename}:${e.lineno}`),
  );
  window.addEventListener("unhandledrejection", (e) =>
    errors.push(`rejection: ${String(e.reason)}`),
  );
  const origError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(
      `console.error: ${args
        .map((x) => String(x))
        .join(" ")
        .slice(0, 600)}`,
    );
    origError(...args);
  };
  try {
    // The home passed on the command line, with all its models and pictures loaded
    for (let i = 0; i < 400 && !useStore.getState().opened?.path; i++) await sleep(50);
    const opened = useStore.getState().opened;
    if (!opened) throw new Error("no home was opened");
    // Plan, 3D view and both side panels visible, as while working; put back afterwards
    const { update: _, ...layoutBefore } = useLayoutStore.getState();
    restoreLayout = () => useLayoutStore.getState().update(layoutBefore);
    useLayoutStore
      .getState()
      .update({ maximized: null, split: 0.5, leftHidden: false, rightHidden: false });
    const loadStart = performance.now();
    await progress("home open, waiting for the models");
    await sleep(1500);
    await waitForModels(60000);
    await sleep(2500);
    report.loadMs = Math.round(performance.now() - loadStart);
    let pieces = 0;
    forEachPiece(opened.home.furniture, () => pieces++);
    report.home = {
      path: opened.path,
      walls: opened.home.walls.length,
      rooms: opened.home.rooms.length,
      pieces,
      levels: opened.home.levels.length,
    };
    report.window = [window.innerWidth, window.innerHeight, devicePixelRatio];
    report.visible = [document.visibilityState, document.hasFocus(), state.events];
    state.on = true;
    await invoke("perf_backend");
    // A call to the backend and back while the window is idle: the floor of every command
    const trips: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      await invoke("perf_out");
      trips.push(performance.now() - t);
      await sleep(20);
    }
    report.roundtripMs = median(trips);
    const rounds = 12;
    const results: unknown[] = [];
    await progress("running the steps");
    for (const step of steps(opened.home, useStore.getState().selectedLevel)) {
      useStore.getState().setSelection(step.select ? [step.select] : []);
      await sleep(400);
      const rows: Record<string, number>[] = [];
      for (let i = 0; i < rounds; i++) {
        const call = step.run(i);
        if (!call) continue;
        state.marks = [];
        const applied = new Promise<void>((r) => {
          state.applied = r;
        });
        const t0 = performance.now();
        await api.execute(call[0], call[1] as Record<string, unknown>);
        const result = performance.now();
        await Promise.race([applied, sleep(3000)]);
        await frame();
        const paint = performance.now();
        await frame();
        const painted = performance.now();
        // Later work (the 3D view draws in its own frame) still belongs to this change
        await sleep(350);
        const last = (name: string) => {
          const found = state.marks.filter(([n]) => n === name);
          return found.length ? found[found.length - 1][1] - t0 : Number.NaN;
        };
        const first = (name: string) => {
          const found = state.marks.find(([n]) => n === name);
          return found ? found[1] - t0 : Number.NaN;
        };
        const count = (name: string) => state.marks.filter(([n]) => n === name).length;
        const backend = (await invoke<Record<string, number>[]>("perf_backend"))[0] ?? {};
        rows.push({
          // The command came back / the new state arrived / it is in the store
          result: result - t0,
          event: first("event"),
          applied: first("applied"),
          // React and the plan are done / the 3D scene is rebuilt / the 3D view is drawn
          commit: last("commit"),
          planDrawn: last("plan-draw"),
          build3dStart: first("3d-build-start"),
          build3dEnd: last("3d-build-end"),
          render3d: last("3d-render"),
          // The frame that shows the plan starts / is over
          paintStart: paint - t0,
          painted: painted - t0,
          commits: count("commit"),
          planDraws: count("plan-draw"),
          builds3d: count("3d-build-end"),
          renders3d: count("3d-render"),
          // When the core started and ended the command, on the clock of the window
          coreStart: (backend.start_ms ?? Number.NaN) - (performance.timeOrigin + t0),
          coreEnd: (backend.end_ms ?? Number.NaN) - (performance.timeOrigin + t0),
          coreRun: (backend.run_us ?? Number.NaN) / 1000,
          coreView: (backend.view_us ?? Number.NaN) / 1000,
          coreEmit: (backend.emit_us ?? Number.NaN) / 1000,
          bytes: backend.bytes ?? Number.NaN,
        });
      }
      // The first rounds warm up caches
      const used = rows.slice(2);
      const keys = Object.keys(rows[0] ?? {});
      report.steps = results;
      await progress(`done: ${step.name}`);
      results.push({
        step: step.name,
        rounds: used.length,
        median: Object.fromEntries(keys.map((k) => [k, median(used.map((r) => r[k]))])),
        worst: Object.fromEntries(
          ["applied", "commit", "painted", "render3d"].map((k) => [
            k,
            Math.round(Math.max(...used.map((r) => r[k]).filter(Number.isFinite))),
          ]),
        ),
      });
    }
    report.steps = results;
    report.scene = state.scene;
    report.eventsSeen = state.events;
    report.modified = useStore.getState().opened?.modified;
  } catch (e) {
    report.error = String(e);
  }
  state.on = false;
  report.errors = errors;
  report.alive = !!document.querySelector(".shell");
  restoreLayout();
  await invoke("perf_write", { text: JSON.stringify(report, null, 2), done: true });
}
