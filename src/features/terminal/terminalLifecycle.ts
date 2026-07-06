type TerminalClosingListener = (panelId: string) => void;

const closingListeners = new Set<TerminalClosingListener>();

export function notifyTerminalClosing(panelId: string) {
  closingListeners.forEach((listener) => listener(panelId));
}

export function subscribeTerminalClosing(listener: TerminalClosingListener) {
  closingListeners.add(listener);

  return () => {
    closingListeners.delete(listener);
  };
}
