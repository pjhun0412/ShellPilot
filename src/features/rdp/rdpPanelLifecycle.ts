type RdpDisconnectListener = (panelId: string) => boolean | void;
type RdpReconnectListener = (panelId: string) => boolean | void;

const disconnectListeners = new Set<RdpDisconnectListener>();
const reconnectListeners = new Set<RdpReconnectListener>();
const pendingDisconnectPanelIds = new Set<string>();
const pendingReconnectPanelIds = new Set<string>();

export function requestRdpDisconnect(panelId: string) {
  pendingReconnectPanelIds.delete(panelId);
  let delivered = false;

  disconnectListeners.forEach((listener) => {
    delivered = listener(panelId) === true || delivered;
  });

  if (!delivered) {
    pendingDisconnectPanelIds.add(panelId);
  }
}

export function subscribeRdpDisconnect(listener: RdpDisconnectListener) {
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

export function requestRdpReconnect(panelId: string) {
  pendingDisconnectPanelIds.delete(panelId);
  let delivered = false;

  reconnectListeners.forEach((listener) => {
    delivered = listener(panelId) === true || delivered;
  });

  if (!delivered) {
    pendingReconnectPanelIds.add(panelId);
  }
}

export function subscribeRdpReconnect(listener: RdpReconnectListener) {
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
