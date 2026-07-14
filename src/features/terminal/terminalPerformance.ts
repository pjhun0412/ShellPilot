import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

export interface TerminalWriteBuffer {
  dispose: () => void;
  flush: () => void;
  write: (data: string) => void;
}

export function createTerminalWriteBuffer(terminal: Terminal): TerminalWriteBuffer {
  let frame: number | undefined;
  let pending = '';

  const flush = () => {
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
      frame = undefined;
    }

    if (!pending) {
      return;
    }

    const data = pending;
    pending = '';
    terminal.write(data);
  };

  const scheduleFlush = () => {
    if (frame !== undefined) {
      return;
    }

    frame = window.requestAnimationFrame(() => {
      frame = undefined;
      flush();
    });
  };

  return {
    dispose: flush,
    flush,
    write(data: string) {
      pending += data;
      scheduleFlush();
    },
  };
}

export interface TerminalFitScheduler {
  dispose: () => void;
  fit: () => void;
}

export function createTerminalFitScheduler({
  fitAddon,
  onResize,
  terminal,
}: {
  fitAddon: FitAddon;
  onResize: () => void;
  terminal: Terminal;
}): TerminalFitScheduler {
  let frame: number | undefined;

  const fit = () => {
    if (frame !== undefined) {
      return;
    }

    frame = window.requestAnimationFrame(() => {
      frame = undefined;

      if (terminal.element?.isConnected === false) {
        return;
      }

      try {
        fitAddon.fit();
        onResize();
      } catch {
        // FlexLayout can briefly report zero-size panels while dragging splitters.
      }
    });
  };

  return {
    dispose() {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame);
        frame = undefined;
      }
    },
    fit,
  };
}
