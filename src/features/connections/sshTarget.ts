import {
  hasRememberedCredentialPassword,
  resolvePasswordCredentialRef,
} from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';

export interface SshConnectionTargetOptions {
  acceptNewHostKey?: boolean;
  acceptedHostKeyFingerprint?: string;
  password?: string;
  username?: string;
  validateUsername?: boolean;
  validatePasswordCredential?: boolean;
}

export interface SshConnectionTarget {
  acceptNewHostKey: boolean;
  acceptedHostKeyFingerprint: string | null;
  authMethod: string;
  credentialId: string | null;
  host?: string;
  panelId: string;
  password: string | null;
  passphrase: string | null;
  passphraseCredentialId: string | null;
  port: number;
  privateKeyPath: string | null;
  sessionId: string;
  username: string;
}

export class SshShellOpenError extends Error {
  authPrompt: boolean;
  code: string;
  retryable: boolean;

  constructor({
    authPrompt,
    code,
    message,
    retryable,
  }: {
    authPrompt: boolean;
    code: string;
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

export function createSshConnectionTarget(
  panelId: string,
  session: SessionItem,
  options: SshConnectionTargetOptions = {},
): SshConnectionTarget {
  const privateKeyPath = typeof session.metadata?.privateKeyPath === 'string' ? session.metadata.privateKeyPath : null;
  const username = options.username?.trim() || session.username?.trim() || '';
  const usesPasswordCredential = usesPasswordAuth(session);
  const passwordCredentialRef = resolvePasswordCredentialRef(session);
  const validateUsername = options.validateUsername ?? true;
  const validatePasswordCredential = options.validatePasswordCredential ?? true;
  const hasPasswordCredential =
    session.credentialRef?.kind === 'password' ||
    hasRememberedCredentialPassword(passwordCredentialRef.id);

  if (validateUsername && !username) {
    throw new SshShellOpenError({
      authPrompt: true,
      code: 'username_missing',
      message: 'SSH username is not set. Enter a username to connect.',
      retryable: true,
    });
  }

  if (validatePasswordCredential && usesPasswordCredential && !options.password && !hasPasswordCredential) {
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
    acceptedHostKeyFingerprint: options.acceptedHostKeyFingerprint ?? null,
    authMethod: session.authMethod ?? 'password',
    credentialId: usesPasswordCredential && !options.password ? passwordCredentialRef.id : null,
    host: session.host,
    panelId,
    password: usesPasswordCredential ? options.password ?? null : null,
    passphrase: session.authMethod === 'key' ? options.password ?? null : null,
    passphraseCredentialId:
      session.authMethod === 'key' &&
      !options.password &&
      session.credentialRef?.kind === 'key'
        ? session.credentialRef.id
        : null,
    port: session.port ?? 22,
    privateKeyPath,
    sessionId: session.id,
    username,
  };
}

function usesPasswordAuth(session: SessionItem) {
  return (
    session.authMethod === 'password' ||
    session.authMethod === 'os-credential' ||
    session.authMethod === 'interactive' ||
    !session.authMethod
  );
}
