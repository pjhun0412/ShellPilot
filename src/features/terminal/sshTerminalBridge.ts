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
  outputSequence?: number;
  outputStreamId?: number;
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

interface SshPtySize {
  cols: number;
  key: string;
  rows: number;
}

const lastSshPtySizeByPanel = new Map<string, string>();
const inFlightSshPtySizeByPanel = new Map<string, string>();
const queuedSshPtySizeByPanel = new Map<string, SshPtySize>();

export async function openSshShell(
  panelId: string,
  session: SessionItem,
  options: SshShellOpenOptions = {},
) {
  lastSshPtySizeByPanel.delete(panelId);
  inFlightSshPtySizeByPanel.delete(panelId);
  queuedSshPtySizeByPanel.delete(panelId);

  await invoke('ssh_open_shell', {
    target: createSshConnectionTarget(panelId, session, options),
  });
}

export async function writeSshData(panelId: string, data: string) {
  await invoke('ssh_write', { data, panelId });
}

export async function acknowledgeSshOutput(
  panelId: string,
  streamId: number,
  throughSequence: number,
) {
  await invoke('ssh_ack_output', {
    panelId,
    streamId,
    throughSequence,
  });
}

export async function resizeSshPty(panelId: string, terminal: Terminal) {
  const size = getTerminalPtySize(terminal);

  if (!size) {
    return;
  }

  await scheduleSshPtyResize(panelId, size);
}

function getTerminalPtySize(terminal: Terminal): SshPtySize | undefined {
  if (!terminal.cols || !terminal.rows) {
    return undefined;
  }

  return {
    cols: terminal.cols,
    key: `${terminal.cols}x${terminal.rows}`,
    rows: terminal.rows,
  };
}

async function scheduleSshPtyResize(panelId: string, size: SshPtySize): Promise<void> {
  if (lastSshPtySizeByPanel.get(panelId) === size.key) {
    return;
  }

  if (inFlightSshPtySizeByPanel.has(panelId)) {
    queuedSshPtySizeByPanel.set(panelId, size);
    return;
  }

  inFlightSshPtySizeByPanel.set(panelId, size.key);

  try {
    await invoke('ssh_resize', {
      cols: size.cols,
      panelId,
      rows: size.rows,
    });
    lastSshPtySizeByPanel.set(panelId, size.key);
  } catch {
    // Resize is best-effort; a later fit/resize pass will retry the current size.
  } finally {
    if (inFlightSshPtySizeByPanel.get(panelId) === size.key) {
      inFlightSshPtySizeByPanel.delete(panelId);
    }

    const queuedSize = queuedSshPtySizeByPanel.get(panelId);

    if (queuedSize) {
      queuedSshPtySizeByPanel.delete(panelId);
      await scheduleSshPtyResize(panelId, queuedSize);
    }
  }
}

export async function querySshCurrentDirectory(panelId: string): Promise<string | undefined> {
  return invoke<string | null>('ssh_query_cwd', { panelId })
    .then((path) => path ?? undefined)
    .catch(() => undefined);
}

export async function closeSshShell(panelId: string) {
  lastSshPtySizeByPanel.delete(panelId);
  inFlightSshPtySizeByPanel.delete(panelId);
  queuedSshPtySizeByPanel.delete(panelId);
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

export async function pasteClipboardToSsh(panelId: string, terminal?: Terminal) {
  const text = await navigator.clipboard.readText().catch(() => '');

  if (!text) {
    return;
  }

  if (terminal) {
    terminal.paste(text);
    return;
  }

  await writeSshData(panelId, text).catch(() => undefined);
}
