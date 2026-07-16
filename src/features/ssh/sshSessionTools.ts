import type { SessionItem } from '@/types/workspace';

export interface SshFavoritePath {
  id: string;
  label: string;
  path: string;
}

interface SshSessionMetadata {
  favoritePaths: SshFavoritePath[];
}

export function readSshSessionMetadata(session?: SessionItem): SshSessionMetadata {
  const sshMetadata = readObject(session?.metadata?.ssh);
  const favoritePaths = Array.isArray(sshMetadata?.favoritePaths)
    ? sshMetadata.favoritePaths.filter(isFavoritePath)
    : [];

  return { favoritePaths };
}

export function writeSshFavoritePathsMetadata(
  session: SessionItem,
  favoritePaths: SshFavoritePath[],
) {
  const currentSshMetadata = readObject(session.metadata?.ssh);

  return {
    ...(session.metadata ?? {}),
    ssh: {
      ...(currentSshMetadata ?? {}),
      favoritePaths,
    },
  };
}

export function createSshFavoritePath(path: string, label?: string): SshFavoritePath {
  const trimmedPath = normalizeSshPath(path);

  return {
    id: `ssh-path-${crypto.randomUUID()}`,
    label: label?.trim() || createPathLabel(trimmedPath),
    path: trimmedPath,
  };
}

export function normalizeSshPath(path: string) {
  return path.trim();
}

export function createSshCdCommand(path: string) {
  return `cd -- ${quotePosixShellPath(path)}\r`;
}

function createPathLabel(path: string) {
  if (!path || path === '/') {
    return path || 'Path';
  }

  const segments = path.split('/').filter(Boolean);

  return segments[segments.length - 1] ?? path;
}

function quotePosixShellPath(path: string) {
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function isFavoritePath(value: unknown): value is SshFavoritePath {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<SshFavoritePath>;

  return (
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    typeof item.path === 'string' &&
    item.path.trim().length > 0
  );
}
