import { invoke } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';

import {
  hasRememberedCredentialPassword,
  resolveKeyCredentialRef,
  resolvePasswordCredentialRef,
} from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';

export interface SshTerminalEvent {
  authPrompt: boolean;
  code?: SshTerminalErrorCode;
  data?: string;
  message?: string;
  panelId: string;
  retryable: boolean;
  status: 'closed' | 'connected' | 'data' | 'failed' | 'info' | 'warning';
}

export type SshTerminalErrorCode =
  | 'auth_failed'
  | 'auth_missing'
  | 'agent_failed'
  | 'connection_refused'
  | 'connection_timeout'
  | 'connection_failed'
  | 'dns_failed'
  | 'host_key_mismatch'
  | 'host_key_unknown'
  | 'host_key_trusted'
  | 'network_unreachable'
  | 'session_failed'
  | 'username_missing'
  | string;

export class SshShellOpenError extends Error {
  authPrompt: boolean;
  code: SshTerminalErrorCode;
  retryable: boolean;

  constructor({
    authPrompt,
    code,
    message,
    retryable,
  }: {
    authPrompt: boolean;
    code: SshTerminalErrorCode;
    message: string;
    retryable: boolean;
  }) {
    super(message);
    this.name = 'SshShellOpenError';
    this.authPrompt = authPrompt;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface SshShellOpenOptions {
  acceptNewHostKey?: boolean;
  password?: string;
  username?: string;
}

export async function openSshShell(
  panelId: string,
  session: SessionItem,
  options: SshShellOpenOptions = {},
) {
  const privateKeyPath = typeof session.metadata?.privateKeyPath === 'string' ? session.metadata.privateKeyPath : null;
  const username = options.username?.trim() || session.username?.trim() || '';
  const usesPasswordCredential =
    session.authMethod === 'password' ||
    session.authMethod === 'os-credential' ||
    session.authMethod === 'interactive' ||
    !session.authMethod;
  const passwordCredentialRef = resolvePasswordCredentialRef(session);
  const hasPasswordCredential =
    session.credentialRef?.kind === 'password' ||
    hasRememberedCredentialPassword(passwordCredentialRef.id);

  if (!username) {
    throw new SshShellOpenError({
      authPrompt: true,
      code: 'username_missing',
      message: 'SSH username is not set. Enter a username to connect.',
      retryable: true,
    });
  }

  if (usesPasswordCredential && !options.password && !hasPasswordCredential) {
    throw new SshShellOpenError({
      authPrompt: true,
      code: 'auth_missing',
      message:
        session.authMethod === 'interactive'
          ? 'Interactive authentication response is not saved. Enter a response to connect.'
          : 'SSH password is not saved. Enter a password to connect.',
      retryable: true,
    });
  }

  await invoke('ssh_open_shell', {
    target: {
      acceptNewHostKey: options.acceptNewHostKey ?? false,
      authMethod: session.authMethod ?? 'password',
      credentialId: usesPasswordCredential && !options.password ? passwordCredentialRef.id : null,
      host: session.host,
      panelId,
      password: usesPasswordCredential ? options.password ?? null : null,
      passphrase: session.authMethod === 'key' ? options.password ?? null : null,
      passphraseCredentialId:
        session.authMethod === 'key' && !options.password
          ? resolveKeyCredentialRef(session).id
          : null,
      port: session.port ?? 22,
      privateKeyPath,
      username,
    },
  });
}

export async function writeSshData(panelId: string, data: string) {
  await invoke('ssh_write', { data, panelId });
}

export async function resizeSshPty(panelId: string, terminal: Terminal) {
  if (!terminal.cols || !terminal.rows) {
    return;
  }

  await invoke('ssh_resize', {
    cols: terminal.cols,
    panelId,
    rows: terminal.rows,
  }).catch(() => undefined);
}

export async function closeSshShell(panelId: string) {
  await invoke('ssh_close', { panelId });
}

export async function forgetSshKnownHost(session: SessionItem) {
  if (!session.host) {
    throw new Error('Host is required to reset SSH host key trust.');
  }

  await invoke<boolean>('forget_ssh_known_host', {
    host: session.host,
    port: session.port ?? 22,
  });
}

export async function pasteClipboardToSsh(panelId: string) {
  const text = await navigator.clipboard.readText().catch(() => '');

  if (!text) {
    return;
  }

  await writeSshData(panelId, text).catch(() => undefined);
}
