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
    kind: initialSession.kind === 'sftp' ? 'ssh' : initialSession.kind,
    name: initialSession.name,
    groupId: initialSession.groupId ?? '',
    newGroupName: '',
    host: initialSession.host ?? '',
    port: initialSession.port ?? (initialSession.kind === 'rdp' ? 3389 : 22),
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
      metadata: createSessionMetadata(input),
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

function createSessionMetadata(input: CreateSessionInput): SessionItem['metadata'] {
  if (input.authMethod !== 'key' || !input.privateKeyPath?.trim()) {
    return undefined;
  }

  return {
    privateKeyPath: input.privateKeyPath.trim(),
  };
}
