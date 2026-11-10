// Keeps an error in one part of the window (e.g. building the 3D scene) from blanking the
// whole app: the part shows the error and can be tried again.

import { Component, type ReactNode } from "react";
import { t } from "./i18n";

type Props = {
  /** What failed, for the message ("3D view") */
  name: string;
  children: ReactNode;
  /** Changing this value tries again (e.g. the home or its settings changed) */
  resetKey?: unknown;
};

type State = { error: Error | null; resetKey: unknown };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // A new home or new settings: try again
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error): void {
    console.error(`${this.props.name} failed:`, error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <strong>{t("{name} could not be shown.", { name: this.props.name })}</strong>
        <code>{error.message}</code>
        {error.stack && <pre>{error.stack.split("\n").slice(0, 6).join("\n")}</pre>}
        <button type="button" onClick={() => this.setState({ error: null })}>
          {t("Try again")}
        </button>
      </div>
    );
  }
}
