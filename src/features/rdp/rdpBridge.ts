import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { resolvePasswordCredentialRef } from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';
import { getLocalScreenResolution } from './rdpDisplayOptions';

export type RdpStatus = 'closed' | 'connected' | 'connecting' | 'failed' | 'frameReady';

export interface RdpEvent {
  certificateFingerprint?: string;
  code?: string;
  desktopHeight?: number;
  desktopWidth?: number;
  message?: string;
  panelId: string;
  retryable: boolean;
  status: RdpStatus;
}

export interface RdpFrameEvent {
  data: string;
  height: number;
  panelId: string;
  sequence: number;
  width: number;
  x: number;
  y: number;
}

export interface RdpClipboardTextEvent {
  panelId: string;
  text: string;
}

export type RdpInput =
  | { type: 'mouseMove'; x: number; y: number }
  | { type: 'mouseButton'; x: number; y: number; button: 'left' | 'middle' | 'right'; down: boolean }
  | { type: 'mouseWheel'; x: number; y: number; delta: number }
  | { type: 'key'; code: number; extended: boolean; down: boolean }
  | { type: 'pasteText'; text: string }
  | { type: 'clipboardText'; text: string }
  | { type: 'clipboardFiles'; paths: string[] }
  | { type: 'resize'; width: number; height: number };

export class RdpOpenError extends Error {
  readonly authPrompt: boolean;
  readonly retryable: boolean;

  constructor(message: string, options: { authPrompt?: boolean; retryable?: boolean } = {}) {
    super(message);
    this.name = 'RdpOpenError';
    this.authPrompt = options.authPrompt ?? false;
    this.retryable = options.retryable ?? true;
  }
}

export async function openRdpSession(
  panelId: string,
  session: SessionItem,
  options: {
    acceptNewCertificate?: boolean;
    desktopHeight?: number;
    desktopWidth?: number;
    password?: string;
  } = {},
) {
  const target = createRdpTarget(panelId, session, options);

  await invoke('rdp_open', { target });
}

export async function closeRdpSession(panelId: string) {
  await invoke('rdp_close', { panelId });
}

export async function forgetRdpCertificate(session: SessionItem) {
  if (!session.host?.trim()) {
    throw new RdpOpenError('RDP host is not set.', { retryable: false });
  }

  await invoke('rdp_forget_certificate', {
    host: session.host,
    port: session.port ?? 3389,
  });
}

export async function sendRdpInput(panelId: string, input: RdpInput) {
  await invoke('rdp_send_input', { panelId, input });
}

export async function pasteRdpClipboardFiles(panelId: string): Promise<number> {
  return invoke<number>('rdp_paste_clipboard_files', { panelId });
}

export async function setLocalClipboardText(text: string) {
  await invoke('rdp_set_local_clipboard_text', { text });
}

export async function setWindowsKeyCapture(panelId: string | null) {
  await invoke('rdp_set_windows_key_capture', { panelId });
}

export async function listenRdpEvents(listener: (event: RdpEvent) => void): Promise<UnlistenFn> {
  return listen<RdpEvent>('shellpilot-rdp', (event) => listener(event.payload));
}

export async function listenRdpFrames(
  listener: (event: RdpFrameEvent) => void,
): Promise<UnlistenFn> {
  return listen<RdpFrameEvent>('shellpilot-rdp-frame', (event) => listener(event.payload));
}

export async function listenRdpClipboardText(
  listener: (event: RdpClipboardTextEvent) => void,
): Promise<UnlistenFn> {
  return listen<RdpClipboardTextEvent>('shellpilot-rdp-clipboard', (event) => listener(event.payload));
}

function createRdpTarget(
  panelId: string,
  session: SessionItem,
  options: {
    acceptNewCertificate?: boolean;
    desktopHeight?: number;
    desktopWidth?: number;
    password?: string;
  },
) {
  const username = session.username?.trim() ?? '';
  const usesPasswordCredential =
    session.authMethod === 'password' ||
    session.authMethod === 'os-credential' ||
    session.authMethod === 'interactive' ||
    !session.authMethod;
  const passwordCredentialRef = resolvePasswordCredentialRef(session);

  if (!session.host?.trim()) {
    throw new RdpOpenError('RDP host is not set.', { retryable: false });
  }

  if (!username) {
    throw new RdpOpenError('RDP username is not set. Enter a username to connect.', {
      authPrompt: true,
    });
  }

  if (usesPasswordCredential && !options.password && !session.credentialRef) {
    throw new RdpOpenError('RDP password is not saved. Enter a password to connect.', {
      authPrompt: true,
    });
  }

  const fallbackResolution = getLocalScreenResolution();

  return {
    acceptNewCertificate: options.acceptNewCertificate ?? false,
    credentialId: usesPasswordCredential && !options.password ? passwordCredentialRef.id : null,
    desktopHeight: options.desktopHeight ?? fallbackResolution.height,
    desktopWidth: options.desktopWidth ?? fallbackResolution.width,
    domain: null,
    host: session.host,
    panelId,
    password: usesPasswordCredential ? options.password ?? null : null,
    port: session.port ?? 3389,
    username,
  };
}
