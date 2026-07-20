import type { ConnectionStatus } from '@/features/connections/connectionStatus';
import type { SessionItem } from '@/types/workspace';
import type { SftpViewMode } from './sftpPanelTypes';

export interface SftpSidebarExplorer {
  host?: string;
  panelId: string;
  port?: number;
  session?: SessionItem;
  title: string;
  username?: string;
}

export interface SftpSidebarTransferSummary {
  canceled: number;
  completed: number;
  failed: number;
  running: number;
  total: number;
}

export interface SftpSidebarPanelState {
  host?: string;
  localPath?: string;
  path?: string;
  port?: number;
  status?: ConnectionStatus;
  title?: string;
  transferSummary?: SftpSidebarTransferSummary;
  username?: string;
  viewMode?: SftpViewMode;
}

const stateEventName = 'shellpilot:sftp-sidebar-state';
const navigateEventName = 'shellpilot:sftp-navigate';
const localNavigateEventName = 'shellpilot:sftp-local-navigate';
const addBookmarkEventName = 'shellpilot:sftp-add-bookmark';
const addLocalFavoriteEventName = 'shellpilot:sftp-add-local-favorite';
const reconnectEventName = 'shellpilot:sftp-reconnect';
const disconnectEventName = 'shellpilot:sftp-disconnect';
const panelStates = new Map<string, SftpSidebarPanelState>();
const pendingReconnectPanelIds = new Set<string>();

export function publishSftpSidebarPanelState(panelId: string, state: SftpSidebarPanelState) {
  panelStates.set(panelId, {
    ...panelStates.get(panelId),
    ...state,
  });
  emitSftpSidebarState();
}

export function removeSftpSidebarPanelState(panelId: string) {
  panelStates.delete(panelId);
  emitSftpSidebarState();
}

export function getSftpSidebarPanelStates() {
  return Object.fromEntries(panelStates.entries());
}

export function subscribeSftpSidebarPanelStates(
  listener: (states: Record<string, SftpSidebarPanelState>) => void,
) {
  const handler = () => listener(getSftpSidebarPanelStates());

  window.addEventListener(stateEventName, handler);
  listener(getSftpSidebarPanelStates());

  return () => window.removeEventListener(stateEventName, handler);
}

export function requestSftpSidebarNavigation(panelId: string, path: string) {
  window.dispatchEvent(
    new CustomEvent<SftpNavigateDetail>(navigateEventName, {
      detail: { panelId, path },
    }),
  );
}

export function subscribeSftpSidebarNavigation(listener: (detail: SftpNavigateDetail) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SftpNavigateDetail>).detail);
  };

  window.addEventListener(navigateEventName, handler);
  return () => window.removeEventListener(navigateEventName, handler);
}

export function requestSftpSidebarLocalNavigation(panelId: string, path: string) {
  window.dispatchEvent(
    new CustomEvent<SftpNavigateDetail>(localNavigateEventName, {
      detail: { panelId, path },
    }),
  );
}

export function subscribeSftpSidebarLocalNavigation(listener: (detail: SftpNavigateDetail) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SftpNavigateDetail>).detail);
  };

  window.addEventListener(localNavigateEventName, handler);
  return () => window.removeEventListener(localNavigateEventName, handler);
}

export function requestSftpSidebarBookmark(panelId: string, path?: string) {
  window.dispatchEvent(
    new CustomEvent<SftpFavoriteRequestDetail>(addBookmarkEventName, {
      detail: { panelId, path },
    }),
  );
}

export function subscribeSftpSidebarBookmark(
  listener: (detail: SftpFavoriteRequestDetail) => void,
) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SftpFavoriteRequestDetail>).detail);
  };

  window.addEventListener(addBookmarkEventName, handler);
  return () => window.removeEventListener(addBookmarkEventName, handler);
}

export function requestSftpSidebarLocalFavorite(panelId: string, path?: string) {
  window.dispatchEvent(
    new CustomEvent<SftpFavoriteRequestDetail>(addLocalFavoriteEventName, {
      detail: { panelId, path },
    }),
  );
}

export function subscribeSftpSidebarLocalFavorite(
  listener: (detail: SftpFavoriteRequestDetail) => void,
) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SftpFavoriteRequestDetail>).detail);
  };

  window.addEventListener(addLocalFavoriteEventName, handler);
  return () => window.removeEventListener(addLocalFavoriteEventName, handler);
}

export function requestSftpSidebarReconnect(panelId: string) {
  let delivered = false;
  const event = new CustomEvent<SftpReconnectDetail>(reconnectEventName, {
    cancelable: true,
    detail: { panelId },
  });

  delivered = !window.dispatchEvent(event);

  if (!delivered) {
    pendingReconnectPanelIds.add(panelId);
  }
}

export function subscribeSftpSidebarReconnect(listener: (detail: SftpReconnectDetail) => boolean | void) {
  const handler = (event: Event) => {
    if (listener((event as CustomEvent<SftpReconnectDetail>).detail) === true) {
      event.preventDefault();
    }
  };

  window.addEventListener(reconnectEventName, handler);
  pendingReconnectPanelIds.forEach((panelId) => {
    if (listener({ panelId }) === true) {
      pendingReconnectPanelIds.delete(panelId);
    }
  });

  return () => window.removeEventListener(reconnectEventName, handler);
}

export function requestSftpSidebarDisconnect(panelId: string) {
  pendingReconnectPanelIds.delete(panelId);
  window.dispatchEvent(
    new CustomEvent<SftpDisconnectDetail>(disconnectEventName, {
      detail: { panelId },
    }),
  );
}

export function subscribeSftpSidebarDisconnect(listener: (detail: SftpDisconnectDetail) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SftpDisconnectDetail>).detail);
  };

  window.addEventListener(disconnectEventName, handler);
  return () => window.removeEventListener(disconnectEventName, handler);
}

function emitSftpSidebarState() {
  window.dispatchEvent(new CustomEvent(stateEventName));
}

interface SftpNavigateDetail {
  panelId: string;
  path: string;
}

interface SftpFavoriteRequestDetail {
  panelId: string;
  path?: string;
}

interface SftpReconnectDetail {
  panelId: string;
}

interface SftpDisconnectDetail {
  panelId: string;
}
