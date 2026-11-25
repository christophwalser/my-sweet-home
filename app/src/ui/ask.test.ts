import { afterEach, describe, expect, it } from "vitest";
import { askChoice, askConfirm, askText, tell, useAsk } from "./ask";

const answer = (id: string | null, text = "") =>
  useAsk.getState().open?.answer(id === null ? null : { id, text });

afterEach(() => useAsk.setState({ open: null }));

describe("askConfirm", () => {
  it("is true when the user goes on and closes the question", async () => {
    const asked = askConfirm({ title: "Delete?", confirm: "Delete" });
    expect(useAsk.getState().open?.title).toBe("Delete?");
    answer("ok");
    expect(await asked).toBe(true);
    expect(useAsk.getState().open).toBeNull();
  });

  it("is false when the user cancels", async () => {
    const asked = askConfirm({ title: "Delete?", confirm: "Delete" });
    answer(null);
    expect(await asked).toBe(false);
  });

  it("counts as cancelled when the next question comes", async () => {
    const first = askConfirm({ title: "First", confirm: "Yes" });
    const second = askConfirm({ title: "Second", confirm: "Yes" });
    expect(await first).toBe(false);
    expect(useAsk.getState().open?.title).toBe("Second");
    answer("ok");
    expect(await second).toBe(true);
  });
});

describe("askText", () => {
  it("gives the text without spaces around it", async () => {
    const asked = askText({ title: "New", label: "Name", value: "Old", confirm: "Create" });
    expect(useAsk.getState().open?.input).toEqual({ label: "Name", value: "Old" });
    answer("ok", "  Shop ");
    expect(await asked).toBe("Shop");
  });

  it("is null for an empty text and when cancelled", async () => {
    const empty = askText({ title: "New", label: "Name", confirm: "Create" });
    answer("ok", "   ");
    expect(await empty).toBeNull();
    const cancelled = askText({ title: "New", label: "Name", confirm: "Create" });
    answer(null);
    expect(await cancelled).toBeNull();
  });
});

describe("askChoice", () => {
  const question = {
    title: "Save?",
    buttons: [
      { id: "save", label: "Save" },
      { id: "discard", label: "Don't save", danger: true },
    ],
    cancel: "Cancel",
  };

  it("gives the chosen button, or null when cancelled", async () => {
    const second = askChoice(question);
    answer("discard");
    expect(await second).toBe("discard");
    const cancelled = askChoice(question);
    answer(null);
    expect(await cancelled).toBeNull();
  });
});

describe("tell", () => {
  it("has nothing to cancel and ends either way", async () => {
    const told = tell("About", "Version 1");
    expect(useAsk.getState().open?.cancel).toBeNull();
    answer(null);
    await expect(told).resolves.toBeUndefined();
  });
});
