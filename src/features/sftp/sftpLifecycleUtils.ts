import type { SessionItem } from '@/types/workspace';

export function getSftpSessionConnectionKey(session: SessionItem) {
  return [
    session.id,
    session.host ?? '',
    session.port ?? 22,
    session.username ?? '',
    session.authMethod ?? '',
    session.credentialRef?.id ?? '',
    session.credentialRef?.kind ?? '',
    typeof session.metadata?.privateKeyPath === 'string' ? session.metadata.privateKeyPath : '',
  ].join('|');
}

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
