import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';

import {
  COMMANDER_MARQUEE_THRESHOLD,
  getCommanderEntryPathsInRect,
} from './sftpCommanderUtils';

type MarqueeBox = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export function useSftpCommanderMarqueeSelection({
  activatePane,
  isLoading,
  onSelectMany,
  selectedPaths,
  setFocusedEntryPath,
  setSelectionAnchorPath,
}: {
  activatePane: () => void;
  isLoading: boolean;
  onSelectMany: (paths: string[]) => void;
  selectedPaths: string[];
  setFocusedEntryPath: (path: string | undefined) => void;
  setSelectionAnchorPath: (path: string | undefined) => void;
}) {
  const marqueeStartRef = useRef<{
    additive: boolean;
    basePaths: string[];
    clientX: number;
    clientY: number;
    container: HTMLElement;
    started: boolean;
  }>();
  const [marqueeBox, setMarqueeBox] = useState<MarqueeBox>();

  const beginMarqueeSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || isLoading) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest('[data-commander-entry-path]')) {
      return;
    }

    activatePane();
    marqueeStartRef.current = {
      additive: event.ctrlKey || event.metaKey,
      basePaths: event.ctrlKey || event.metaKey ? selectedPaths : [],
      clientX: event.clientX,
      clientY: event.clientY,
      container: event.currentTarget,
      started: false,
    };
  };

  const updateMarqueeSelection = (event: ReactMouseEvent<HTMLDivElement>) => {
    const drag = marqueeStartRef.current;

    if (!drag) {
      return;
    }

    const deltaX = Math.abs(event.clientX - drag.clientX);
    const deltaY = Math.abs(event.clientY - drag.clientY);

    if (!drag.started && deltaX < COMMANDER_MARQUEE_THRESHOLD && deltaY < COMMANDER_MARQUEE_THRESHOLD) {
      return;
    }

    drag.started = true;
    event.preventDefault();

    const containerRect = drag.container.getBoundingClientRect();
    const left = Math.min(drag.clientX, event.clientX);
    const top = Math.min(drag.clientY, event.clientY);
    const right = Math.max(drag.clientX, event.clientX);
    const bottom = Math.max(drag.clientY, event.clientY);
    const hitPaths = getCommanderEntryPathsInRect(drag.container, { bottom, left, right, top });
    const nextPaths = drag.additive
      ? Array.from(new Set([...drag.basePaths, ...hitPaths]))
      : hitPaths;
    const focusedPath = hitPaths[hitPaths.length - 1] ?? nextPaths[nextPaths.length - 1];

    onSelectMany(nextPaths);
    setFocusedEntryPath(focusedPath);
    setSelectionAnchorPath(nextPaths[0]);
    setMarqueeBox({
      height: bottom - top,
      left: left - containerRect.left,
      top: top - containerRect.top,
      width: right - left,
    });
  };

  const endMarqueeSelection = () => {
    const shouldClearSelection = marqueeStartRef.current && !marqueeStartRef.current.started && !marqueeStartRef.current.additive;

    marqueeStartRef.current = undefined;
    setMarqueeBox(undefined);

    if (shouldClearSelection) {
      onSelectMany([]);
      setFocusedEntryPath(undefined);
      setSelectionAnchorPath(undefined);
    }
  };

  return {
    beginMarqueeSelection,
    endMarqueeSelection,
    marqueeBox,
    updateMarqueeSelection,
  };
}
