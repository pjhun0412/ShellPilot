import type { Terminal } from '@xterm/xterm';
import { useEffect, type MutableRefObject } from 'react';

export function useActiveTerminalFocus({
  focusKey,
  isActive,
  terminalRef,
}: {
  focusKey?: unknown;
  isActive: boolean;
  terminalRef: MutableRefObject<Terminal | undefined>;
}) {
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      terminalRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [focusKey, isActive, terminalRef]);
}
