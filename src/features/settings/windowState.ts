import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';

const windowStateStorageKey = 'shellpilot.windowState.v2';
const minWindowWidth = 960;
const minWindowHeight = 640;

interface StoredWindowState {
  height: number;
  maximized: boolean;
  updatedAt: number;
  width: number;
  x: number;
  y: number;
}

export function initializeWindowStatePersistence() {
  const appWindow = getCurrentWindow();
  let saveTimer: number | undefined;
  let canPersist = false;
  let isDisposed = false;
  const unlistenCallbacks: Array<() => void> = [];

  const saveSoon = () => {
    if (isDisposed || !canPersist) {
      return;
    }

    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void saveCurrentWindowState();
    }, 250);
  };

  void restoreWindowState()
    .catch(() => undefined)
    .finally(async () => {
      await appWindow.show().catch(() => undefined);

      if (isDisposed) {
        return;
      }

      canPersist = true;
      void appWindow.onResized(saveSoon).then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }

        unlistenCallbacks.push(unlisten);
      });
      void appWindow.onMoved(saveSoon).then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }

        unlistenCallbacks.push(unlisten);
      });
    });

  const saveBeforeUnload = () => {
    if (canPersist) {
      void saveCurrentWindowState();
    }
  };

  window.addEventListener('beforeunload', saveBeforeUnload);

  return () => {
    isDisposed = true;
    window.clearTimeout(saveTimer);
    window.removeEventListener('beforeunload', saveBeforeUnload);
    for (const unlisten of unlistenCallbacks) {
      unlisten();
    }
  };
}

async function restoreWindowState() {
  const state = loadStoredWindowState();

  if (!state) {
    return;
  }

  const appWindow = getCurrentWindow();
  const safeState = normalizeWindowState(state);

  if (!(await isWindowStateVisible(safeState))) {
    return;
  }

  await appWindow.setSize(new PhysicalSize(safeState.width, safeState.height));
  await appWindow.setPosition(new PhysicalPosition(safeState.x, safeState.y));

  if (safeState.maximized) {
    await appWindow.maximize();
  }
}

async function saveCurrentWindowState() {
  const appWindow = getCurrentWindow();
  const [position, size, maximized] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.innerSize(),
    appWindow.isMaximized(),
  ]);

  saveStoredWindowState({
    height: size.height,
    maximized,
    updatedAt: Date.now(),
    width: size.width,
    x: position.x,
    y: position.y,
  });
}

function loadStoredWindowState(): StoredWindowState | undefined {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(windowStateStorageKey) ?? 'null') as Partial<StoredWindowState> | null;

    if (!parsed) {
      return undefined;
    }

    if (
      typeof parsed.x !== 'number' ||
      typeof parsed.y !== 'number' ||
      typeof parsed.width !== 'number' ||
      typeof parsed.height !== 'number'
    ) {
      return undefined;
    }

    return {
      height: parsed.height,
      maximized: Boolean(parsed.maximized),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      width: parsed.width,
      x: parsed.x,
      y: parsed.y,
    };
  } catch {
    return undefined;
  }
}

function saveStoredWindowState(state: StoredWindowState) {
  window.localStorage.setItem(windowStateStorageKey, JSON.stringify(normalizeWindowState(state)));
}

function normalizeWindowState(state: StoredWindowState): StoredWindowState {
  return {
    ...state,
    height: Math.max(Math.round(state.height), minWindowHeight),
    width: Math.max(Math.round(state.width), minWindowWidth),
    x: Math.round(state.x),
    y: Math.round(state.y),
  };
}

async function isWindowStateVisible(state: StoredWindowState) {
  try {
    const monitors = await availableMonitors();

    return monitors.some((monitor) => {
      const monitorLeft = monitor.position.x;
      const monitorTop = monitor.position.y;
      const monitorRight = monitorLeft + monitor.size.width;
      const monitorBottom = monitorTop + monitor.size.height;
      const windowRight = state.x + state.width;
      const windowBottom = state.y + state.height;

      return state.x < monitorRight && windowRight > monitorLeft && state.y < monitorBottom && windowBottom > monitorTop;
    });
  } catch {
    return true;
  }
}
