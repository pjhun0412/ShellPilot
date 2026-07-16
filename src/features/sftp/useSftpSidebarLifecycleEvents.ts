import { useEffect } from 'react';

import {
  subscribeSftpSidebarDisconnect,
  subscribeSftpSidebarNavigation,
  subscribeSftpSidebarReconnect,
} from './sftpSidebarState';

export function useSftpSidebarLifecycleEvents({
  connectionState,
  connectSftp,
  loadDirectory,
  onDisconnect,
  panelId,
  sessionConnectionKey,
}: {
  connectionState: string;
  connectSftp: () => Promise<void>;
  loadDirectory: (path?: string) => Promise<boolean>;
  onDisconnect: () => void;
  panelId: string;
  sessionConnectionKey: string;
}) {
  useEffect(() => {
    return subscribeSftpSidebarNavigation(({ panelId: targetPanelId, path: targetPath }) => {
      if (targetPanelId !== panelId) {
        return;
      }

      void loadDirectory(targetPath);
    });
  }, [loadDirectory, panelId]);

  useEffect(() => {
    return subscribeSftpSidebarReconnect(({ panelId: targetPanelId }) => {
      if (targetPanelId !== panelId) {
        return false;
      }

      if (connectionState === 'connecting') {
        return true;
      }

      void connectSftp();
      return true;
    });
  }, [connectSftp, connectionState, panelId, sessionConnectionKey]);

  useEffect(() => {
    return subscribeSftpSidebarDisconnect(({ panelId: targetPanelId }) => {
      if (targetPanelId !== panelId) {
        return;
      }

      onDisconnect();
    });
  }, [onDisconnect, panelId]);
}
