import { invoke } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';

import {
  createSshConnectionTarget,
  SshShellOpenError,
  type SshConnectionTargetOptions,
} from '@/features/connections/sshTarget';
import type { SessionItem } from '@/types/workspace';

export interface SshTerminalEvent {
  authPrompt: boolean;
  code?: SshTerminalErrorCode;
  data?: string;
  hostKeyFingerprint?: string;
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

export { SshShellOpenError };
export type SshShellOpenOptions = SshConnectionTargetOptions;

const lastSshPtySizeByPanel = new Map<string, string>();

export async function openSshShell(
  panelId: string,
  session: SessionItem,
  options: SshShellOpenOptions = {},
) {
  lastSshPtySizeByPanel.delete(panelId);

  await invoke('ssh_open_shell', {
    target: createSshConnectionTarget(panelId, session, options),
  });
}

export async function writeSshData(panelId: string, data: string) {
  await invoke('ssh_write', { data, panelId });
}

export async function resizeSshPty(panelId: string, terminal: Terminal) {
  if (!terminal.cols || !terminal.rows) {
    return;
  }

  const sizeKey = `${terminal.cols}x${terminal.rows}`;

  if (lastSshPtySizeByPanel.get(panelId) === sizeKey) {
    return;
  }

  await invoke('ssh_resize', {
    cols: terminal.cols,
    panelId,
    rows: terminal.rows,
  })
    .then(() => {
      lastSshPtySizeByPanel.set(panelId, sizeKey);
    })
    .catch(() => undefined);
}

export async function querySshCurrentDirectory(panelId: string): Promise<string | undefined> {
  return invoke<string | null>('ssh_query_cwd', { panelId })
    .then((path) => path ?? undefined)
    .catch(() => undefined);
}

export async function closeSshShell(panelId: string) {
  lastSshPtySizeByPanel.delete(panelId);
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
