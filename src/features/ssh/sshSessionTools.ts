import type { SessionItem } from '@/types/workspace';

export interface SshFavoritePath {
  id: string;
  label: string;
  path: string;
}

export interface SshCommandSnippet {
  basePath?: string;
  command: string;
  displayCommand?: string;
  id: string;
  label: string;
}

export interface SshSessionMetadata {
  commandSnippets: SshCommandSnippet[];
  favoritePaths: SshFavoritePath[];
}

export interface SshSessionMetadataChange {
  metadata: SshSessionMetadata;
  sessionId: string;
}

const sshSessionMetadataListeners = new Set<(change: SshSessionMetadataChange) => void>();

export function notifySshSessionMetadataChanged(change: SshSessionMetadataChange) {
  sshSessionMetadataListeners.forEach((listener) => listener(change));
}

export function subscribeSshSessionMetadataChanged(
  listener: (change: SshSessionMetadataChange) => void,
) {
  sshSessionMetadataListeners.add(listener);
  return () => {
    sshSessionMetadataListeners.delete(listener);
  };
}

export function readSshSessionMetadata(session?: SessionItem): SshSessionMetadata {
  const sshMetadata = readObject(session?.metadata?.ssh);
  const favoritePaths = Array.isArray(sshMetadata?.favoritePaths)
    ? sshMetadata.favoritePaths.filter(isFavoritePath)
    : [];
  const commandSnippets = Array.isArray(sshMetadata?.commandSnippets)
    ? sshMetadata.commandSnippets.filter(isCommandSnippet)
    : [];

  return { commandSnippets, favoritePaths };
}

export function writeSshFavoritePathsMetadata(
  session: SessionItem,
  favoritePaths: SshFavoritePath[],
) {
  return writeSshMetadataPatch(session, { favoritePaths });
}

export function writeSshCommandSnippetsMetadata(
  session: SessionItem,
  commandSnippets: SshCommandSnippet[],
) {
  return writeSshMetadataPatch(session, { commandSnippets });
}

export function writeSshSessionMetadata(
  session: SessionItem,
  metadata: SshSessionMetadata,
) {
  return writeSshMetadataPatch(session, metadata);
}

function writeSshMetadataPatch(
  session: SessionItem,
  patch: Partial<SshSessionMetadata>,
) {
  const currentSshMetadata = readObject(session.metadata?.ssh);

  return {
    ...(session.metadata ?? {}),
    ssh: {
      ...(currentSshMetadata ?? {}),
      ...patch,
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

export function createSshCommandSnippet(
  command: string,
  label?: string,
  options: { basePath?: string; displayCommand?: string } = {},
): SshCommandSnippet {
  const trimmedCommand = normalizeSshCommand(command);
  const displayCommand = normalizeSshCommand(options.displayCommand ?? '');
  const basePath = normalizeSshPath(options.basePath ?? '');

  return {
    ...(basePath ? { basePath } : {}),
    command: trimmedCommand,
    ...(displayCommand ? { displayCommand } : {}),
    id: `ssh-snippet-${crypto.randomUUID()}`,
    label: label?.trim() || createCommandLabel(displayCommand || trimmedCommand),
  };
}

export function normalizeSshPath(path: string) {
  return path.trim();
}

export function normalizeSshCommand(command: string) {
  return command.trim();
}

export function createSshCdCommand(path: string) {
  return `cd -- ${quotePosixShellPath(path)}\r`;
}

export function createSshCommandInDirectory(path: string, command: string) {
  const normalizedPath = normalizeSshPath(path);
  const normalizedCommand = normalizeSshCommand(command);

  if (!normalizedPath || !normalizedCommand) {
    return normalizedCommand;
  }

  return `cd -- ${quotePosixShellPath(normalizedPath)} && ${normalizedCommand}`;
}

export function createSshSnippetPayload(command: string, shouldRun: boolean) {
  const normalizedCommand = normalizeSshCommand(command);

  if (!normalizedCommand) {
    return '';
  }

  return shouldRun ? `${normalizedCommand}\r` : normalizedCommand;
}

function createPathLabel(path: string) {
  if (!path || path === '/') {
    return path || 'Path';
  }

  const segments = path.split('/').filter(Boolean);

  return segments[segments.length - 1] ?? path;
}

function createCommandLabel(command: string) {
  return command.split(/\s+/).slice(0, 3).join(' ') || 'Command';
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

function isCommandSnippet(value: unknown): value is SshCommandSnippet {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<SshCommandSnippet>;

  return (
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    typeof item.command === 'string' &&
    item.command.trim().length > 0 &&
    (item.displayCommand === undefined || typeof item.displayCommand === 'string') &&
    (item.basePath === undefined || typeof item.basePath === 'string')
  );
}
