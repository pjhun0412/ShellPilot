import { useCallback, useEffect, useMemo, useState } from 'react';

import type { CommanderPaneVariant } from './SftpCommanderView';
import type { SftpEntry } from './sftpBridge';
import type { SftpViewMode } from './sftpPanelTypes';
import { useLocalFileBrowser } from './useLocalFileBrowser';

export function useSftpCommanderOrchestration({
  remoteEntries,
  remotePath,
  viewMode,
}: {
  remoteEntries: SftpEntry[];
  remotePath: string;
  viewMode: SftpViewMode;
}) {
  const [activePane, setActivePane] = useState<CommanderPaneVariant>('remote');
  const [remoteSelectedPaths, setRemoteSelectedPaths] = useState<string[]>([]);
  const localBrowser = useLocalFileBrowser({ enabled: viewMode === 'commander' });
  const isLocalActive = viewMode === 'commander' && activePane === 'local';
  const remoteSelectedEntries = useMemo(
    () => remoteEntries.filter((entry) => remoteSelectedPaths.includes(entry.path)),
    [remoteEntries, remoteSelectedPaths],
  );
  const toggleRemoteSelectedPath = useCallback((entryPath: string, additive: boolean) => {
    setRemoteSelectedPaths((current) => {
      if (!additive) {
        return [entryPath];
      }

      return current.includes(entryPath)
        ? current.filter((path) => path !== entryPath)
        : [...current, entryPath];
    });
  }, []);

  useEffect(() => {
    setRemoteSelectedPaths([]);
  }, [remotePath]);

  return {
    activePane,
    isLocalActive,
    localBrowser,
    remoteSelectedEntries,
    remoteSelectedPaths,
    setActivePane,
    setRemoteSelectedPaths,
    toggleRemoteSelectedPath,
  };
}
