import { useCallback, useEffect, type KeyboardEvent, type MutableRefObject } from 'react';

import { isEditableShortcutTarget } from './sftpPanelUtils';

export function useSftpKeyboardShortcuts({
  enabled = true,
  isActivePanelRef,
  isLoading,
  isPathEditing,
  isRemoteReady,
  navigablePaths,
  onBeginPathEdit,
  onDelete,
  onGoBack,
  onGoForward,
  onMoveSelection,
  onOpenParent,
  onOpenSelectedPath,
  onRefresh,
  onRename,
  onSelectAll,
  onSelectEntryPath,
  parentPath,
}: {
  enabled?: boolean;
  isActivePanelRef: MutableRefObject<boolean>;
  isLoading: boolean;
  isPathEditing: boolean;
  isRemoteReady: boolean;
  navigablePaths: string[];
  onBeginPathEdit: () => void;
  onDelete: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onMoveSelection: (direction: -1 | 1, extendSelection?: boolean) => void;
  onOpenParent: (path: string) => void;
  onOpenSelectedPath: () => void;
  onRefresh: () => void;
  onRename: () => void;
  onSelectAll: () => void;
  onSelectEntryPath: (path: string) => void;
  parentPath: string | undefined;
}) {
  useEffect(() => {
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!enabled || !isActivePanelRef.current || !isRemoteReady || isPathEditing || isLoading) {
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') {
        return;
      }

      if (isEditableShortcutTarget(event.target)) {
        return;
      }

      event.preventDefault();
      onSelectAll();
    };

    document.addEventListener('keydown', handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, [enabled, isActivePanelRef, isLoading, isPathEditing, isRemoteReady, onSelectAll]);

  return useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled) {
      return;
    }

    if (!isRemoteReady) {
      return;
    }

    if (isEditableShortcutTarget(event.target)) {
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      onBeginPathEdit();
      return;
    }

    if (isPathEditing || isLoading) {
      return;
    }

    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      onGoBack();
      return;
    }

    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      onGoForward();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMoveSelection(1, event.shiftKey);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMoveSelection(-1, event.shiftKey);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      if (navigablePaths[0]) {
        onSelectEntryPath(navigablePaths[0]);
      }
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      if (navigablePaths[navigablePaths.length - 1]) {
        onSelectEntryPath(navigablePaths[navigablePaths.length - 1]);
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      onOpenSelectedPath();
      return;
    }

    if (event.key === 'Backspace' && parentPath) {
      event.preventDefault();
      onOpenParent(parentPath);
      return;
    }

    if (event.key === 'F2') {
      event.preventDefault();
      onRename();
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      onDelete();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      onSelectAll();
      return;
    }

    if (event.key === 'F5') {
      event.preventDefault();
      onRefresh();
    }
  }, [
    enabled,
    isLoading,
    isPathEditing,
    isRemoteReady,
    navigablePaths,
    onBeginPathEdit,
    onDelete,
    onGoBack,
    onGoForward,
    onMoveSelection,
    onOpenParent,
    onOpenSelectedPath,
    onRefresh,
    onRename,
    onSelectAll,
    onSelectEntryPath,
    parentPath,
  ]);
}
