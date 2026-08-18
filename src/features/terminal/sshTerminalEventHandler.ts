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
import type { SshTerminalOutputAcknowledger } from './sshTerminalOutput';
import type { SshTerminalPerformanceDebug } from './sshTerminalPerformanceDebug';
import type { TerminalWriteBuffer } from './terminalPerformance';

export type SshCloseIntent = 'dispose' | 'manual' | 'reconnect';

export interface SshHostKeyWarning {
  code?: string;
  fingerprint?: string;
  message: string;
}

interface HandleSshTerminalEventOptions {
  closeIntentRef: MutableRefObject<SshCloseIntent | undefined>;
  event: SshTerminalEvent;
  failedAttemptRef: MutableRefObject<boolean>;
  fitTerminal: () => void;
  lastHostKeyWarningRef: MutableRefObject<SshHostKeyWarning | undefined>;
  panelId: string;
  pendingPasswordRef: MutableRefObject<string | undefined>;
  pendingUsernameRef: MutableRefObject<string | undefined>;
  outputAcknowledger: SshTerminalOutputAcknowledger;
  performanceDebug: SshTerminalPerformanceDebug;
  refreshDiagnostics: () => void;
  session: SessionItem;
  setTerminalStatus: (status: 'closed' | 'connecting' | 'connected' | 'failed' | 'restored', failure?: SshTerminalFailure) => void;
  shouldRememberPasswordRef: MutableRefObject<boolean>;
  shouldRememberUsernameRef: MutableRefObject<boolean>;
  terminal: Terminal;
  writeBuffer: TerminalWriteBuffer;
}

export function handleSshTerminalEvent({
  closeIntentRef,
  event,
  failedAttemptRef,
  fitTerminal,
  lastHostKeyWarningRef,
  panelId,
  pendingPasswordRef,
  pendingUsernameRef,
  outputAcknowledger,
  performanceDebug,
  refreshDiagnostics,
  session,
  setTerminalStatus,
  shouldRememberPasswordRef,
  shouldRememberUsernameRef,
  terminal,
  writeBuffer,
}: HandleSshTerminalEventOptions) {
  if (event.panelId !== panelId) {
    return;
  }

  if (
    event.outputStreamId !== undefined &&
    !outputAcknowledger.acceptStream(event.outputStreamId)
  ) {
    return;
  }
  if (event.outputStreamId !== undefined) {
    performanceDebug.acceptStream(event.outputStreamId);
  }

  if (event.status === 'connected') {
    writeBuffer.flush();
    closeIntentRef.current = undefined;
    failedAttemptRef.current = false;
    setTerminalStatus('connected');
    terminal.clear();
    refreshDiagnostics();
    terminal.focus();
    persistPromptedCredentials({
      pendingPasswordRef,
      pendingUsernameRef,
      session,
      shouldRememberPasswordRef,
      shouldRememberUsernameRef,
    });
    void resizeSshPty(panelId, terminal);
    fitTerminal();
    return;
  }

  if (event.status === 'info') {
    return;
  }

  if (event.status === 'warning') {
    writeBuffer.flush();
    if (isSshHostKeyFailure(event.code)) {
      lastHostKeyWarningRef.current = {
        code: event.code,
        fingerprint: event.hostKeyFingerprint ?? extractSshHostKeyFingerprint(event.message),
        message: event.message ?? 'SSH host key verification failed.',
      };
    }
    terminal.writeln(`\r\n${event.message ?? 'SSH security warning'}`);
    return;
  }

  if (event.status === 'data' && event.data) {
    const { outputSequence, outputStreamId } = event;
    const receivedAt =
      outputStreamId === undefined
        ? 0
        : performanceDebug.recordData(outputStreamId, event.data.length);
    writeBuffer.write(
      event.data,
      outputSequence !== undefined && outputStreamId !== undefined
        ? () => {
            performanceDebug.recordParsed(outputStreamId, receivedAt);
            outputAcknowledger.acknowledge(outputStreamId, outputSequence);
          }
        : undefined,
    );
    return;
  }

  if (event.status === 'failed') {
    writeBuffer.flush();
    outputAcknowledger.endStream(event.outputStreamId);
    performanceDebug.endStream(event.outputStreamId);
    closeIntentRef.current = undefined;
    failedAttemptRef.current = true;
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
    writeBuffer.flush();
    outputAcknowledger.endStream(event.outputStreamId);
    performanceDebug.endStream(event.outputStreamId);
    if (failedAttemptRef.current) {
      closeIntentRef.current = undefined;
      return;
    }

    if (closeIntentRef.current === 'reconnect' || closeIntentRef.current === 'dispose') {
      return;
    }

    closeIntentRef.current = undefined;
    setTerminalStatus('closed');
    terminal.writeln('\r\n[closed]');
  }
}

function extractSshHostKeyFingerprint(message?: string) {
  return /Fingerprint:\s*([^\s]+)/i.exec(message ?? '')?.[1];
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
