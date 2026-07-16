import { useEffect, useLayoutEffect } from 'react';

import type { SessionItem } from '@/types/workspace';
import {
  clearSftpAiContextSnapshot,
  publishSftpAiContextSnapshot,
} from './sftpAiContext';
import { publishSftpSidebarPanelState, type SftpSidebarTransferSummary } from './sftpSidebarState';
import type { SftpEntry } from './sftpBridge';
import { mapSftpConnectionStateToStatus, type SftpConnectionState } from './sftpPanelUtils';

export function useSftpPanelPublishing({
  connectionState,
  entries,
  isLoading,
  panelId,
  path,
  selectedEntries,
  session,
  showHiddenEntries,
  transferSummary,
  visibleEntries,
}: {
  connectionState: SftpConnectionState;
  entries: SftpEntry[];
  isLoading: boolean;
  panelId: string;
  path: string;
  selectedEntries: SftpEntry[];
  session: SessionItem;
  showHiddenEntries: boolean;
  transferSummary: SftpSidebarTransferSummary;
  visibleEntries: SftpEntry[];
}) {
  useLayoutEffect(() => {
    publishSftpSidebarPanelState(panelId, {
      host: session.host,
      path,
      port: session.port,
      status: mapSftpConnectionStateToStatus(connectionState),
      title: session.name,
      transferSummary,
      username: session.username,
    });
  }, [connectionState, panelId, path, session.host, session.name, session.port, session.username, transferSummary]);

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
