import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { normalizeSftpPathInput } from './sftpPathUtils';
import type { SftpEntry } from './sftpBridge';

export function useSftpPathActions({
  homePath,
  loadDirectory,
  path,
  selectedEntries,
  setActionMenuOpen,
}: {
  homePath: string;
  loadDirectory: (
    path?: string,
    options?: { onError?: (message: string) => void; recordHistory?: boolean },
  ) => Promise<boolean>;
  path: string;
  selectedEntries: SftpEntry[];
  setActionMenuOpen: (value: boolean | ((current: boolean) => boolean)) => void;
}) {
  const pathInputRef = useRef<HTMLInputElement>(null);
  const [isPathEditing, setIsPathEditing] = useState(false);
  const [pathDraft, setPathDraft] = useState('.');
  const [pathInputError, setPathInputError] = useState<string>();

  useEffect(() => {
    if (!isPathEditing) {
      return;
    }

    pathInputRef.current?.focus();
    pathInputRef.current?.select();
  }, [isPathEditing]);

  const beginPathEdit = useCallback(() => {
    setPathDraft(path);
    setPathInputError(undefined);
    setIsPathEditing(true);
  }, [path]);

  const cancelPathEdit = useCallback(() => {
    setPathDraft(path);
    setPathInputError(undefined);
    setIsPathEditing(false);
  }, [path]);

  const resetPathUi = useCallback(() => {
    setIsPathEditing(false);
    setPathInputError(undefined);
  }, []);

  const submitPathEdit = useCallback(async () => {
    const nextPath = pathDraft.trim();

    if (!nextPath) {
      cancelPathEdit();
      return;
    }

    setPathInputError(undefined);

    const didLoad = await loadDirectory(
      normalizeSftpPathInput(nextPath, path, homePath),
      { onError: setPathInputError },
    );

    if (didLoad) {
      setPathInputError(undefined);
      setIsPathEditing(false);
    }
  }, [cancelPathEdit, homePath, loadDirectory, path, pathDraft]);

  const copyPath = useCallback(async () => {
    setActionMenuOpen(false);
    await navigator.clipboard?.writeText(path);
  }, [path, setActionMenuOpen]);

  const copySelectedPath = useCallback(async () => {
    const targetPath = selectedEntries.length === 1 ? selectedEntries[0].path : path;
    setActionMenuOpen(false);
    await navigator.clipboard?.writeText(targetPath);
  }, [path, selectedEntries, setActionMenuOpen]);

  return {
    beginPathEdit,
    cancelPathEdit,
    copyPath,
    copySelectedPath,
    isPathEditing,
    pathDraft,
    pathInputError,
    pathInputRef: pathInputRef as RefObject<HTMLInputElement>,
    resetPathUi,
    setPathDraft,
    setPathInputError,
    submitPathEdit,
  };
}
