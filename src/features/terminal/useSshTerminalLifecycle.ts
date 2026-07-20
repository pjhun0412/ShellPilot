import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { useEffect, type RefObject, type MutableRefObject } from 'react';

import type { SessionItem } from '@/types/workspace';
import { subscribeTerminalClosing, subscribeTerminalDisconnect } from './terminalLifecycle';
import { registerTerminal, unregisterTerminal } from './terminalRegistry';
import {
  closeSshShell,
  openSshShell,
  resizeSshPty,
  type SshTerminalEvent,
} from './sshTerminalBridge';
import { createXtermTerminal } from './createXtermTerminal';
import { handleSshTerminalEvent, type SshCloseIntent, type SshHostKeyWarning } from './sshTerminalEventHandler';
import { bindSshTerminalInput } from './sshTerminalInput';
import { getSshOpenFailure, type SshTerminalFailure } from './sshTerminalUi';
import { attachTerminalDiagnosticsHighlighter } from './terminalDiagnosticsHighlighter';
import {
  attachTerminalAlternateScreenScrollGuard,
  createTerminalFitScheduler,
  createTerminalWriteBuffer,
} from './terminalPerformance';
import type { SshTerminalUiStatus } from './useSshTerminalStatus';

interface UseSshTerminalLifecycleOptions {
  autoConnect: boolean;
  closeIntentRef: MutableRefObject<SshCloseIntent | undefined>;
  containerRef: RefObject<HTMLDivElement>;
  endpointLabelRef: MutableRefObject<string>;
  failedAttemptRef: MutableRefObject<boolean>;
  fitAddonRef: MutableRefObject<FitAddon | undefined>;
  lastHostKeyWarningRef: MutableRefObject<SshHostKeyWarning | undefined>;
  panelId: string;
  pendingPasswordRef: MutableRefObject<string | undefined>;
  pendingUsernameRef: MutableRefObject<string | undefined>;
  publishClosedStatus: (updateState?: boolean) => void;
  sessionRef: MutableRefObject<SessionItem>;
  setTerminalStatus: (status: SshTerminalUiStatus, failure?: SshTerminalFailure) => void;
  shouldRememberPasswordRef: MutableRefObject<boolean>;
  shouldRememberUsernameRef: MutableRefObject<boolean>;
  terminalRef: MutableRefObject<Terminal | undefined>;
}

export function useSshTerminalLifecycle({
  autoConnect,
  closeIntentRef,
  containerRef,
  endpointLabelRef,
  failedAttemptRef,
  fitAddonRef,
  lastHostKeyWarningRef,
  panelId,
  pendingPasswordRef,
  pendingUsernameRef,
  publishClosedStatus,
  sessionRef,
  setTerminalStatus,
  shouldRememberPasswordRef,
  shouldRememberUsernameRef,
  terminalRef,
}: UseSshTerminalLifecycleOptions) {
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
        void resizeSshPty(panelId, terminal);
      },
      terminal,
    });
    const writeBuffer = createTerminalWriteBuffer(terminal);
    fitScheduler.fit();
    if (autoConnect) {
      failedAttemptRef.current = false;
      terminal.writeln(`Connecting to ${endpointLabelRef.current}...`);
      setTerminalStatus('connecting');
    } else {
      terminal.writeln(`Session restored: ${endpointLabelRef.current}`);
      terminal.writeln('Use Reconnect to open a new SSH connection.');
      setTerminalStatus('restored');
    }

    const inputBinding = bindSshTerminalInput({
      container: containerRef.current,
      panelId,
      terminal,
    });
    const resizeObserver = new ResizeObserver(() => {
      fitScheduler.fit();
    });
    resizeObserver.observe(containerRef.current);
    const unsubscribeClosing = subscribeTerminalClosing((closingPanelId) => {
      if (closingPanelId !== panelId) {
        return;
      }

      terminal.writeln('\r\n[closing ssh session...]');
      closeIntentRef.current = 'dispose';
      void closeSshShell(panelId);
      publishClosedStatus(false);
    });
    const unsubscribeDisconnect = subscribeTerminalDisconnect((disconnectPanelId) => {
      if (disconnectPanelId !== panelId) {
        return;
      }

      terminal.writeln('\r\n[ssh session disconnected]');
      closeIntentRef.current = 'manual';
      void closeSshShell(panelId);
      publishClosedStatus();
    });

    let isDisposed = false;
    let unlisten: UnlistenFn | undefined;
    const startShellAfterListenerReady = async () => {
      unlisten = await listen<SshTerminalEvent>('shellpilot-ssh-terminal', (event) => {
        handleSshTerminalEvent({
          closeIntentRef,
          event: event.payload,
          failedAttemptRef,
          fitTerminal: fitScheduler.fit,
          lastHostKeyWarningRef,
          panelId,
          pendingPasswordRef,
          pendingUsernameRef,
          session: sessionRef.current,
          setTerminalStatus,
          shouldRememberPasswordRef,
          shouldRememberUsernameRef,
          terminal,
          writeBuffer,
        });
      });

      if (isDisposed) {
        return;
      }

      if (autoConnect) {
        await openSshShell(panelId, sessionRef.current);
      }
    };

    void startShellAfterListenerReady().catch((error: unknown) => {
      if (!isDisposed) {
        failedAttemptRef.current = true;
        setTerminalStatus('failed', getSshOpenFailure(error));
      }
    });

    return () => {
      isDisposed = true;
      closeIntentRef.current = 'dispose';
      void closeSshShell(panelId);
      writeBuffer.dispose();
      inputBinding.dispose();
      fitScheduler.dispose();
      alternateScreenScrollGuard.dispose();
      diagnosticsHighlighter.dispose();
      resizeObserver.disconnect();
      unsubscribeClosing();
      unsubscribeDisconnect();
      unlisten?.();
      unregisterTerminal(panelId);
      terminal.dispose();
      publishClosedStatus();
    };
  }, [
    autoConnect,
    closeIntentRef,
    containerRef,
    endpointLabelRef,
    failedAttemptRef,
    fitAddonRef,
    lastHostKeyWarningRef,
    panelId,
    pendingPasswordRef,
    pendingUsernameRef,
    publishClosedStatus,
    sessionRef,
    setTerminalStatus,
    shouldRememberPasswordRef,
    shouldRememberUsernameRef,
    terminalRef,
  ]);
}
