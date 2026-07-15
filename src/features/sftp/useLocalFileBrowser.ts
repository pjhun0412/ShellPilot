import { useCallback, useEffect, useMemo, useState } from 'react';

import { listLocalDirectory, listLocalRoots, type LocalFileEntry, type LocalRootEntry } from './sftpBridge';

export function useLocalFileBrowser({ enabled }: { enabled: boolean }) {
  const [entries, setEntries] = useState<LocalFileEntry[]>([]);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [path, setPath] = useState('');
  const [roots, setRoots] = useState<LocalRootEntry[]>([]);
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<string[]>([]);

  const parentPath = useMemo(() => getLocalParentPath(path), [path]);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedEntryPaths.includes(entry.path)),
    [entries, selectedEntryPaths],
  );

  const loadDirectory = useCallback(async (nextPath?: string) => {
    if (!enabled && !nextPath) {
      return;
    }

    setIsLoading(true);
    setError(undefined);

    try {
      const result = await listLocalDirectory(nextPath);

      setEntries(result.entries);
      setPath(result.path);
      setSelectedEntryPaths([]);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

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

  return {
    entries,
    error,
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
