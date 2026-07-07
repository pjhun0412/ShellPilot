import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

export function createXtermTerminal() {
  const terminal = new Terminal({
    allowProposedApi: false,
    convertEol: true,
    cursorBlink: true,
    cursorStyle: 'block',
    fontFamily: 'Cascadia Mono, D2Coding, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.35,
    scrollback: 5000,
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
