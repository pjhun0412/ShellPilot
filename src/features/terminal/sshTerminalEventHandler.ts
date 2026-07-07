import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import type { MutableRefObject } from 'react';

import {
  resolveKeyCredentialRef,
  resolvePasswordCredentialRef,
  saveSshSessionKeyPassphrase,
  saveSshSessionPassword,
} from '@/features/connections/sshConnection';
import { requestSessionPatch } from '@/features/sessions/sessionStorage';
import type { SessionItem } from '@/types/workspace';
import { resizeSshPty, type SshTerminalEvent } from './sshTerminalBridge';
import { isSshHostKeyFailure, type SshTerminalFailure } from './sshTerminalUi';

export type SshCloseIntent = 'dispose' | 'manual' | 'reconnect';

export interface SshHostKeyWarning {
  code?: string;
  message: string;
}

interface HandleSshTerminalEventOptions {
  closeIntentRef: MutableRefObject<SshCloseIntent | undefined>;
  event: SshTerminalEvent;
  fitAddon: FitAddon;
  fitTerminal: (panelId: string, terminal: Terminal, fitAddon: FitAddon) => void;
  lastHostKeyWarningRef: MutableRefObject<SshHostKeyWarning | undefined>;
  panelId: string;
  pendingPasswordRef: MutableRefObject<string | undefined>;
  pendingUsernameRef: MutableRefObject<string | undefined>;
  session: SessionItem;
  setTerminalStatus: (status: 'closed' | 'connecting' | 'connected' | 'failed' | 'restored', failure?: SshTerminalFailure) => void;
  shouldRememberPasswordRef: MutableRefObject<boolean>;
  shouldRememberUsernameRef: MutableRefObject<boolean>;
  terminal: Terminal;
}

export function handleSshTerminalEvent({
  closeIntentRef,
  event,
  fitAddon,
  fitTerminal,
  lastHostKeyWarningRef,
  panelId,
  pendingPasswordRef,
  pendingUsernameRef,
  session,
  setTerminalStatus,
  shouldRememberPasswordRef,
  shouldRememberUsernameRef,
  terminal,
}: HandleSshTerminalEventOptions) {
  if (event.panelId !== panelId) {
    return;
  }

  if (event.status === 'connected') {
    closeIntentRef.current = undefined;
    setTerminalStatus('connected');
    terminal.clear();
    terminal.focus();
    persistPromptedCredentials({
      pendingPasswordRef,
      pendingUsernameRef,
      session,
      shouldRememberPasswordRef,
      shouldRememberUsernameRef,
    });
    void resizeSshPty(panelId, terminal);
    fitTerminal(panelId, terminal, fitAddon);
    return;
  }

  if (event.status === 'info') {
    return;
  }

  if (event.status === 'warning') {
    if (isSshHostKeyFailure(event.code)) {
      lastHostKeyWarningRef.current = {
        code: event.code,
        message: event.message ?? 'SSH host key verification failed.',
      };
    }
    terminal.writeln(`\r\n${event.message ?? 'SSH security warning'}`);
    return;
  }

  if (event.status === 'data' && event.data) {
    terminal.write(event.data);
    return;
  }

  if (event.status === 'failed') {
    closeIntentRef.current = undefined;
    const hostKeyWarning = lastHostKeyWarningRef.current;
    const message =
      hostKeyWarning && isSshHostKeyFailure(event.code)
        ? hostKeyWarning.message
        : event.message ?? 'SSH session failed';

    setTerminalStatus('failed', {
      authPrompt: event.authPrompt,
      code: hostKeyWarning?.code ?? event.code,
      message,
      retryable: event.retryable,
    });
    return;
  }

  if (event.status === 'closed') {
    if (closeIntentRef.current === 'reconnect' || closeIntentRef.current === 'dispose') {
      return;
    }

    closeIntentRef.current = undefined;
    setTerminalStatus('closed');
    terminal.writeln('\r\n[closed]');
  }
}

function persistPromptedCredentials({
  pendingPasswordRef,
  pendingUsernameRef,
  session,
  shouldRememberPasswordRef,
  shouldRememberUsernameRef,
}: {
  pendingPasswordRef: MutableRefObject<string | undefined>;
  pendingUsernameRef: MutableRefObject<string | undefined>;
  session: SessionItem;
  shouldRememberPasswordRef: MutableRefObject<boolean>;
  shouldRememberUsernameRef: MutableRefObject<boolean>;
}) {
  if (pendingPasswordRef.current && shouldRememberPasswordRef.current) {
    const saveSecret =
      session.authMethod === 'key' ? saveSshSessionKeyPassphrase : saveSshSessionPassword;
    const credentialRef =
      session.authMethod === 'key'
        ? resolveKeyCredentialRef(session)
        : resolvePasswordCredentialRef(session);

    void saveSecret(session, pendingPasswordRef.current)
      .then(() => {
        requestSessionPatch({
          sessionId: session.id,
          patch: { credentialRef },
        });
      })
      .finally(() => {
        pendingPasswordRef.current = undefined;
      });
  } else {
    pendingPasswordRef.current = undefined;
  }

  if (pendingUsernameRef.current && shouldRememberUsernameRef.current) {
    requestSessionPatch({
      sessionId: session.id,
      patch: {
        username: pendingUsernameRef.current,
      },
    });
  }
  pendingUsernameRef.current = undefined;
}
