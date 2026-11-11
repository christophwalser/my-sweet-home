import { describe, expect, it } from "vitest";
import { newNudgeQueue, nudgeDone, queueNudge } from "./nudge";

describe("arrow key moves", () => {
  it("sends the first press at once and adds up presses while it runs", () => {
    const q = newNudgeQueue();
    expect(queueNudge(q, ["a"], 1, 0)).toEqual({ ids: ["a"], dx: 1, dy: 0 });
    expect(queueNudge(q, ["a"], 1, 0)).toBeNull();
    expect(queueNudge(q, ["a"], 1, 0)).toBeNull();
    expect(queueNudge(q, ["a"], 0, -10)).toBeNull();
    expect(nudgeDone(q)).toEqual({ ids: ["a"], dx: 2, dy: -10 });
    expect(nudgeDone(q)).toBeNull();
    expect(q.busy).toBe(false);
    expect(queueNudge(q, ["a"], 0, 1)).toEqual({ ids: ["a"], dx: 0, dy: 1 });
  });

  it("drops waiting presses of a previous selection", () => {
    const q = newNudgeQueue();
    queueNudge(q, ["a"], 1, 0);
    queueNudge(q, ["a"], 1, 0);
    queueNudge(q, ["b"], 0, 1);
    expect(nudgeDone(q)).toEqual({ ids: ["b"], dx: 0, dy: 1 });
  });
});
