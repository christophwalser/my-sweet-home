// 3D view in its own window, and the UI state shared between the windows.

import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useStore, type ViewMode } from "../store";
import type { CameraPose } from "../view3d/camera";

export const VIEW3D_WINDOW = "view3d";
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
}

/** The 3D window if it is open. */
export function findView3DWindow(): Promise<WebviewWindow | null> {
  return WebviewWindow.getByLabel(VIEW3D_WINDOW);
}

/** Opens (or focuses) the 3D window; `onClosed` runs when it is closed. */
export async function openView3DWindow(onClosed: () => void): Promise<void> {
  const existing = await findView3DWindow();
  if (existing) {
    await existing.setFocus();
    void existing.once("tauri://destroyed", onClosed);
    return;
  }
  const win = new WebviewWindow(VIEW3D_WINDOW, {
    url: `index.html${VIEW3D_HASH}`,
    title: "3D view - My Sweet Home",
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
    void emit(UI_STATE_EVENT, {
      from: self,
      selectedLevel: s.selectedLevel,
      viewMode: s.viewMode,
      visitorPose: s.visitorPose,
    } satisfies UiState);
  };
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (
      !applying &&
      (s.selectedLevel !== prev.selectedLevel ||
        s.viewMode !== prev.viewMode ||
        s.visitorPose !== prev.visitorPose)
    ) {
      send();
    }
  });
  const unlisten = listen<UiState>(UI_STATE_EVENT, (e) => {
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
    });
    applying = false;
  });
  if (requestInitial) {
    void unlisten.then(() => emit(UI_STATE_EVENT, { from: self, request: true } satisfies UiState));
  }
  return () => {
    unsubscribe();
    void unlisten.then((off) => off());
  };
}
