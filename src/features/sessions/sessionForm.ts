import type { SessionItem } from '@/types/workspace';
import {
  createCredentialLabel,
  createCredentialRef,
  createPendingCredentialSecret,
  type PendingCredentialSecret,
} from './session.security';
import type { CreateSessionInput } from './session.schema';

export const defaultSessionFormValues: CreateSessionInput = {
  kind: 'ssh',
  name: '',
  groupId: '',
  newGroupName: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  secret: '',
  privateKeyPath: '',
  passphrase: '',
  saveCredential: true,
  tags: '',
  favorite: false,
};

export interface CreateSessionResult {
  groupName?: string;
  secret?: PendingCredentialSecret;
  session: SessionItem;
}

export function getSessionFormValues({
  initialGroupId,
  initialSession,
}: {
  initialGroupId?: string;
  initialSession?: SessionItem;
}): CreateSessionInput {
  if (!initialSession) {
    return {
      ...defaultSessionFormValues,
      groupId: initialGroupId ?? '',
    };
  }

  return {
    kind: initialSession.kind === 'sftp' || initialSession.kind === 'ftp' || initialSession.kind === 'rdp' || initialSession.kind === 'vnc'
      ? initialSession.kind
      : 'ssh',
    name: initialSession.name,
    groupId: initialSession.groupId ?? '',
    newGroupName: '',
    host: initialSession.host ?? '',
    port: initialSession.port ?? getDefaultPort(initialSession.kind),
    username: initialSession.username ?? '',
    authMethod:
      initialSession.authMethod === 'os-credential'
        ? 'password'
        : initialSession.authMethod ?? 'password',
    secret: '',
    privateKeyPath:
      typeof initialSession.metadata?.privateKeyPath === 'string'
        ? initialSession.metadata.privateKeyPath
        : '',
    passphrase: '',
    saveCredential: true,
    tags: initialSession.tags?.join(', ') ?? '',
    favorite: Boolean(initialSession.favorite),
  };
}

function getDefaultPort(kind: SessionItem['kind']) {
  if (kind === 'rdp') {
    return 3389;
  }

  if (kind === 'vnc') {
    return 5900;
  }

  if (kind === 'ftp') {
    return 21;
  }

  return 22;
}

export function buildCreateSessionResult({
  initialSession,
  input,
}: {
  initialSession?: SessionItem;
  input: CreateSessionInput;
}): CreateSessionResult {
  const timestamp = Date.now();
  const sessionId = initialSession?.id ?? `${input.kind}-${crypto.randomUUID()}`;
  const selectedGroupId = input.groupId === '__new__' ? undefined : input.groupId || undefined;
  const newGroupName = input.groupId === '__new__' ? input.newGroupName?.trim() : undefined;
  const tags = input.tags
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const credentialRef = createCredentialRef({
    authMethod: input.authMethod,
    label: createCredentialLabel(input),
    sessionId,
  });
  const secret = createPendingCredentialSecret({ input, sessionId });

  return {
    groupName: newGroupName,
    secret,
    session: {
      id: sessionId,
      name: input.name,
      kind: input.kind,
      status: initialSession?.status ?? 'unknown',
      groupId: selectedGroupId,
      host: input.host || undefined,
      port: input.port,
      username: input.username || undefined,
      authMethod: input.authMethod,
      credentialRef: resolveSessionCredentialRef({
        credentialRef,
        initialSession,
        input,
        secret,
      }),
      favorite: Boolean(input.favorite),
      tags,
      metadata: createSessionMetadata(input, initialSession),
      createdAt: initialSession?.createdAt ?? timestamp,
      updatedAt: timestamp,
    },
  };
}

function resolveSessionCredentialRef({
  credentialRef,
  initialSession,
  input,
  secret,
}: {
  credentialRef?: SessionItem['credentialRef'];
  initialSession?: SessionItem;
  input: CreateSessionInput;
  secret?: PendingCredentialSecret;
}) {
  if (input.authMethod === 'key') {
    if (secret?.kind === 'key' && secret.shouldSave && secret.passphrase) {
      return credentialRef;
    }

    return initialSession?.authMethod === 'key' ? initialSession.credentialRef : undefined;
  }

  return secret?.shouldSave || initialSession?.credentialRef
    ? credentialRef ?? initialSession?.credentialRef
    : undefined;
}

function createSessionMetadata(input: CreateSessionInput, initialSession?: SessionItem): SessionItem['metadata'] {
  const nextMetadata: Record<string, unknown> = { ...initialSession?.metadata };

  if (input.authMethod === 'key' && input.privateKeyPath?.trim()) {
    nextMetadata.privateKeyPath = input.privateKeyPath.trim();
  } else {
    delete nextMetadata.privateKeyPath;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}
