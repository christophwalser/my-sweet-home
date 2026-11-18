// Messages of the window: errors stay until they are closed, notices of success leave after a
// few seconds, and both are kept in a list the status bar shows, so a message that went by
// can be read again.

import { create } from "zustand";

export type Message = { id: number; kind: "error" | "notice"; text: string; at: Date };

/** Number of messages the list keeps. */
export const MAX_MESSAGES = 30;

/** The list with a new message in front; the oldest ones drop out. */
export function withMessage(log: Message[], message: Message, max = MAX_MESSAGES): Message[] {
  return [message, ...log].slice(0, max);
}

let nextId = 1;

export const useMessages = create<{
  log: Message[];
  add: (kind: Message["kind"], text: string) => void;
  clear: () => void;
}>((set, get) => ({
  log: [],
  add: (kind, text) =>
    set({ log: withMessage(get().log, { id: nextId++, kind, text, at: new Date() }) }),
  clear: () => set({ log: [] }),
}));
