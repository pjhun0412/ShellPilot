import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  hasRememberedCredentialPassword,
  resolveKeyCredentialRef,
  resolvePasswordCredentialRef,
} from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';
import { SshShellOpenError, type SshShellOpenOptions } from '@/features/terminal/sshTerminalBridge';

export interface SftpEntry {
  filename: string;
  isDirectory: boolean;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  modifiedAt?: number;
  owner?: string;
  path: string;
  permissions?: string;
  size?: number;
}

export interface SftpListResult {
  entries: SftpEntry[];
  path: string;
}

export type SftpTransferDirection = 'download' | 'upload';
export type SftpTransferStatus = 'canceled' | 'completed' | 'failed' | 'progress' | 'started';

export interface SftpTransferEvent {
  direction: SftpTransferDirection;
  localPath: string;
  message?: string;
  panelId: string;
  remotePath: string;
  status: SftpTransferStatus;
  totalBytes: number;
  transferredBytes: number;
  transferId: string;
}

export async function openSftpSession(
  panelId: string,
  session: SessionItem,
  options: SshShellOpenOptions = {},
) {
  const target = createSftpTarget(panelId, session, options);

  await invoke('sftp_open', { target });
}

export async function listSftpDirectory(panelId: string, path: string) {
  return invoke<SftpListResult>('sftp_list', { panelId, path });
}

export async function keepaliveSftpSession(panelId: string) {
  await invoke('sftp_keepalive', { panelId });
}

export async function closeSftpSession(panelId: string) {
  await invoke('sftp_close', { panelId });
}

export async function createSftpDirectory(panelId: string, path: string) {
  await invoke('sftp_mkdir', { panelId, path });
}

export async function renameSftpPath(panelId: string, oldPath: string, newPath: string) {
  await invoke('sftp_rename', { newPath, oldPath, panelId });
}

export async function removeSftpFile(panelId: string, path: string) {
  await invoke('sftp_remove_file', { panelId, path });
}

export async function removeSftpDirectory(panelId: string, path: string) {
  await invoke('sftp_remove_dir', { panelId, path });
}

export async function uploadSftpFile(
  panelId: string,
  localPath: string,
  remotePath: string,
  transferId: string,
) {
  await invoke('sftp_upload', { localPath, panelId, remotePath, transferId });
}

export async function openSftpUploadStream(
  panelId: string,
  localPath: string,
  remotePath: string,
  transferId: string,
  totalBytes: number,
) {
  await invoke('sftp_upload_stream_open', { localPath, panelId, remotePath, totalBytes, transferId });
}

export async function writeSftpUploadStreamChunk(transferId: string, chunk: Uint8Array) {
  await invoke('sftp_upload_stream_chunk', chunk, {
    headers: { 'x-transfer-id': transferId },
  });
}

export async function closeSftpUploadStream(transferId: string) {
  await invoke('sftp_upload_stream_close', { transferId });
}

export async function downloadSftpFile(
  panelId: string,
  remotePath: string,
  localPath: string,
  transferId: string,
) {
  await invoke('sftp_download', { localPath, panelId, remotePath, transferId });
}

export async function cancelSftpTransfer(transferId: string) {
  await invoke('sftp_cancel_transfer', { transferId });
}

export async function revealLocalPath(path: string) {
  await invoke('reveal_local_path', { path });
}

export async function listenSftpTransferEvents(
  listener: (event: SftpTransferEvent) => void,
): Promise<UnlistenFn> {
  return listen<SftpTransferEvent>('shellpilot-sftp-transfer', (event) => listener(event.payload));
}

function createSftpTarget(panelId: string, session: SessionItem, options: SshShellOpenOptions) {
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

  return {
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
  };
}
