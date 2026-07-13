import type { Terminal } from '@xterm/xterm';
import { useCallback, useEffect, type FormEvent, type MutableRefObject } from 'react';

import { appConfirm } from '@/components/ui/app-dialog';
import type { SessionItem } from '@/types/workspace';
import { notifyTerminalDisconnect, subscribeTerminalReconnect } from './terminalLifecycle';
import {
  closeSshShell,
  forgetSshKnownHost,
  openSshShell,
} from './sshTerminalBridge';
import {
  getSshOpenFailure,
  shouldPromptSecret,
  shouldPromptUsername,
  type SshTerminalFailure,
} from './sshTerminalUi';
import type { SshCloseIntent, SshHostKeyWarning } from './sshTerminalEventHandler';
import type { SshTerminalUiStatus } from './useSshTerminalStatus';

interface UseSshTerminalActionsOptions {
  closeIntentRef: MutableRefObject<SshCloseIntent | undefined>;
  endpointLabel: string;
  failure: SshTerminalFailure | undefined;
  lastHostKeyWarningRef: MutableRefObject<SshHostKeyWarning | undefined>;
  manualPassword: string;
  manualUsername: string;
  panelId: string;
  pendingPasswordRef: MutableRefObject<string | undefined>;
  pendingUsernameRef: MutableRefObject<string | undefined>;
  secretLabel: string;
  session: SessionItem;
  setManualPassword: (value: string) => void;
  setManualUsername: (value: string) => void;
  setTerminalStatus: (status: SshTerminalUiStatus, failure?: SshTerminalFailure) => void;
  terminalRef: MutableRefObject<Terminal | undefined>;
}

export function useSshTerminalActions({
  closeIntentRef,
  endpointLabel,
  failure,
  lastHostKeyWarningRef,
  manualPassword,
  manualUsername,
  panelId,
  pendingPasswordRef,
  pendingUsernameRef,
  secretLabel,
  session,
  setManualPassword,
  setManualUsername,
  setTerminalStatus,
  terminalRef,
}: UseSshTerminalActionsOptions) {
  const reconnectSession = useCallback(async () => {
    const terminal = terminalRef.current;

    setTerminalStatus('connecting');
    lastHostKeyWarningRef.current = undefined;
    terminal?.clear();
    terminal?.writeln(`Reconnecting to ${endpointLabel}...`);
    closeIntentRef.current = 'reconnect';
    await closeSshShell(panelId).catch(() => undefined);
    await openSshShell(panelId, session).catch((error: unknown) => {
      const failure = getSshOpenFailure(error);

      closeIntentRef.current = undefined;
      setTerminalStatus('failed', failure);
    });
    terminal?.focus();
  }, [
    closeIntentRef,
    endpointLabel,
    lastHostKeyWarningRef,
    panelId,
    session,
    setTerminalStatus,
    terminalRef,
  ]);

  useEffect(() => {
    return subscribeTerminalReconnect((reconnectPanelId) => {
      if (reconnectPanelId === panelId) {
        void reconnectSession();
        return true;
      }

      return false;
    });
  }, [panelId, reconnectSession]);

  const closeSession = useCallback(async () => {
    notifyTerminalDisconnect(panelId);
  }, [panelId]);

  const connectWithPassword = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      const needsUsername = shouldPromptUsername(failure?.code, session);
      const needsSecret = shouldPromptSecret(failure?.code, session);
      const username = manualUsername.trim();

      if ((needsUsername && !username) || (needsSecret && !manualPassword)) {
        return;
      }

      setTerminalStatus('connecting');
      lastHostKeyWarningRef.current = undefined;
      pendingPasswordRef.current = manualPassword || undefined;
      pendingUsernameRef.current = username || undefined;
      terminalRef.current?.writeln(`\r\nRetrying with typed ${secretLabel}...`);
      await openSshShell(panelId, session, {
        password: manualPassword || undefined,
        username: username || undefined,
      }).catch((error: unknown) => {
        const failure = getSshOpenFailure(error);

        setTerminalStatus('failed', {
          ...failure,
          authPrompt: true,
        });
      });
      setManualPassword('');
      setManualUsername('');
    },
    [
      failure?.code,
      lastHostKeyWarningRef,
      manualPassword,
      manualUsername,
      panelId,
      pendingPasswordRef,
      pendingUsernameRef,
      secretLabel,
      session,
      setManualPassword,
      setManualUsername,
      setTerminalStatus,
      terminalRef,
    ],
  );

  const resetKnownHostAndReconnect = useCallback(async () => {
    const confirmed = await appConfirm({
      confirmLabel: 'Reset Host Key',
      message:
        'Reset the stored SSH host key for this server?\n\nOnly continue if you verified the server was rebuilt or its SSH host key changed intentionally.',
      title: 'Reset SSH Host Key',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    await forgetSshKnownHost(session);
    await reconnectSession();
  }, [reconnectSession, session]);

  const trustHostKeyAndReconnect = useCallback(async () => {
    setTerminalStatus('connecting');
    lastHostKeyWarningRef.current = undefined;
    terminalRef.current?.writeln('\r\nTrusting SSH host key and reconnecting...');
    closeIntentRef.current = 'reconnect';
    await closeSshShell(panelId).catch(() => undefined);
    await openSshShell(panelId, session, {
      acceptNewHostKey: true,
      password: pendingPasswordRef.current,
      username: pendingUsernameRef.current,
    }).catch((error: unknown) => {
      const failure = getSshOpenFailure(error);

      closeIntentRef.current = undefined;
      setTerminalStatus('failed', failure);
    });
    terminalRef.current?.focus();
  }, [
    closeIntentRef,
    lastHostKeyWarningRef,
    panelId,
    pendingPasswordRef,
    pendingUsernameRef,
    session,
    setTerminalStatus,
    terminalRef,
  ]);

  return {
    closeSession,
    connectWithPassword,
    reconnectSession,
    resetKnownHostAndReconnect,
    trustHostKeyAndReconnect,
  };
}
