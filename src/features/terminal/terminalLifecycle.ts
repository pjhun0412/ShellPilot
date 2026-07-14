type TerminalClosingListener = (panelId: string) => void;
type TerminalDisconnectListener = (panelId: string) => void;
type TerminalReconnectListener = (panelId: string) => boolean | void;

const closingListeners = new Set<TerminalClosingListener>();
const disconnectListeners = new Set<TerminalDisconnectListener>();
const reconnectListeners = new Set<TerminalReconnectListener>();
const pendingReconnectPanelIds = new Set<string>();
const pendingReconnectTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const PENDING_RECONNECT_TTL_MS = 30_000;

export function notifyTerminalClosing(panelId: string) {
  clearPendingReconnect(panelId);
  closingListeners.forEach((listener) => listener(panelId));
}

export function subscribeTerminalClosing(listener: TerminalClosingListener) {
  closingListeners.add(listener);

  return () => {
    closingListeners.delete(listener);
  };
}

export function notifyTerminalDisconnect(panelId: string) {
  clearPendingReconnect(panelId);
  disconnectListeners.forEach((listener) => listener(panelId));
}

export function subscribeTerminalDisconnect(listener: TerminalDisconnectListener) {
  disconnectListeners.add(listener);

  return () => {
    disconnectListeners.delete(listener);
  };
}

export function notifyTerminalReconnect(panelId: string) {
  let delivered = false;

  reconnectListeners.forEach((listener) => {
    delivered = listener(panelId) === true || delivered;
  });

  if (delivered) {
    clearPendingReconnect(panelId);
  } else {
    queuePendingReconnect(panelId);
  }
}

export function subscribeTerminalReconnect(listener: TerminalReconnectListener) {
  reconnectListeners.add(listener);
  pendingReconnectPanelIds.forEach((panelId) => {
    if (listener(panelId) === true) {
      clearPendingReconnect(panelId);
    }
  });

  return () => {
    reconnectListeners.delete(listener);
  };
}

function queuePendingReconnect(panelId: string) {
  clearPendingReconnect(panelId);
  pendingReconnectPanelIds.add(panelId);
  pendingReconnectTimeouts.set(
    panelId,
    setTimeout(() => {
      clearPendingReconnect(panelId);
    }, PENDING_RECONNECT_TTL_MS),
  );
}

function clearPendingReconnect(panelId: string) {
  pendingReconnectPanelIds.delete(panelId);

  const timeout = pendingReconnectTimeouts.get(panelId);
  if (timeout) {
    clearTimeout(timeout);
    pendingReconnectTimeouts.delete(panelId);
  }
}
