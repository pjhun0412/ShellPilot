import { useEffect, useLayoutEffect } from 'react';

import type { SessionItem } from '@/types/workspace';
import {
  clearSftpAiContextSnapshot,
  publishSftpAiContextSnapshot,
} from './sftpAiContext';
import { publishSftpSidebarPanelState, type SftpSidebarTransferSummary } from './sftpSidebarState';
import type { SftpEntry } from './sftpBridge';
import { mapSftpConnectionStateToStatus, type SftpConnectionState } from './sftpPanelUtils';
import type { SftpViewMode } from './sftpPanelTypes';

export function useSftpPanelPublishing({
  connectionState,
  entries,
  isLoading,
  localPath,
  panelId,
  path,
  selectedEntries,
  session,
  showHiddenEntries,
  transferSummary,
  visibleEntries,
  viewMode,
}: {
  connectionState: SftpConnectionState;
  entries: SftpEntry[];
  isLoading: boolean;
  localPath?: string;
  panelId: string;
  path: string;
  selectedEntries: SftpEntry[];
  session: SessionItem;
  showHiddenEntries: boolean;
  transferSummary: SftpSidebarTransferSummary;
  visibleEntries: SftpEntry[];
  viewMode: SftpViewMode;
}) {
  useLayoutEffect(() => {
    publishSftpSidebarPanelState(panelId, {
      host: session.host,
      localPath,
      path,
      port: session.port,
      status: mapSftpConnectionStateToStatus(connectionState),
      title: session.name,
      transferSummary,
      username: session.username,
      viewMode,
    });
  }, [connectionState, localPath, panelId, path, session.host, session.name, session.port, session.username, transferSummary, viewMode]);

  useEffect(() => {
    publishSftpAiContextSnapshot(panelId, {
      connectionState,
      entries: visibleEntries,
      host: session.host,
      isLoading,
      path,
      selectedEntries,
      sessionName: session.name,
      showHiddenEntries,
      totalEntryCount: entries.length,
      username: session.username,
      visibleEntryCount: visibleEntries.length,
    });
  }, [
    connectionState,
    entries.length,
    isLoading,
    panelId,
    path,
    selectedEntries,
    session.host,
    session.name,
    session.username,
    showHiddenEntries,
    visibleEntries,
  ]);

  useEffect(() => {
    return () => {
      clearSftpAiContextSnapshot(panelId);
    };
  }, [panelId]);
}
