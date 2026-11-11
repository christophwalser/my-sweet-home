// Moves of the selection with the arrow keys: at most one move command runs at a time; key
// presses meanwhile add up and are sent as one move when it is done.

export type NudgeQueue = {
  /** A move command is running */
  busy: boolean;
  /** Elements and distance waiting for the running move */
  ids: string[];
  dx: number;
  dy: number;
};

export type Move = { ids: string[]; dx: number; dy: number };

export function newNudgeQueue(): NudgeQueue {
  return { busy: false, ids: [], dx: 0, dy: 0 };
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * A key press: returns the move to send now, or null when it waits for the running one. A
 * press for other elements than the waiting ones replaces them (the selection changed).
 */
export function queueNudge(q: NudgeQueue, ids: string[], dx: number, dy: number): Move | null {
  if (!q.busy) {
    q.busy = true;
    return { ids, dx, dy };
  }
  if (!sameIds(q.ids, ids)) {
    q.ids = ids;
    q.dx = 0;
    q.dy = 0;
  }
  q.dx += dx;
  q.dy += dy;
  return null;
}

/** The running move is done: returns the waiting move to send next, or null. */
export function nudgeDone(q: NudgeQueue): Move | null {
  if (q.dx === 0 && q.dy === 0) {
    q.busy = false;
    q.ids = [];
    return null;
  }
  const move = { ids: q.ids, dx: q.dx, dy: q.dy };
  q.dx = 0;
  q.dy = 0;
  return move;
}
