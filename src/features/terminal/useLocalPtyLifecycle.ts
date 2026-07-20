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
import {
  attachTerminalAlternateScreenScrollGuard,
  createTerminalFitScheduler,
  createTerminalWriteBuffer,
} from './terminalPerformance';
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
    const alternateScreenScrollGuard = attachTerminalAlternateScreenScrollGuard(terminal);
    const fitScheduler = createTerminalFitScheduler({
      fitAddon,
      onResize: () => {
        void resizeLocalPty(panelId, terminal);
      },
      terminal,
    });
    const writeBuffer = createTerminalWriteBuffer(terminal);
    fitScheduler.fit();
    setStatus('connecting');
    publishConnectionStatus({ panelId, status: 'connecting' });

    const inputBinding = bindLocalPtyInput({ container: containerRef.current, panelId, terminal });
    const resizeObserver = new ResizeObserver(() => {
      fitScheduler.fit();
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
          writeBuffer.flush();
          terminal.focus();
          fitScheduler.fit();
          return;
        }

        if (payload.status === 'data' && payload.data) {
          writeBuffer.write(payload.data);
          return;
        }

        if (payload.status === 'failed') {
          writeBuffer.flush();
          setStatus('failed', payload.message);
          publishConnectionStatus({ panelId, status: 'failed' });
          return;
        }

        if (payload.status === 'closed') {
          writeBuffer.flush();
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
      writeBuffer.dispose();
      inputBinding.dispose();
      fitScheduler.dispose();
      alternateScreenScrollGuard.dispose();
      diagnosticsHighlighter.dispose();
      resizeObserver.disconnect();
      unsubscribeClosing();
      unlisten?.();
      unregisterTerminal(panelId);
      terminal.dispose();
    };
  }, [containerRef, fitAddonRef, panelId, setStatus, target, terminalRef]);
}
