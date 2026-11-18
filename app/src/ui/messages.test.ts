import { describe, expect, it } from "vitest";
import { type Message, withMessage } from "./messages";

const message = (id: number): Message => ({ id, kind: "error", text: `m${id}`, at: new Date(0) });

describe("withMessage", () => {
  it("puts the new message first and drops the oldest ones", () => {
    const log = withMessage(withMessage([], message(1), 2), message(2), 2);
    expect(log.map((m) => m.id)).toEqual([2, 1]);
    expect(withMessage(log, message(3), 2).map((m) => m.id)).toEqual([3, 2]);
  });
});
