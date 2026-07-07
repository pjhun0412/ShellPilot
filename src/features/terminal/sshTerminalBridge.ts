import { invoke } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';

import { resolveKeyCredentialRef, resolvePasswordCredentialRef } from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';

export interface SshTerminalEvent {
  data?: string;
  message?: string;
  panelId: string;
  status: 'closed' | 'connected' | 'data' | 'failed' | 'info';
}

export async function openSshShell(panelId: string, session: SessionItem, password?: string) {
  const privateKeyPath = typeof session.metadata?.privateKeyPath === 'string' ? session.metadata.privateKeyPath : null;

  await invoke('ssh_open_shell', {
    target: {
      authMethod: session.authMethod ?? 'password',
      credentialId:
        session.authMethod === 'key' || password ? null : resolvePasswordCredentialRef(session).id,
      host: session.host,
      panelId,
      password: password ?? null,
      passphrase: session.authMethod === 'key' ? password ?? null : null,
      passphraseCredentialId:
        session.authMethod === 'key' && !password
          ? resolveKeyCredentialRef(session).id
          : null,
      port: session.port ?? 22,
      privateKeyPath,
      username: session.username ?? '',
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

export async function pasteClipboardToSsh(panelId: string) {
  const text = await navigator.clipboard.readText().catch(() => '');

  if (!text) {
    return;
  }

  await writeSshData(panelId, text).catch(() => undefined);
}
