import type { IDisposable, Terminal } from '@xterm/xterm';

import { copyTerminalSelection } from './sshTerminalInput';
import { pasteClipboardToLocalPty, writeLocalPtyData } from './localPtyBridge';

export interface LocalPtyInputBinding {
  dispose: () => void;
}

export function bindLocalPtyInput({
  container,
  panelId,
  terminal,
}: {
  container: HTMLDivElement;
  panelId: string;
  terminal: Terminal;
}): LocalPtyInputBinding {
  const disposables: IDisposable[] = [
    terminal.onData((data) => {
      void writeLocalPtyData(panelId, data);
    }),
  ];

  const shortcutHandler = (event: KeyboardEvent) => {
    const shortcut = getScopedShortcut(event, container);

    if (!shortcut) {
      return;
    }

    if (shortcut === 'copy') {
      event.preventDefault();
      event.stopPropagation();
      copyTerminalSelection(terminal);
      return;
    }

    if (shortcut === 'paste') {
      event.preventDefault();
      event.stopPropagation();
      void pasteClipboardToLocalPty(panelId);
    }
  };

  window.addEventListener('keydown', shortcutHandler, true);

  return {
    dispose: () => {
      disposables.forEach((disposable) => disposable.dispose());
      window.removeEventListener('keydown', shortcutHandler, true);
    },
  };
}

type LocalPtyShortcut = 'copy' | 'paste';

function getScopedShortcut(event: KeyboardEvent, container: HTMLDivElement): LocalPtyShortcut | undefined {
  if (!container.contains(event.target as Node)) {
    return undefined;
  }

  if (!event.ctrlKey || !event.shiftKey || event.type !== 'keydown') {
    return undefined;
  }

  if (event.code === 'KeyC') {
    return 'copy';
  }

  if (event.code === 'KeyV') {
    return 'paste';
  }

  return undefined;
}
