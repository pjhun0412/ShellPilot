import type { AuthMethod, CredentialKind, CredentialRef } from '@/types/workspace';
import type { CreateSessionInput } from './session.schema';

export type PendingCredentialSecret =
  | {
      credentialRef: CredentialRef;
      kind: 'password';
      shouldSave: boolean;
      secret: string;
    }
  | {
      credentialRef: CredentialRef;
      kind: 'key';
      passphrase?: string;
      privateKeyPath: string;
      shouldSave: boolean;
    };

export function getCredentialKindForAuthMethod(authMethod: AuthMethod): CredentialKind | undefined {
  if (authMethod === 'password' || authMethod === 'os-credential' || authMethod === 'interactive') {
    return 'password';
  }

  if (authMethod === 'key') {
    return 'key';
  }

  return undefined;
}

export function createCredentialRef({
  authMethod,
  label,
  sessionId,
}: {
  authMethod: AuthMethod;
  label?: string;
  sessionId: string;
}): CredentialRef | undefined {
  const kind = getCredentialKindForAuthMethod(authMethod);

  if (!kind) {
    return undefined;
  }

  return {
    id: createCredentialId(sessionId, kind),
    kind,
    label: label || 'Backend credential store',
  };
}

export function createCredentialId(sessionId: string, kind: CredentialKind) {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');

  return `shellpilot_${safeSessionId}_${kind}`;
}

export function createCredentialLabel(input: Pick<CreateSessionInput, 'authMethod' | 'host' | 'kind' | 'name' | 'username'>) {
  const target = input.host?.trim() || input.name.trim() || 'session';
  const account = input.username?.trim();
  const authName =
    input.authMethod === 'key'
      ? 'SSH key'
      : input.authMethod === 'interactive'
        ? 'interactive response'
        : 'password';

  if (account) {
    return `${input.kind.toUpperCase()} ${account}@${target} ${authName}`;
  }

  return `${input.kind.toUpperCase()} ${target} ${authName}`;
}

export function createPendingCredentialSecret({
  input,
  sessionId,
}: {
  input: CreateSessionInput;
  sessionId: string;
}): PendingCredentialSecret | undefined {
  const credentialRef = createCredentialRef({
    authMethod: input.authMethod,
    label: createCredentialLabel(input),
    sessionId,
  });

  if (!credentialRef) {
    return undefined;
  }

  if (
    (input.authMethod === 'password' ||
      input.authMethod === 'os-credential' ||
      input.authMethod === 'interactive') &&
    input.secret
  ) {
    return {
      credentialRef,
      kind: 'password',
      shouldSave: Boolean(input.saveCredential),
      secret: input.secret,
    };
  }

  if (input.authMethod === 'key' && input.privateKeyPath) {
    return {
      credentialRef,
      kind: 'key',
      passphrase: input.passphrase || undefined,
      privateKeyPath: input.privateKeyPath,
      shouldSave: Boolean(input.saveCredential),
    };
  }

  return undefined;
}

export function getCredentialMemoryRule() {
  return 'Secrets are never stored in Session data or localStorage. The UI only keeps a credential reference; the Tauri backend will own secret material.';
}
