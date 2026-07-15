import { useCallback, useEffect, useMemo, useState } from 'react';

import { appAlert, appConfirm, appPrompt } from '@/components/ui/app-dialog';
import {
  createLocalDirectory,
  listLocalDirectory,
  listLocalRoots,
  removeLocalPath,
  type LocalFileEntry,
  type LocalRootEntry,
} from './sftpBridge';
import { getAvailableFolderName, hasEntryNamed } from './sftpPanelUtils';

export function useLocalFileBrowser({ enabled }: { enabled: boolean }) {
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [path, setPath] = useState('');
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const [roots, setRoots] = useState<LocalRootEntry[]>([]);
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<string[]>([]);

  const parentPath = useMemo(() => getLocalParentPath(path), [path]);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedEntryPaths.includes(entry.path)),
    [entries, selectedEntryPaths],
  );

  const loadDirectory = useCallback(async (
    nextPath?: string,
    options: { recordHistory?: boolean } = {},
  ) => {
    if (!enabled && !nextPath) {
      return;
    }

    setIsLoading(true);
    setError(undefined);

    try {
      const result = await listLocalDirectory(nextPath);

      setEntries(result.entries);
      setPath((currentPath) => {
        if (options.recordHistory !== false && currentPath && currentPath !== result.path) {
          setBackStack((current) => [...current, currentPath]);
          setForwardStack([]);
        }

        return result.path;
      });
      setSelectedEntryPaths([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  const goBack = useCallback(async () => {
    const previousPath = backStack[backStack.length - 1];

    if (!previousPath) {
      return;
    }

    setBackStack((current) => current.slice(0, -1));
    setForwardStack((current) => path ? [path, ...current] : current);
    await loadDirectory(previousPath, { recordHistory: false });
  }, [backStack, loadDirectory, path]);

  const goForward = useCallback(async () => {
    const nextPath = forwardStack[0];

    if (!nextPath) {
      return;
    }

    setForwardStack((current) => current.slice(1));
    setBackStack((current) => path ? [...current, path] : current);
    await loadDirectory(nextPath, { recordHistory: false });
  }, [forwardStack, loadDirectory, path]);

  const loadRoots = useCallback(async () => {
    if (!enabled) {
      return;
    }

    try {
      const result = await listLocalRoots();

      setRoots(result.roots);
    } catch {
      setRoots([]);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled && !path) {
      void loadDirectory();
    }
  }, [enabled, loadDirectory, path]);

  useEffect(() => {
    if (enabled) {
      void loadRoots();
    }
  }, [enabled, loadRoots]);

  const toggleSelectedEntry = useCallback((entryPath: string, additive: boolean) => {
    setSelectedEntryPaths((current) => {
      if (!additive) {
        return [entryPath];
      }

      return current.includes(entryPath)
        ? current.filter((path) => path !== entryPath)
        : [...current, entryPath];
    });
  }, []);

  const createFolder = useCallback(async () => {
    if (!path) {
      return;
    }

    const defaultFolderName = getAvailableFolderName(entries);
    const folderName = (await appPrompt({
      confirmLabel: 'Create',
      defaultValue: defaultFolderName,
      message: 'Enter a folder name for the current local path.',
      title: 'New Local Folder',
    }))?.trim();

    if (!folderName) {
      return;
    }

    if (hasEntryNamed(entries, folderName)) {
      await appAlert({
        message: `${folderName} already exists in ${path}.`,
        title: 'Folder Already Exists',
      });
      return;
    }

    try {
      await createLocalDirectory(path, folderName);
      await loadDirectory(path);
    } catch {
      setError(`Failed to create ${folderName}. A file or folder with the same name may already exist, or you may not have permission.`);
    }
  }, [entries, loadDirectory, path]);

  const deleteSelected = useCallback(async () => {
    if (selectedEntries.length === 0) {
      return;
    }

    const confirmed = await appConfirm({
      confirmLabel: 'Delete',
      message: selectedEntries.length === 1
        ? `Delete ${selectedEntries[0].filename}?`
        : `Delete ${selectedEntries.length} selected local items?`,
      title: 'Delete Local Item',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    try {
      for (const entry of selectedEntries) {
        await removeLocalPath(entry.path);
      }

      await loadDirectory(path);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [loadDirectory, path, selectedEntries]);

  return {
    backStack,
    createFolder,
    deleteSelected,
    entries,
    error,
    forwardStack,
    goBack,
    goForward,
    isLoading,
    loadDirectory,
    parentPath,
    path,
    roots,
    selectedEntries,
    selectedEntryPaths,
    setSelectedEntryPaths,
    toggleSelectedEntry,
  };
}

function getLocalParentPath(path: string) {
  if (!path) {
    return undefined;
  }

  const normalizedPath = path.replace(/[\\/]+$/, '');
  const separatorIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'));

  if (/^[A-Za-z]:[\\/]/.test(normalizedPath) && separatorIndex === 2) {
    return normalizedPath.slice(0, 3);
  }

  if (separatorIndex <= 0) {
    return undefined;
  }

  const parentPath = normalizedPath.slice(0, separatorIndex);

  return parentPath || undefined;
}
