export interface SftpDroppedUploadFile {
  file: File;
  relativePath: string;
}

export interface SftpDroppedUploadPlan {
  directories: string[];
  files: SftpDroppedUploadFile[];
}

interface SftpFileSystemEntry {
  isDirectory: boolean;
  isFile: boolean;
  name: string;
}

interface SftpFileSystemFileEntry extends SftpFileSystemEntry {
  file: (successCallback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
}

interface SftpFileSystemDirectoryEntry extends SftpFileSystemEntry {
  createReader: () => {
    readEntries: (
      successCallback: (entries: SftpFileSystemEntry[]) => void,
      errorCallback?: (error: DOMException) => void,
    ) => void;
  };
}

type SftpDataTransferItem = DataTransferItem & {
  webkitGetAsEntry?: () => SftpFileSystemEntry | null;
};

export function hasDroppedFiles(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes('Files');
}

export async function getDroppedUploadPlan(dataTransfer: DataTransfer): Promise<SftpDroppedUploadPlan> {
  const entries = Array.from(dataTransfer.items)
    .map((item) =>
      ((item as unknown as SftpDataTransferItem).webkitGetAsEntry?.() ?? null) as SftpFileSystemEntry | null,
    )
    .filter((entry): entry is SftpFileSystemEntry => entry !== null);

  if (entries.length === 0) {
    return {
      directories: [],
      files: Array.from(dataTransfer.files)
        .filter((file) => file.name && file.size >= 0)
        .map((file) => ({
          file,
          relativePath: normalizeSftpRelativePath(file.name),
        })),
    };
  }

  const plan: SftpDroppedUploadPlan = { directories: [], files: [] };

  for (const entry of entries) {
    mergeDroppedUploadPlan(plan, await readDroppedEntryPlan(entry, ''));
  }

  return {
    directories: Array.from(new Set(plan.directories)),
    files: plan.files,
  };
}

export function getSftpTopLevelPathName(path: string) {
  return normalizeSftpRelativePath(path).split('/')[0] || normalizeDroppedFilename(path);
}

export function getSftpAncestorPaths(remoteFilePath: string) {
  const normalizedPath = remoteFilePath.replace(/\/+$/, '');
  const isAbsolute = normalizedPath.startsWith('/');
  const parts = normalizedPath.split('/').filter(Boolean);

  if (parts.length <= 1) {
    return [];
  }

  return parts.slice(0, -1).map((_, index) => {
    const nextPath = parts.slice(0, index + 1).join('/');

    return isAbsolute ? `/${nextPath}` : nextPath;
  });
}

export function getSftpPathSegments(path: string) {
  if (path === '.' || path === '') {
    return [{ label: 'Home', path: '.' }];
  }

  if (path === '/') {
    return [{ label: '/', path: '/' }];
  }

  const parts = path.split('/').filter(Boolean);
  const segments = path.startsWith('/')
    ? [{ label: '/', path: '/' }]
    : [{ label: 'Home', path: '.' }];

  parts.forEach((part, index) => {
    const nextPath = path.startsWith('/')
      ? `/${parts.slice(0, index + 1).join('/')}`
      : parts.slice(0, index + 1).join('/');

    segments.push({ label: part, path: nextPath });
  });

  return segments;
}

export function getSftpParentPath(path: string) {
  if (path === '.' || path === '/' || path === '') {
    return undefined;
  }

  const normalizedPath = path.replace(/\/+$/, '');
  const parts = normalizedPath.split('/').filter(Boolean);

  if (parts.length === 0) {
    return undefined;
  }

  if (parts.length === 1) {
    return normalizedPath.startsWith('/') ? '/' : '.';
  }

  return normalizedPath.startsWith('/')
    ? `/${parts.slice(0, -1).join('/')}`
    : parts.slice(0, -1).join('/');
}

export function normalizeSftpPathInput(inputPath: string, currentPath: string, homePath: string) {
  const trimmedPath = inputPath.trim();

  if (!trimmedPath) {
    return currentPath;
  }

  if (trimmedPath === '~') {
    return homePath;
  }

  if (trimmedPath.startsWith('~/')) {
    return joinSftpPath(homePath, trimmedPath.slice(2));
  }

  if (trimmedPath.startsWith('/')) {
    return normalizeAbsoluteSftpPath(trimmedPath);
  }

  return joinSftpPath(currentPath, trimmedPath);
}

export function joinSftpPath(basePath: string, childPath: string) {
  if (!childPath || childPath === '.') {
    return basePath;
  }

  if (childPath.startsWith('/')) {
    return normalizeAbsoluteSftpPath(childPath);
  }

  const isAbsolute = basePath.startsWith('/');
  const parts = [
    ...basePath.split('/').filter(Boolean),
    ...childPath.split('/').filter(Boolean),
  ];
  const normalizedParts: string[] = [];

  parts.forEach((part) => {
    if (part === '.') {
      return;
    }

    if (part === '..') {
      normalizedParts.pop();
      return;
    }

    normalizedParts.push(part);
  });

  if (isAbsolute) {
    return `/${normalizedParts.join('/')}` || '/';
  }

  return normalizedParts.join('/') || '.';
}

export function normalizeAbsoluteSftpPath(path: string) {
  const normalizedParts: string[] = [];

  path.split('/').filter(Boolean).forEach((part) => {
    if (part === '.') {
      return;
    }

    if (part === '..') {
      normalizedParts.pop();
      return;
    }

    normalizedParts.push(part);
  });

  return `/${normalizedParts.join('/')}` || '/';
}

async function readDroppedEntryPlan(
  entry: SftpFileSystemEntry,
  parentPath: string,
): Promise<SftpDroppedUploadPlan> {
  const relativePath = normalizeSftpRelativePath(joinSftpPath(parentPath, entry.name));

  if (entry.isFile) {
    const file = await readDroppedFileEntry(entry as SftpFileSystemFileEntry);

    return { directories: [], files: [{ file, relativePath }] };
  }

  if (!entry.isDirectory) {
    return { directories: [], files: [] };
  }

  const children = await readDroppedDirectoryEntries(entry as SftpFileSystemDirectoryEntry);
  const plan: SftpDroppedUploadPlan = { directories: [relativePath], files: [] };

  for (const child of children) {
    mergeDroppedUploadPlan(plan, await readDroppedEntryPlan(child, relativePath));
  }

  return plan;
}

function mergeDroppedUploadPlan(target: SftpDroppedUploadPlan, source: SftpDroppedUploadPlan) {
  target.directories.push(...source.directories);
  target.files.push(...source.files);
}

function readDroppedFileEntry(entry: SftpFileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject);
  });
}

async function readDroppedDirectoryEntries(
  entry: SftpFileSystemDirectoryEntry,
): Promise<SftpFileSystemEntry[]> {
  const reader = entry.createReader();
  const entries: SftpFileSystemEntry[] = [];

  while (true) {
    const batch = await new Promise<SftpFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });

    if (batch.length === 0) {
      break;
    }

    entries.push(...batch);
  }

  return entries;
}

function normalizeDroppedFilename(filename: string) {
  return filename.split(/[\\/]/).filter(Boolean).pop() ?? 'upload';
}

function normalizeSftpRelativePath(path: string) {
  return path
    .split(/[\\/]/)
    .filter(Boolean)
    .join('/');
}
