import type { SessionItem } from '@/types/workspace';
import { SshShellOpenError } from './sshTerminalBridge';

export interface SshTerminalFailure {
  authPrompt: boolean;
  code?: string;
  message: string;
  retryable: boolean;
}

export function getSshEndpointLabel(session: SessionItem) {
  const username = session.username?.trim();
  const userPrefix = username ? `${username}@` : '';

  return `${userPrefix}${session.host}:${session.port ?? 22}`;
}

export function getSshSecretLabel(session: SessionItem) {
  if (session.authMethod === 'key') {
    return 'key passphrase';
  }

  if (session.authMethod === 'interactive') {
    return 'interactive response';
  }

  return 'password';
}

export function isSshHostKeyFailure(code?: string) {
  return code === 'host_key_unknown' || code === 'host_key_mismatch';
}

export function getSshOpenFailure(error: unknown): SshTerminalFailure {
  if (error instanceof SshShellOpenError) {
    return {
      authPrompt: error.authPrompt,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    authPrompt: false,
    code: 'connection_failed',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

export function getSshFailureTitle(code?: string) {
  if (code === 'username_missing') {
    return 'SSH username required';
  }

  if (code === 'auth_missing') {
    return 'SSH credential required';
  }

  if (code === 'auth_failed') {
    return 'SSH authentication failed';
  }

  if (code === 'agent_failed') {
    return 'SSH agent unavailable';
  }

  if (code === 'host_key_mismatch') {
    return 'SSH host key blocked';
  }

  if (code === 'host_key_unknown') {
    return 'Unknown SSH host key';
  }

  if (code === 'connection_refused') {
    return 'SSH connection refused';
  }

  if (code === 'connection_timeout') {
    return 'SSH connection timeout';
  }

  if (code === 'dns_failed') {
    return 'SSH host not resolved';
  }

  if (code === 'network_unreachable') {
    return 'SSH network unreachable';
  }

  return 'SSH connection failed';
}

export function shouldPromptUsername(code: string | undefined, session: SessionItem) {
  return code === 'username_missing' || !session.username?.trim();
}

export function shouldPromptSecret(code: string | undefined, session: SessionItem) {
  const usesSecret =
    session.authMethod === 'password' ||
    session.authMethod === 'os-credential' ||
    session.authMethod === 'interactive' ||
    !session.authMethod;

  if (!usesSecret) {
    return code === 'auth_failed';
  }

  return (
    code === 'auth_missing' ||
    code === 'auth_failed' ||
    (code === 'username_missing' && session.credentialRef?.kind !== 'password')
  );
}
