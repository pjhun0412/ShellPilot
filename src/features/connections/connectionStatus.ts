export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed';

const connectionStatusEventName = 'shellpilot:connection-status';

export interface ConnectionStatusDetail {
  panelId: string;
  status: ConnectionStatus;
}

export function publishConnectionStatus(detail: ConnectionStatusDetail) {
  window.dispatchEvent(new CustomEvent<ConnectionStatusDetail>(connectionStatusEventName, { detail }));
}

export function subscribeConnectionStatus(listener: (detail: ConnectionStatusDetail) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<ConnectionStatusDetail>).detail);
  };

  window.addEventListener(connectionStatusEventName, handler);
  return () => window.removeEventListener(connectionStatusEventName, handler);
}
