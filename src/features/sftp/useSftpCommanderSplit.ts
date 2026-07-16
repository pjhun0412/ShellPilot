import { useCallback, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';

import { COMMANDER_MAX_SPLIT_PERCENT, COMMANDER_MIN_SPLIT_PERCENT } from './sftpCommanderUtils';

export function useSftpCommanderSplit() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPercent, setSplitPercent] = useState(50);

  const updateSplitPercent = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return;
    }

    const nextPercent = ((clientX - rect.left) / rect.width) * 100;
    setSplitPercent(Math.min(COMMANDER_MAX_SPLIT_PERCENT, Math.max(COMMANDER_MIN_SPLIT_PERCENT, nextPercent)));
  }, []);

  const handleSplitterMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    updateSplitPercent(event.clientX);

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      updateSplitPercent(moveEvent.clientX);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [updateSplitPercent]);

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `minmax(0, ${splitPercent}fr) 2px minmax(0, ${100 - splitPercent}fr)`,
    gridTemplateRows: 'auto minmax(0, 1fr)',
  };

  return {
    containerRef,
    gridStyle,
    handleSplitterMouseDown,
  };
}
