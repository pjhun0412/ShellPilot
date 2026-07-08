type TerminalClosingListener = (panelId: string) => void;
type TerminalReconnectListener = (panelId: string) => boolean | void;

const closingListeners = new Set<TerminalClosingListener>();
const reconnectListeners = new Set<TerminalReconnectListener>();
const pendingReconnectPanelIds = new Set<string>();

export function notifyTerminalClosing(panelId: string) {
  pendingReconnectPanelIds.delete(panelId);
  closingListeners.forEach((listener) => listener(panelId));
}

export function subscribeTerminalClosing(listener: TerminalClosingListener) {
  closingListeners.add(listener);

  return () => {
    closingListeners.delete(listener);
  };
}

export function notifyTerminalReconnect(panelId: string) {
  let delivered = false;

  reconnectListeners.forEach((listener) => {
    delivered = listener(panelId) === true || delivered;
  });

  if (!delivered) {
    pendingReconnectPanelIds.add(panelId);
  }
}

export function subscribeTerminalReconnect(listener: TerminalReconnectListener) {
  reconnectListeners.add(listener);
  pendingReconnectPanelIds.forEach((panelId) => {
    if (listener(panelId) === true) {
      pendingReconnectPanelIds.delete(panelId);
    }
  });

  return () => {
    reconnectListeners.delete(listener);
  };
}
