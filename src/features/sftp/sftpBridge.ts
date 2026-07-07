import { invoke } from '@tauri-apps/api/core';

import {
  hasRememberedCredentialPassword,
  resolveKeyCredentialRef,
  resolvePasswordCredentialRef,
} from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';
import { SshShellOpenError, type SshShellOpenOptions } from '@/features/terminal/sshTerminalBridge';

export interface SftpEntry {
  filename: string;
  path: string;
}

export interface SftpListResult {
  entries: SftpEntry[];
  path: string;
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
