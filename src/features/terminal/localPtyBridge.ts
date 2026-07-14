import { invoke } from '@tauri-apps/api/core';
import type { Terminal } from '@xterm/xterm';

export interface LocalPtyEvent {
  data?: string;
  message?: string;
  panelId: string;
  status: 'closed' | 'connected' | 'data' | 'failed';
}

export interface LocalPtyTarget {
  args?: string[];
  command: string;
  cwd?: string;
}

const lastLocalPtySizeByPanel = new Map<string, string>();

export async function openLocalPty(panelId: string, target: LocalPtyTarget) {
  lastLocalPtySizeByPanel.delete(panelId);

  await invoke('local_pty_open', {
    target: {
      args: target.args ?? null,
      command: target.command,
      cwd: target.cwd ?? null,
      panelId,
    },
  });
}

export async function writeLocalPtyData(panelId: string, data: string) {
  await invoke('local_pty_write', { data, panelId });
}

export async function resizeLocalPty(panelId: string, terminal: Terminal) {
  if (!terminal.cols || !terminal.rows) {
    return;
  }

  const sizeKey = `${terminal.cols}x${terminal.rows}`;

  if (lastLocalPtySizeByPanel.get(panelId) === sizeKey) {
    return;
  }

  await invoke('local_pty_resize', {
    cols: terminal.cols,
    panelId,
    rows: terminal.rows,
  })
    .then(() => {
      lastLocalPtySizeByPanel.set(panelId, sizeKey);
    })
    .catch(() => undefined);
}

export async function closeLocalPty(panelId: string) {
  lastLocalPtySizeByPanel.delete(panelId);
  await invoke('local_pty_close', { panelId });
}

export async function openElevatedLocalTerminal(shell: 'cmd' | 'powershell') {
  await invoke('open_elevated_local_terminal', { shell });
}

export async function pasteClipboardToLocalPty(panelId: string) {
  const text = await navigator.clipboard.readText().catch(() => '');

  if (!text) {
    return;
  }

  await writeLocalPtyData(panelId, text).catch(() => undefined);
}
