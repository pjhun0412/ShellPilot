import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { loadPreferences } from '@/features/settings/appPreferences';

export function createXtermTerminal() {
  const { terminal: preferences } = loadPreferences();
  const terminal = new Terminal({
    allowProposedApi: preferences.diagnosticsHighlight,
    convertEol: false,
    cursorBlink: preferences.cursorBlink,
    cursorStyle: 'block',
    fontFamily: preferences.fontFamily,
    fontSize: preferences.fontSize,
    lineHeight: preferences.lineHeight,
    scrollback: preferences.scrollback,
    theme: {
      background: '#05080e',
      black: '#151922',
      blue: '#5ea1ff',
      brightBlack: '#6b7280',
      brightBlue: '#93c5fd',
      brightCyan: '#67e8f9',
      brightGreen: '#86efac',
      brightMagenta: '#c4b5fd',
      brightRed: '#fca5a5',
      brightWhite: '#f8fafc',
      brightYellow: '#fde68a',
      cyan: '#22d3ee',
      cursor: '#2dd4bf',
      foreground: '#f8fafc',
      green: '#34d399',
      magenta: '#a78bfa',
      red: '#fb7185',
      white: '#e5e7eb',
      yellow: '#fbbf24',
    },
  });
  const fitAddon = new FitAddon();

  terminal.loadAddon(fitAddon);

  return {
    fitAddon,
    terminal,
  };
}
