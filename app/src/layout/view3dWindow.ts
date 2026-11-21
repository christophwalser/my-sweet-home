// 3D view in its own window, and the UI state shared between the windows.

import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t } from "../i18n";
import { useStore, type ViewMode } from "../store";
import type { CameraPose } from "../view3d/camera";

/** Prefix of the labels of 3D windows ("view3d-<home window>"). */
export const VIEW3D_PREFIX = "view3d-";

/** Label of the 3D window of this home window (or of this 3D window itself). */
function view3dLabel(): string {
  const self = getCurrentWebviewWindow().label;
  return self.startsWith(VIEW3D_PREFIX) ? self : `${VIEW3D_PREFIX}${self}`;
}

/** The other window of the pair: the 3D window of a home window, or its home window. */
function partnerLabel(): string {
  const self = getCurrentWebviewWindow().label;
  return self.startsWith(VIEW3D_PREFIX) ? self.slice(VIEW3D_PREFIX.length) : view3dLabel();
}
/** Hash of the page URL that shows only the 3D view */
export const VIEW3D_HASH = "#view3d";
const UI_STATE_EVENT = "ui-state";

interface UiState {
  from: string;
  /** Asks the other windows to send their state */
  request?: boolean;
  selectedLevel?: string | null;
  viewMode?: ViewMode;
  visitorPose?: CameraPose | null;
  /** Selected elements (a click in the 3D window selects in the plan and the other way) */
  selection?: string[];
  cameraPathShown?: boolean;
}

/** The 3D window if it is open. */
export function findView3DWindow(): Promise<WebviewWindow | null> {
  return WebviewWindow.getByLabel(view3dLabel());
}

/** Opens (or focuses) the 3D window; `onClosed` runs when it is closed. */
export async function openView3DWindow(onClosed: () => void): Promise<void> {
  const existing = await findView3DWindow();
  if (existing) {
    await existing.setFocus();
    void existing.once("tauri://destroyed", onClosed);
    return;
  }
  const win = new WebviewWindow(view3dLabel(), {
    url: `index.html${VIEW3D_HASH}`,
    title: t("3D view - My Sweet Home"),
    width: 960,
    height: 680,
    minWidth: 320,
    minHeight: 240,
    dragDropEnabled: false,
  });
  void win.once("tauri://destroyed", onClosed);
  void win.once("tauri://error", onClosed);
}

export async function closeView3DWindow(): Promise<void> {
  await (await findView3DWindow())?.close();
}

/**
 * Keeps the selected level and the view mode equal in all windows. Returns a
 * function that stops the synchronization.
 */
export function syncUiState(requestInitial: boolean): () => void {
  const self = getCurrentWebviewWindow().label;
  let applying = false;
  const send = () => {
    const s = useStore.getState();
    void emitTo(partnerLabel(), UI_STATE_EVENT, {
      from: self,
      selectedLevel: s.selectedLevel,
      viewMode: s.viewMode,
      visitorPose: s.visitorPose,
      selection: s.selection,
      cameraPathShown: s.cameraPathShown,
    } satisfies UiState);
  };
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (
      !applying &&
      (s.selectedLevel !== prev.selectedLevel ||
        s.viewMode !== prev.viewMode ||
        s.visitorPose !== prev.visitorPose ||
        s.selection !== prev.selection ||
        s.cameraPathShown !== prev.cameraPathShown)
    ) {
      send();
    }
  });
  const unlisten = getCurrentWebviewWindow().listen<UiState>(UI_STATE_EVENT, (e) => {
    const p = e.payload;
    if (p.from === self) return;
    if (p.request) {
      send();
      return;
    }
    applying = true;
    useStore.setState({
      ...(p.selectedLevel !== undefined && { selectedLevel: p.selectedLevel }),
      ...(p.viewMode && { viewMode: p.viewMode }),
      ...(p.visitorPose !== undefined && { visitorPose: p.visitorPose }),
      ...(p.selection && { selection: p.selection }),
      ...(p.cameraPathShown !== undefined && { cameraPathShown: p.cameraPathShown }),
    });
    applying = false;
  });
  if (requestInitial) {
    void unlisten.then(() =>
      emitTo(partnerLabel(), UI_STATE_EVENT, { from: self, request: true } satisfies UiState),
    );
  }
  return () => {
    unsubscribe();
    void unlisten.then((off) => off());
  };
}

const VIEW3D_ACTION_EVENT = "view3d-action";

/** Actions of the menus that the separate 3D window carries out. */
export type View3DAction = "photo" | "video" | "settings3d" | "shadows" | "roofs";

/**
 * Asks the separate 3D window to open a dialog, toggle the shadows or run an action of the
 * view itself (`ViewAction` of view3dBridge), and focuses it.
 */
export async function sendView3DAction(action: string): Promise<void> {
  await emitTo(view3dLabel(), VIEW3D_ACTION_EVENT, action);
  await (await findView3DWindow())?.setFocus();
}

/** Runs the handler for the actions sent to this 3D window; returns a function that stops. */
export function listenView3DActions(handler: (action: string) => void): () => void {
  const unlisten = getCurrentWebviewWindow().listen<string>(VIEW3D_ACTION_EVENT, (e) =>
    handler(e.payload),
  );
  return () => {
    void unlisten.then((off) => off());
  };
}
