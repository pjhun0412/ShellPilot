type VncDisconnectListener = (panelId: string) => boolean | void;
type VncReconnectListener = (panelId: string) => boolean | void;

const disconnectListeners = new Set<VncDisconnectListener>();
const reconnectListeners = new Set<VncReconnectListener>();
const pendingDisconnectPanelIds = new Set<string>();
const pendingReconnectPanelIds = new Set<string>();

export function requestVncDisconnect(panelId: string) {
  pendingReconnectPanelIds.delete(panelId);
  let delivered = false;

  disconnectListeners.forEach((listener) => {
    delivered = listener(panelId) === true || delivered;
  });

  if (!delivered) {
    pendingDisconnectPanelIds.add(panelId);
  }
}

export function subscribeVncDisconnect(listener: VncDisconnectListener) {
  disconnectListeners.add(listener);
  pendingDisconnectPanelIds.forEach((panelId) => {
    if (listener(panelId) === true) {
      pendingDisconnectPanelIds.delete(panelId);
    }
  });

  return () => {
    disconnectListeners.delete(listener);
  };
}

export function requestVncReconnect(panelId: string) {
  pendingDisconnectPanelIds.delete(panelId);
  let delivered = false;

  reconnectListeners.forEach((listener) => {
    delivered = listener(panelId) === true || delivered;
  });

  if (!delivered) {
    pendingReconnectPanelIds.add(panelId);
  }
}

export function subscribeVncReconnect(listener: VncReconnectListener) {
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

