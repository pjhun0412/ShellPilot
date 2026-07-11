import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { useEffect, type MutableRefObject, type RefObject } from 'react';

import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import { createXtermTerminal } from './createXtermTerminal';
import {
  closeLocalPty,
  openLocalPty,
  resizeLocalPty,
  type LocalPtyEvent,
  type LocalPtyTarget,
} from './localPtyBridge';
import { bindLocalPtyInput } from './localPtyInput';
import { attachTerminalDiagnosticsHighlighter } from './terminalDiagnosticsHighlighter';
import { subscribeTerminalClosing } from './terminalLifecycle';
import { registerTerminal, unregisterTerminal } from './terminalRegistry';

export type LocalPtyStatus = 'closed' | 'connected' | 'connecting' | 'failed';

interface UseLocalPtyLifecycleOptions {
  containerRef: RefObject<HTMLDivElement>;
  fitAddonRef: MutableRefObject<FitAddon | undefined>;
  panelId: string;
  setStatus: (status: LocalPtyStatus, message?: string) => void;
  target: LocalPtyTarget;
  terminalRef: MutableRefObject<Terminal | undefined>;
}

export function useLocalPtyLifecycle({
  containerRef,
  fitAddonRef,
  panelId,
  setStatus,
  target,
  terminalRef,
}: UseLocalPtyLifecycleOptions) {
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const { fitAddon, terminal } = createXtermTerminal();
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    registerTerminal(panelId, terminal);
    const diagnosticsHighlighter = attachTerminalDiagnosticsHighlighter(terminal);
    fitTerminal(panelId, terminal, fitAddon);
    setStatus('connecting');
    publishConnectionStatus({ panelId, status: 'connecting' });

    const inputBinding = bindLocalPtyInput({ container: containerRef.current, panelId, terminal });
    const resizeObserver = new ResizeObserver(() => {
      fitTerminal(panelId, terminal, fitAddon);
    });
    resizeObserver.observe(containerRef.current);
    const unsubscribeClosing = subscribeTerminalClosing((closingPanelId) => {
      if (closingPanelId !== panelId) {
        return;
      }

      void closeLocalPty(panelId);
    });

    let isDisposed = false;
    let unlisten: UnlistenFn | undefined;

    const start = async () => {
      unlisten = await listen<LocalPtyEvent>('shellpilot-local-pty', (event) => {
        const payload = event.payload;

        if (payload.panelId !== panelId) {
          return;
        }

        if (payload.status === 'connected') {
          setStatus('connected');
          publishConnectionStatus({ panelId, status: 'connected' });
          terminal.focus();
          fitTerminal(panelId, terminal, fitAddon);
          return;
        }

        if (payload.status === 'data' && payload.data) {
          terminal.write(payload.data);
          return;
        }

        if (payload.status === 'failed') {
          setStatus('failed', payload.message);
          publishConnectionStatus({ panelId, status: 'failed' });
          return;
        }

        if (payload.status === 'closed') {
          setStatus('closed');
          publishConnectionStatus({ panelId, status: 'closed' });
        }
      });

      if (isDisposed) {
        return;
      }

      await openLocalPty(panelId, target);
    };

    void start().catch((error: unknown) => {
      if (!isDisposed) {
        setStatus('failed', error instanceof Error ? error.message : String(error));
        publishConnectionStatus({ panelId, status: 'failed' });
      }
    });

    return () => {
      isDisposed = true;
      publishConnectionStatus({ panelId, status: 'closed' });
      void closeLocalPty(panelId);
      inputBinding.dispose();
      diagnosticsHighlighter.dispose();
      resizeObserver.disconnect();
      unsubscribeClosing();
      unlisten?.();
      unregisterTerminal(panelId);
      terminal.dispose();
    };
  }, [containerRef, fitAddonRef, panelId, setStatus, target, terminalRef]);
}

function fitTerminal(panelId: string, terminal: Terminal, fitAddon: FitAddon) {
  window.requestAnimationFrame(() => {
    try {
      fitAddon.fit();
      void resizeLocalPty(panelId, terminal);
    } catch {
      // FlexLayout can briefly report zero-size panels while dragging splitters.
    }
  });
}
