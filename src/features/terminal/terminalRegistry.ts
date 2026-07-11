import type { Terminal } from '@xterm/xterm';

const registry = new Map<string, Terminal>();

export function registerTerminal(panelId: string, terminal: Terminal) {
  registry.set(panelId, terminal);
}

export function unregisterTerminal(panelId: string) {
  registry.delete(panelId);
}

export function focusRegisteredTerminal(panelId: string) {
  const terminal = registry.get(panelId);

  if (!terminal) {
    return false;
  }

  window.requestAnimationFrame(() => {
    terminal.focus();
  });

  return true;
}

export function readTerminalScrollbackText(panelId: string, maxLines = 150): string | undefined {
  const terminal = registry.get(panelId);

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
