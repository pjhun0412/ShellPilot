import { useEffect } from 'react';

import { focusRegisteredTerminal } from './terminalRegistry';

export function useActiveTerminalFocus({
  focusKey,
  isActive,
  panelId,
}: {
  focusKey?: unknown;
  isActive: boolean;
  panelId: string;
}) {
  useEffect(() => {
    if (!isActive) {
      return;
    }

    focusRegisteredTerminal(panelId);
  }, [focusKey, isActive, panelId]);
}
