// Questions of the app in its own dialogs: a confirmation, a choice, one line of text or a notice.
// They replace the windows of the browser and of Windows, which look foreign and cannot be styled
// or translated.

import { create } from "zustand";
import { t } from "../i18n";

/** A button that answers the question, named after what it does ("Delete"). */
export type AskButton = {
  id: string;
  label: string;
  /** It goes on with something that takes away data */
  danger?: boolean;
};

type Question = {
  title: string;
  message?: string;
  /** The first one has the focus */
  buttons: AskButton[];
  /** Text of the button that cancels; null: there is nothing to cancel */
  cancel: string | null;
  /** Asks for a text: the label of its field and the text it starts with */
  input?: { label: string; value: string };
};

type Answer = { id: string; text: string } | null;

type Open = Question & {
  /** The chosen button with the text typed, or null when cancelled */
  answer: (answer: Answer) => void;
};

export const useAsk = create<{ open: Open | null }>(() => ({ open: null }));

function ask(question: Question): Promise<Answer> {
  // Only one question at a time: the one before counts as cancelled
  useAsk.getState().open?.answer(null);
  return new Promise((resolve) => {
    const open: Open = {
      ...question,
      answer: (answer) => {
        if (useAsk.getState().open === open) useAsk.setState({ open: null });
        resolve(answer);
      },
    };
    useAsk.setState({ open });
  });
}

type Confirm = { title: string; message?: string; confirm: string; danger?: boolean };

/** Asks whether to go on. */
export async function askConfirm({ title, message, confirm, danger }: Confirm): Promise<boolean> {
  const buttons = [{ id: "ok", label: confirm, danger }];
  return (await ask({ title, message, buttons, cancel: t("Cancel") })) !== null;
}

/** Asks for a text without spaces around it; null when cancelled or left empty. */
export async function askText(
  question: Confirm & { label: string; value?: string },
): Promise<string | null> {
  const { title, message, confirm, danger, label, value } = question;
  const answer = await ask({
    title,
    message,
    buttons: [{ id: "ok", label: confirm, danger }],
    cancel: t("Cancel"),
    input: { label, value: value ?? "" },
  });
  const text = answer?.text.trim();
  return text ? text : null;
}

/** Asks what to do; the ID of the chosen button, or null when cancelled. */
export async function askChoice(question: {
  title: string;
  message?: string;
  buttons: AskButton[];
  cancel: string;
}): Promise<string | null> {
  return (await ask(question))?.id ?? null;
}

/** Tells something; resolves when the user has closed it. */
export async function tell(title: string, message: string): Promise<void> {
  await ask({ title, message, buttons: [{ id: "ok", label: t("OK") }], cancel: null });
}
