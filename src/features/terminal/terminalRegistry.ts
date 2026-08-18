import type { Terminal } from '@xterm/xterm';

interface RegisteredTerminal {
  fit?: () => void;
  terminal: Terminal;
}

const registry = new Map<string, RegisteredTerminal>();
let activePanelId: string | undefined;

const fitActiveTerminal = () => {
  if (activePanelId) {
    registry.get(activePanelId)?.fit?.();
  }
};

const handleVisibilityChange = () => {
  if (document.visibilityState === 'visible') {
    fitActiveTerminal();
  }
};

const attachWindowListeners = () => {
  if (registry.size !== 1) {
    return;
  }

  window.addEventListener('focus', fitActiveTerminal);
  window.addEventListener('resize', fitActiveTerminal);
  document.addEventListener('visibilitychange', handleVisibilityChange);
};

const detachWindowListeners = () => {
  if (registry.size !== 0) {
    return;
  }

  window.removeEventListener('focus', fitActiveTerminal);
  window.removeEventListener('resize', fitActiveTerminal);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
};

export function registerTerminal(panelId: string, terminal: Terminal, fit?: () => void) {
  registry.set(panelId, { fit, terminal });
  attachWindowListeners();
}

export function unregisterTerminal(panelId: string) {
  registry.delete(panelId);

  if (activePanelId === panelId) {
    activePanelId = undefined;
  }

  detachWindowListeners();
}

export function focusRegisteredTerminal(panelId: string) {
  const registeredTerminal = registry.get(panelId);

  if (!registeredTerminal) {
    return false;
  }

  activePanelId = panelId;
  registeredTerminal.fit?.();

  window.requestAnimationFrame(() => {
    registeredTerminal.terminal.focus();
  });

  return true;
}

export function readTerminalScrollbackText(panelId: string, maxLines = 150): string | undefined {
  const terminal = registry.get(panelId)?.terminal;

  if (!terminal) {
    return undefined;
  }

  const buffer = terminal.buffer.active;
  const start = Math.max(0, buffer.length - maxLines);
  const lines: string[] = [];

  for (let index = start; index < buffer.length; index += 1) {
    const line = buffer.getLine(index);

    if (line) {
      lines.push(line.translateToString(true));
    }
  }

  const text = lines.join('\n').trimEnd();
  return text || undefined;
}
