import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

import type { SftpEntry } from './sftpBridge';

export async function selectUploadFilePaths() {
  const selectedPaths = await openDialog({
    directory: false,
    multiple: true,
    title: 'Select files to upload',
  });

  return Array.isArray(selectedPaths)
    ? selectedPaths.filter((selectedPath): selectedPath is string => typeof selectedPath === 'string')
    : typeof selectedPaths === 'string'
      ? [selectedPaths]
      : [];
}

export async function selectUploadFolderPath() {
  const selectedPath = await openDialog({
    directory: true,
    multiple: false,
    title: 'Select folder to upload',
  });

  return typeof selectedPath === 'string' ? selectedPath : undefined;
}

export async function selectDownloadFilePath(entry: SftpEntry) {
  const localPath = await saveDialog({
    defaultPath: entry.filename,
    title: `Download ${entry.filename}`,
  });

  return typeof localPath === 'string' ? localPath : undefined;
}

export async function selectDownloadTargetDirectory(entries: SftpEntry[]) {
  const targetDirectory = await openDialog({
    directory: true,
    multiple: false,
    title: entries.length === 1
      ? `Select folder for ${entries[0].filename}`
      : 'Select download folder',
  });

  return typeof targetDirectory === 'string' ? targetDirectory : undefined;
}
