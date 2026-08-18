import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';

export interface TerminalWriteBuffer {
  dispose: () => void;
  flush: () => void;
  write: (data: string, onParsed?: () => void) => void;
}

interface TerminalWriteBufferOptions {
  delivery?: 'animation-frame' | 'immediate';
}

export function createTerminalWriteBuffer(
  terminal: Terminal,
  { delivery = 'animation-frame' }: TerminalWriteBufferOptions = {},
): TerminalWriteBuffer {
  if (delivery === 'immediate') {
    let isDisposed = false;

    return {
      dispose() {
        isDisposed = true;
      },
      flush() {},
      write(data: string, onParsed?: () => void) {
        if (!data || isDisposed) {
          return;
        }

        terminal.write(data, onParsed);
      },
    };
  }

  let frame: number | undefined;
  let pendingCallbacks: Array<() => void> = [];
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
    const callbacks = pendingCallbacks;
    pendingCallbacks = [];
    pendingChunks = [];
    terminal.write(data, () => {
      callbacks.forEach((callback) => callback());
    });
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
    write(data: string, onParsed?: () => void) {
      if (!data) {
        return;
      }

      pendingChunks.push(data);
      if (onParsed) {
        pendingCallbacks.push(onParsed);
      }
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

      const terminalElement = terminal.element;
      const container = terminalElement?.parentElement;

      if (!terminalElement?.isConnected || !container) {
        return;
      }

      const containerRect = container.getBoundingClientRect();

      // FlexLayout hides inactive tabs with a zero-size container. FitAddon
      // clamps that state to 2x1, which would incorrectly resize the remote PTY.
      if (containerRect.width <= 0 || containerRect.height <= 0) {
        return;
      }

      try {
        const dimensions = fitAddon.proposeDimensions();

        if (!dimensions || dimensions.cols <= 0 || dimensions.rows <= 0) {
          return;
        }

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
