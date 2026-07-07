import { invoke } from '@tauri-apps/api/core';

import { createCredentialId } from '@/features/sessions/session.security';
import type { CredentialRef, SessionItem } from '@/types/workspace';

export interface SshProbeResult {
  connected: boolean;
  elapsedMs: number;
  host: string;
  isSsh: boolean;
  port: number;
  sshBanner?: string;
}

export interface SshAuthResult {
  authenticated: boolean;
  elapsedMs: number;
  host: string;
  port: number;
  username: string;
}

export type SshConnectionResult =
  | { mode: 'auth'; result: SshAuthResult }
  | { mode: 'probe'; result: SshProbeResult };

const passwordMemoryCache = new Map<string, string>();

export async function probeSshConnection(session: SessionItem): Promise<SshProbeResult> {
  if (!session.host) {
    throw new Error('Host is required for SSH connection test.');
  }

  return invoke<SshProbeResult>('probe_ssh_connection', {
    host: session.host,
    port: session.port ?? 22,
    timeoutMs: 5000,
  });
}

export async function connectSshSession(session: SessionItem): Promise<SshConnectionResult> {
  if (!session.host) {
    throw new Error('Host is required for SSH connection.');
  }

  if (session.authMethod === 'password' || session.authMethod === 'os-credential') {
    const cachedPassword = passwordMemoryCache.get(resolvePasswordCredentialRef(session).id);

    if (cachedPassword) {
      return connectSshSessionWithPassword(session, cachedPassword);
    }

    const result = await invoke<SshAuthResult>('connect_ssh_password', {
      credentialId: resolvePasswordCredentialRef(session).id,
      host: session.host,
      password: null,
      port: session.port ?? 22,
      timeoutMs: 8000,
      username: session.username ?? '',
    });

    return { mode: 'auth', result };
  }

  const result = await probeSshConnection(session);
  return { mode: 'probe', result };
}

export async function connectSshSessionWithPassword(
  session: SessionItem,
  password: string,
): Promise<SshConnectionResult> {
  if (!session.host) {
    throw new Error('Host is required for SSH connection.');
  }

  const result = await invoke<SshAuthResult>('connect_ssh_password', {
    credentialId: null,
    host: session.host,
    password,
    port: session.port ?? 22,
    timeoutMs: 8000,
    username: session.username ?? '',
  });

  return { mode: 'auth', result };
}

export async function saveSshSessionPassword(session: SessionItem, password: string) {
  const credentialId = resolvePasswordCredentialRef(session).id;

  await invoke('save_credential', {
    id: credentialId,
    secret: password,
  });
  rememberCredentialPassword(credentialId, password);
}

export async function saveSshSessionKeyPassphrase(session: SessionItem, passphrase: string) {
  const credentialId = resolveKeyCredentialRef(session).id;

  await invoke('save_credential', {
    id: credentialId,
    secret: passphrase,
  });
}

export function rememberSshSessionPassword(session: SessionItem, password: string) {
  rememberCredentialPassword(resolvePasswordCredentialRef(session).id, password);
}

export function rememberCredentialPassword(credentialId: string, password: string) {
  passwordMemoryCache.set(credentialId, password);
}

export function hasRememberedCredentialPassword(credentialId: string) {
  return passwordMemoryCache.has(credentialId);
}

export function forgetCredentialPassword(credentialId: string) {
  passwordMemoryCache.delete(credentialId);
}

export function resolvePasswordCredentialRef(session: SessionItem): CredentialRef {
  if (session.credentialRef?.kind === 'password') {
    return session.credentialRef;
  }

  return {
    id: createCredentialId(session.id, 'password'),
    kind: 'password',
    label: `SSH ${session.username ? `${session.username}@` : ''}${session.host ?? session.name} password`,
  };
}

export function resolveKeyCredentialRef(session: SessionItem): CredentialRef {
  if (session.credentialRef?.kind === 'key') {
    return session.credentialRef;
  }

  return {
    id: createCredentialId(session.id, 'key'),
    kind: 'key',
    label: `SSH ${session.username ? `${session.username}@` : ''}${session.host ?? session.name} key passphrase`,
  };
}

export function canProbeSshConnection(session?: SessionItem): session is SessionItem & { host: string } {
  return Boolean(session?.kind === 'ssh' && session.host);
}
