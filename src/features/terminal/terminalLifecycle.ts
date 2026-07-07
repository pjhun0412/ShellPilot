type TerminalClosingListener = (panelId: string) => void;
type TerminalReconnectListener = (panelId: string) => void;

const closingListeners = new Set<TerminalClosingListener>();
const reconnectListeners = new Set<TerminalReconnectListener>();

export function notifyTerminalClosing(panelId: string) {
  closingListeners.forEach((listener) => listener(panelId));
}

export function subscribeTerminalClosing(listener: TerminalClosingListener) {
  closingListeners.add(listener);

  return () => {
    closingListeners.delete(listener);
  };
}

export function notifyTerminalReconnect(panelId: string) {
  reconnectListeners.forEach((listener) => listener(panelId));
}

export function subscribeTerminalReconnect(listener: TerminalReconnectListener) {
  reconnectListeners.add(listener);

  return () => {
    reconnectListeners.delete(listener);
  };
}
