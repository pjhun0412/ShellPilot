import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from 'react';

import {
  sortCommanderEntries,
  type CommanderEntry,
  type CommanderPaneVariant,
  type CommanderSortState,
} from './sftpCommanderUtils';
import { useSftpCommanderMarqueeSelection } from './useSftpCommanderMarqueeSelection';

export function useSftpCommanderPaneSelection({
  canDelete,
  canRename,
  entries,
  isLoading,
  isPathEditing,
  onActivate,
  onDelete,
  onNavigate,
  onRefresh,
  onRename,
  onSelect,
  onSelectMany,
  paneRef,
  parentPath,
  selectedPaths,
  sort,
  variant,
}: {
  canDelete: boolean;
  canRename: boolean;
  entries: CommanderEntry[];
  isLoading: boolean;
  isPathEditing: boolean;
  onActivate: (variant: CommanderPaneVariant) => void;
  onDelete?: () => void;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onRename?: () => void;
  onSelect: (path: string, additive: boolean) => void;
  onSelectMany: (paths: string[]) => void;
  paneRef: { current: HTMLElement | null };
  parentPath?: string;
  selectedPaths: string[];
  sort: CommanderSortState;
  variant: CommanderPaneVariant;
}) {
  const [focusedEntryPath, setFocusedEntryPath] = useState<string>();
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string>();
  const sortedEntries = useMemo(() => sortCommanderEntries(entries, sort), [entries, sort]);
  const sortedEntryPaths = useMemo(() => sortedEntries.map((entry) => entry.path), [sortedEntries]);

  const activatePane = useCallback(() => {
    onActivate(variant);
    paneRef.current?.focus({ preventScroll: true });
  }, [onActivate, paneRef, variant]);

  useEffect(() => {
    if (!focusedEntryPath) {
      return;
    }

    const focusedRow = Array.from(
      paneRef.current?.querySelectorAll<HTMLElement>('[data-commander-entry-path]') ?? [],
    ).find((element) => element.dataset.commanderEntryPath === focusedEntryPath);

    focusedRow?.scrollIntoView({ block: 'nearest' });
  }, [focusedEntryPath, paneRef]);

  const selectEntry = (entryPath: string, additive: boolean) => {
    activatePane();
    onSelect(entryPath, additive);
    setFocusedEntryPath(entryPath);
    setSelectionAnchorPath(entryPath);
  };

  const selectEntryRange = (entryPath: string) => {
    activatePane();

    if (!selectionAnchorPath) {
      onSelectMany([entryPath]);
      setFocusedEntryPath(entryPath);
      setSelectionAnchorPath(entryPath);
      return;
    }

    const anchorIndex = sortedEntryPaths.indexOf(selectionAnchorPath);
    const nextIndex = sortedEntryPaths.indexOf(entryPath);

    if (anchorIndex === -1 || nextIndex === -1) {
      onSelectMany([entryPath]);
      setFocusedEntryPath(entryPath);
      setSelectionAnchorPath(entryPath);
      return;
    }

    const [startIndex, endIndex] = anchorIndex < nextIndex
      ? [anchorIndex, nextIndex]
      : [nextIndex, anchorIndex];

    onSelectMany(sortedEntryPaths.slice(startIndex, endIndex + 1));
    setFocusedEntryPath(entryPath);
  };

  const moveSelection = (direction: -1 | 1, extendSelection = false) => {
    if (sortedEntryPaths.length === 0) {
      return;
    }

    const currentPath = selectedPaths.find((selectedPath) => sortedEntryPaths.includes(selectedPath));
    const currentIndex = currentPath ? sortedEntryPaths.indexOf(currentPath) : -1;
    const nextIndex = currentIndex === -1
      ? direction > 0 ? 0 : sortedEntryPaths.length - 1
      : Math.max(0, Math.min(sortedEntryPaths.length - 1, currentIndex + direction));
    const nextPath = sortedEntryPaths[nextIndex];

    if (extendSelection) {
      selectEntryRange(nextPath);
      return;
    }

    activatePane();
    onSelectMany([nextPath]);
    setFocusedEntryPath(nextPath);
    setSelectionAnchorPath(nextPath);
  };

  const handleCommanderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isPathEditing || isLoading) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      event.stopPropagation();
      activatePane();
      onSelectMany(sortedEntryPaths);
      setFocusedEntryPath(sortedEntryPaths[0]);
      setSelectionAnchorPath(sortedEntryPaths[0]);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(1, event.shiftKey);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(-1, event.shiftKey);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      if (sortedEntryPaths[0]) {
        activatePane();
        onSelectMany([sortedEntryPaths[0]]);
        setFocusedEntryPath(sortedEntryPaths[0]);
        setSelectionAnchorPath(sortedEntryPaths[0]);
      }
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      event.stopPropagation();
      const lastPath = sortedEntryPaths[sortedEntryPaths.length - 1];
      if (lastPath) {
        activatePane();
        onSelectMany([lastPath]);
        setFocusedEntryPath(lastPath);
        setSelectionAnchorPath(lastPath);
      }
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const selectedPath = selectedPaths.find((candidatePath) => sortedEntryPaths.includes(candidatePath));
      const selectedEntry = sortedEntries.find((entry) => entry.path === selectedPath);
      if (selectedEntry?.isDirectory) {
        onNavigate(selectedEntry.path);
      }
      return;
    }

    if (event.key === 'Backspace' && parentPath) {
      event.preventDefault();
      event.stopPropagation();
      onNavigate(parentPath);
      return;
    }

    if (event.key === 'F5') {
      event.preventDefault();
      event.stopPropagation();
      onRefresh();
      return;
    }

    if (variant === 'remote' && event.key === 'F2' && canRename) {
      event.preventDefault();
      event.stopPropagation();
      onRename?.();
      return;
    }

    if (event.key === 'Delete' && canDelete) {
      event.preventDefault();
      event.stopPropagation();
      onDelete?.();
    }
  };

  const {
    beginMarqueeSelection,
    endMarqueeSelection,
    marqueeBox,
    updateMarqueeSelection,
  } = useSftpCommanderMarqueeSelection({
    activatePane,
    isLoading,
    onSelectMany,
    selectedPaths,
    setFocusedEntryPath,
    setSelectionAnchorPath,
  });

  return {
    activatePane,
    beginMarqueeSelection,
    endMarqueeSelection,
    handleCommanderKeyDown,
    marqueeBox,
    selectEntry,
    selectEntryRange,
    sortedEntries,
    updateMarqueeSelection,
  };
}
