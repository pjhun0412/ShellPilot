import type { IDisposable, Terminal } from '@xterm/xterm';

import { pasteClipboardToSsh, writeSshData } from './sshTerminalBridge';

export interface SshTerminalInputBinding {
  dispose: () => void;
}

export function copyTerminalSelection(terminal: Terminal | undefined) {
  const selectedText = terminal?.getSelection();

  if (selectedText) {
    void navigator.clipboard.writeText(selectedText).catch(() => undefined);
  }
}

export function bindSshTerminalInput({
  container,
  panelId,
  terminal,
}: {
  container: HTMLDivElement;
  panelId: string;
  terminal: Terminal;
}): SshTerminalInputBinding {
  const disposables: IDisposable[] = [
    terminal.onData((data) => {
      void writeSshData(panelId, data);
    }),
    terminal.onSelectionChange(() => {
      copyTerminalSelection(terminal);
    }),
  ];

  const shortcutHandler = (event: KeyboardEvent) => {
    if (!container.contains(event.target as Node)) {
      return;
    }

    if (!event.ctrlKey || !event.shiftKey || event.type !== 'keydown') {
      return;
    }

    if (event.code === 'KeyC') {
      event.preventDefault();
      event.stopPropagation();
      copyTerminalSelection(terminal);
      return;
    }

    if (event.code === 'KeyV') {
      event.preventDefault();
      event.stopPropagation();
      void pasteClipboardToSsh(panelId);
    }
  };

  window.addEventListener('keydown', shortcutHandler, true);
  terminal.attachCustomKeyEventHandler((event) => {
    if (!event.ctrlKey || !event.shiftKey || event.type !== 'keydown') {
      return true;
    }

    if (event.code === 'KeyC') {
      copyTerminalSelection(terminal);
      return false;
    }

    if (event.code === 'KeyV') {
      void navigator.clipboard.readText().then((text) => {
        if (text) {
          void writeSshData(panelId, text);
        }
      }).catch(() => undefined);
      return false;
    }

    return true;
  });

  return {
    dispose: () => {
      disposables.forEach((disposable) => disposable.dispose());
      window.removeEventListener('keydown', shortcutHandler, true);
    },
  };
}
