// Questions of the app in its own dialogs: a confirmation or one line of text. They replace
// window.confirm and window.prompt, which look foreign and cannot be styled or translated.

import { create } from "zustand";

type Question = {
  title: string;
  message?: string;
  /** Text of the button that goes on, named after what it does ("Delete") */
  confirm: string;
  /** The button goes on with something that takes away data */
  danger?: boolean;
  /** Asks for a text: the label of its field and the text it starts with */
  input?: { label: string; value: string };
};

type Open = Question & {
  /** The text typed (empty for a confirmation), or null when cancelled */
  answer: (text: string | null) => void;
};

export const useAsk = create<{ open: Open | null }>(() => ({ open: null }));

function ask(question: Question): Promise<string | null> {
  // Only one question at a time: the one before counts as cancelled
  useAsk.getState().open?.answer(null);
  return new Promise((resolve) => {
    const open: Open = {
      ...question,
      answer: (text) => {
        if (useAsk.getState().open === open) useAsk.setState({ open: null });
        resolve(text);
      },
    };
    useAsk.setState({ open });
  });
}

/** Asks whether to go on. */
export async function askConfirm(question: Omit<Question, "input">): Promise<boolean> {
  return (await ask(question)) !== null;
}

/** Asks for a text without spaces around it; null when cancelled or left empty. */
export async function askText(
  question: Omit<Question, "input"> & { label: string; value?: string },
): Promise<string | null> {
  const { label, value, ...rest } = question;
  const text = (await ask({ ...rest, input: { label, value: value ?? "" } }))?.trim();
  return text ? text : null;
}
