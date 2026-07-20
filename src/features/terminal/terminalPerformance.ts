import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

export interface TerminalWriteBuffer {
  dispose: () => void;
  flush: () => void;
  write: (data: string) => void;
}

export function createTerminalWriteBuffer(terminal: Terminal): TerminalWriteBuffer {
  let frame: number | undefined;
  let pendingChunks: string[] = [];

  const flush = () => {
    if (frame !== undefined) {
      window.cancelAnimationFrame(frame);
      frame = undefined;
    }

    if (pendingChunks.length === 0) {
      return;
    }

    const data = pendingChunks.length === 1 ? pendingChunks[0] : pendingChunks.join('');
    pendingChunks = [];
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
      if (!data) {
        return;
      }

      pendingChunks.push(data);
      scheduleFlush();
    },
  };
}

export interface TerminalAlternateScreenScrollGuard {
  dispose: () => void;
}

export function attachTerminalAlternateScreenScrollGuard(
  terminal: Terminal,
): TerminalAlternateScreenScrollGuard {
  const isAlternateScreenActive = () => terminal.buffer.active.type === 'alternate';

  const keepAlternateScreenAtBottom = () => {
    if (isAlternateScreenActive()) {
      terminal.scrollToBottom();
    }
  };

  const handleWheel = (event: WheelEvent) => {
    if (!isAlternateScreenActive() || event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    terminal.scrollToBottom();
  };

  const scrollDisposable = terminal.onScroll(keepAlternateScreenAtBottom);
  terminal.element?.addEventListener('wheel', handleWheel, { passive: false });

  return {
    dispose() {
      scrollDisposable.dispose();
      terminal.element?.removeEventListener('wheel', handleWheel);
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
