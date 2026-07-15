import { useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';

import {
  getSftpEntryPathsInRect,
  scrollSftpRowIntoView,
} from './sftpPanelUtils';
import type { SftpEntry } from './sftpBridge';

export type SftpMarqueeBox = { height: number; left: number; top: number; width: number };

const sftpMarqueeThreshold = 4;

export function useSftpSelection({
  isLoading,
  isRemoteReady,
  panelRef,
  parentEntryPathKey,
  parentPath,
  tableEntries,
  visibleEntries,
}: {
  isLoading: boolean;
  isRemoteReady: boolean;
  panelRef: RefObject<HTMLDivElement>;
  parentEntryPathKey: string;
  parentPath: string | undefined;
  tableEntries: SftpEntry[];
  visibleEntries: SftpEntry[];
}) {
  const marqueeStartRef = useRef<{
    basePaths: string[];
    additive: boolean;
    clientX: number;
    clientY: number;
    container: HTMLElement;
    started: boolean;
  }>();
  const suppressNextEntryClickRef = useRef(false);
  const [marqueeBox, setMarqueeBox] = useState<SftpMarqueeBox>();
  const [selectedEntryPath, setSelectedEntryPath] = useState<string>();
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<string[]>([]);
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string>();
  const selectedEntry = visibleEntries.find((entry) => entry.path === selectedEntryPath);
  const selectedEntries = visibleEntries.filter((entry) => selectedEntryPaths.includes(entry.path));
  const tableEntryPaths = tableEntries.map((entry) => entry.path);
  const navigablePaths = [
    ...(parentPath ? [parentEntryPathKey] : []),
    ...tableEntryPaths,
  ];

  useEffect(() => {
    if (!selectedEntryPath) {
      return;
    }

    const selectedRow = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[data-sftp-entry-path]') ?? [],
    ).find((element) => element.dataset.sftpEntryPath === selectedEntryPath);

    if (selectedRow) {
      scrollSftpRowIntoView(selectedRow);
    }
  }, [panelRef, selectedEntryPath]);

  useEffect(() => {
    setSelectedEntryPaths((paths) =>
      paths.filter((selectedPath) => visibleEntries.some((entry) => entry.path === selectedPath)),
    );

    if (
      selectedEntryPath &&
      selectedEntryPath !== parentEntryPathKey &&
      !visibleEntries.some((entry) => entry.path === selectedEntryPath)
    ) {
      setSelectedEntryPath(undefined);
      setSelectionAnchorPath(undefined);
    }
  }, [parentEntryPathKey, selectedEntryPath, visibleEntries]);

  const resetSelection = () => {
    setSelectedEntryPath(undefined);
    setSelectedEntryPaths([]);
    setSelectionAnchorPath(undefined);
    setMarqueeBox(undefined);
    marqueeStartRef.current = undefined;
    suppressNextEntryClickRef.current = false;
  };

  const beginMarqueeSelection = (event: MouseEvent<HTMLElement>) => {
    if (!isRemoteReady || isLoading || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest('[data-sftp-entry-path]')) {
      return;
    }

    marqueeStartRef.current = {
      additive: event.ctrlKey || event.metaKey,
      basePaths: event.ctrlKey || event.metaKey ? selectedEntryPaths : [],
      clientX: event.clientX,
      clientY: event.clientY,
      container: event.currentTarget,
      started: false,
    };
  };

  const updateMarqueeSelection = (event: MouseEvent<HTMLElement>) => {
    const drag = marqueeStartRef.current;

    if (!drag) {
      return;
    }

    const deltaX = Math.abs(event.clientX - drag.clientX);
    const deltaY = Math.abs(event.clientY - drag.clientY);

    if (!drag.started && deltaX < sftpMarqueeThreshold && deltaY < sftpMarqueeThreshold) {
      return;
    }

    drag.started = true;
    suppressNextEntryClickRef.current = true;

    const containerRect = drag.container.getBoundingClientRect();
    const left = Math.min(drag.clientX, event.clientX);
    const top = Math.min(drag.clientY, event.clientY);
    const right = Math.max(drag.clientX, event.clientX);
    const bottom = Math.max(drag.clientY, event.clientY);
    const hitPaths = getSftpEntryPathsInRect({
      container: drag.container,
      parentEntryPathKey,
      rect: { bottom, left, right, top },
    });
    const nextPaths = drag.additive
      ? Array.from(new Set([...drag.basePaths, ...hitPaths]))
      : hitPaths;
    const focusedPath = hitPaths[hitPaths.length - 1] ?? nextPaths[nextPaths.length - 1];

    event.preventDefault();
    setMarqueeBox({
      height: bottom - top,
      left: left - containerRect.left,
      top: top - containerRect.top,
      width: right - left,
    });
    setSelectedEntryPaths(nextPaths);
    setSelectedEntryPath(focusedPath);
    setSelectionAnchorPath(nextPaths[0]);
  };

  const endMarqueeSelection = () => {
    const didDrag = marqueeStartRef.current?.started;

    marqueeStartRef.current = undefined;
    setMarqueeBox(undefined);

    if (didDrag) {
      window.setTimeout(() => {
        suppressNextEntryClickRef.current = false;
      }, 0);
    }
  };

  const selectEntryPath = (entryPath: string, event?: MouseEvent<HTMLElement>) => {
    if (suppressNextEntryClickRef.current) {
      suppressNextEntryClickRef.current = false;
      return;
    }

    setSelectedEntryPath(entryPath);

    if (entryPath === parentEntryPathKey) {
      setSelectedEntryPaths([]);
      setSelectionAnchorPath(undefined);
      return;
    }

    if (event?.shiftKey && selectionAnchorPath) {
      const anchorIndex = tableEntryPaths.indexOf(selectionAnchorPath);
      const nextIndex = tableEntryPaths.indexOf(entryPath);

      if (anchorIndex !== -1 && nextIndex !== -1) {
        const [startIndex, endIndex] = anchorIndex < nextIndex
          ? [anchorIndex, nextIndex]
          : [nextIndex, anchorIndex];

        setSelectedEntryPaths(tableEntryPaths.slice(startIndex, endIndex + 1));
        return;
      }
    }

    if (event?.ctrlKey || event?.metaKey) {
      setSelectedEntryPaths((paths) =>
        paths.includes(entryPath)
          ? paths.filter((path) => path !== entryPath)
          : [...paths, entryPath],
      );
      setSelectionAnchorPath(entryPath);
      return;
    }

    setSelectedEntryPaths([entryPath]);
    setSelectionAnchorPath(entryPath);
  };

  const selectAllEntries = () => {
    window.getSelection()?.removeAllRanges();

    const focusedPath =
      selectedEntryPath && tableEntryPaths.includes(selectedEntryPath)
        ? selectedEntryPath
        : tableEntryPaths[0];

    setSelectedEntryPaths(tableEntryPaths);
    setSelectedEntryPath(focusedPath);
    setSelectionAnchorPath(focusedPath);
  };

  const moveSelection = (direction: -1 | 1, extendSelection = false) => {
    if (navigablePaths.length === 0) {
      return;
    }

    const currentIndex = selectedEntryPath
      ? navigablePaths.indexOf(selectedEntryPath)
      : -1;
    const nextIndex =
      currentIndex === -1
        ? direction > 0 ? 0 : navigablePaths.length - 1
        : Math.max(0, Math.min(navigablePaths.length - 1, currentIndex + direction));
    const nextPath = navigablePaths[nextIndex];

    setSelectedEntryPath(nextPath);

    if (nextPath === parentEntryPathKey) {
      if (!extendSelection) {
        setSelectedEntryPaths([]);
      }
      return;
    }

    if (extendSelection && selectionAnchorPath) {
      const anchorIndex = tableEntryPaths.indexOf(selectionAnchorPath);
      const nextEntryIndex = tableEntryPaths.indexOf(nextPath);

      if (anchorIndex !== -1 && nextEntryIndex !== -1) {
        const [startIndex, endIndex] = anchorIndex < nextEntryIndex
          ? [anchorIndex, nextEntryIndex]
          : [nextEntryIndex, anchorIndex];

        setSelectedEntryPaths(tableEntryPaths.slice(startIndex, endIndex + 1));
      }

      return;
    }

    setSelectedEntryPaths([nextPath]);
    setSelectionAnchorPath(nextPath);
  };

  return {
    beginMarqueeSelection,
    endMarqueeSelection,
    marqueeBox,
    moveSelection,
    navigablePaths,
    resetSelection,
    selectAllEntries,
    selectEntryPath,
    selectedEntries,
    selectedEntry,
    selectedEntryPath,
    selectedEntryPaths,
    updateMarqueeSelection,
  };
}
