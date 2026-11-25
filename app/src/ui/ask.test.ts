import { afterEach, describe, expect, it } from "vitest";
import { askConfirm, askText, useAsk } from "./ask";

const answer = (text: string | null) => useAsk.getState().open?.answer(text);

afterEach(() => useAsk.setState({ open: null }));

describe("askConfirm", () => {
  it("is true when the user goes on and closes the question", async () => {
    const asked = askConfirm({ title: "Delete?", confirm: "Delete" });
    expect(useAsk.getState().open?.title).toBe("Delete?");
    answer("");
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
    answer("");
    expect(await second).toBe(true);
  });
});

describe("askText", () => {
  it("gives the text without spaces around it", async () => {
    const asked = askText({ title: "New", label: "Name", value: "Old", confirm: "Create" });
    expect(useAsk.getState().open?.input).toEqual({ label: "Name", value: "Old" });
    answer("  Shop ");
    expect(await asked).toBe("Shop");
  });

  it("is null for an empty text and when cancelled", async () => {
    const empty = askText({ title: "New", label: "Name", confirm: "Create" });
    answer("   ");
    expect(await empty).toBeNull();
    const cancelled = askText({ title: "New", label: "Name", confirm: "Create" });
    answer(null);
    expect(await cancelled).toBeNull();
  });
});
