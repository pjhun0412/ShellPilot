import { useCallback, useMemo } from 'react';

import type { SftpEntry } from './sftpBridge';
import {
  getSftpParentPath,
  getSftpPathSegments,
} from './sftpPathUtils';

type LoadSftpDirectory = (
  nextPath?: string,
  options?: { onError?: (message: string) => void; recordHistory?: boolean },
) => Promise<boolean>;

export function useSftpPanelNavigation({
  goBack,
  goForward,
  loadDirectory,
  path,
  saveScrollPosition,
}: {
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  loadDirectory: LoadSftpDirectory;
  path: string;
  saveScrollPosition: () => void;
}) {
  const pathSegments = useMemo(() => getSftpPathSegments(path), [path]);
  const parentPath = getSftpParentPath(path);

  const loadSftpDirectory = useCallback((
    nextPath?: string,
    options?: Parameters<LoadSftpDirectory>[1],
  ) => {
    saveScrollPosition();
    return loadDirectory(nextPath, options);
  }, [loadDirectory, saveScrollPosition]);

  const goBackWithScrollSave = useCallback(() => {
    saveScrollPosition();
    return goBack();
  }, [goBack, saveScrollPosition]);

  const goForwardWithScrollSave = useCallback(() => {
    saveScrollPosition();
    return goForward();
  }, [goForward, saveScrollPosition]);

  return {
    goBackWithScrollSave,
    goForwardWithScrollSave,
    loadSftpDirectory,
    parentPath,
    pathSegments,
  };
}

export function useSftpPanelOpenActions({
  loadSftpDirectory,
  parentEntryPathKey,
  parentPath,
  selectedEntry,
  selectedEntryPath,
}: {
  loadSftpDirectory: LoadSftpDirectory;
  parentEntryPathKey: string;
  parentPath?: string;
  selectedEntry?: SftpEntry;
  selectedEntryPath?: string;
}) {
  const openEntry = useCallback((entry: SftpEntry) => {
    if (entry.isDirectory) {
      void loadSftpDirectory(entry.path);
    }
  }, [loadSftpDirectory]);

  const openSelectedPath = useCallback(() => {
    if (selectedEntryPath === parentEntryPathKey && parentPath) {
      void loadSftpDirectory(parentPath);
      return;
    }

    if (selectedEntry?.isDirectory) {
      void loadSftpDirectory(selectedEntry.path);
    }
  }, [loadSftpDirectory, parentEntryPathKey, parentPath, selectedEntry, selectedEntryPath]);

  return {
    openEntry,
    openSelectedPath,
  };
}
