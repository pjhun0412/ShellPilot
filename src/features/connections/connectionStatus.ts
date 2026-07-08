export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed' | 'closed' | 'restored';

const connectionStatusEventName = 'shellpilot:connection-status';
const connectionStatuses = new Map<string, ConnectionStatus>();

export interface ConnectionStatusDetail {
  panelId: string;
  status: ConnectionStatus;
}

export function publishConnectionStatus(detail: ConnectionStatusDetail) {
  connectionStatuses.set(detail.panelId, detail.status);
  window.dispatchEvent(new CustomEvent<ConnectionStatusDetail>(connectionStatusEventName, { detail }));
}

export function subscribeConnectionStatus(listener: (detail: ConnectionStatusDetail) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<ConnectionStatusDetail>).detail);
  };

  window.addEventListener(connectionStatusEventName, handler);
  connectionStatuses.forEach((status, panelId) => listener({ panelId, status }));
  return () => window.removeEventListener(connectionStatusEventName, handler);
}
