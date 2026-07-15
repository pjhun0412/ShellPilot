import { appAlert, appConfirm, appPrompt } from '@/components/ui/app-dialog';
import {
  createSftpDirectory,
  removeSftpDirectory,
  removeSftpFile,
  renameSftpPath,
  type SftpEntry,
} from './sftpBridge';
import { getAvailableFolderName, hasEntryNamed } from './sftpPanelUtils';

export function useSftpFileActions({
  entries,
  panelId,
  path,
  residualUploadEntries,
  runBrowserAction,
  selectedEntries,
  selectedEntry,
}: {
  entries: SftpEntry[];
  panelId: string;
  path: string;
  residualUploadEntries: SftpEntry[];
  runBrowserAction: (action: () => Promise<void>) => Promise<void>;
  selectedEntries: SftpEntry[];
  selectedEntry: SftpEntry | undefined;
}) {
  const makeChildPath = (name: string) => {
    if (path === '/') {
      return `/${name}`;
    }

    return `${path.replace(/\/$/, '')}/${name}`;
  };

  const createFolder = async () => {
    const defaultFolderName = getAvailableFolderName(entries);
    const folderName = (await appPrompt({
      confirmLabel: 'Create',
      defaultValue: defaultFolderName,
      message: 'Enter a folder name for the current remote path.',
      title: 'New Folder',
    }))?.trim();

    if (!folderName) {
      return;
    }

    if (hasEntryNamed(entries, folderName)) {
      await appAlert({
        message: `${folderName} already exists in ${path}.`,
        title: 'Folder Already Exists',
      });
      return;
    }

    await runBrowserAction(async () => {
      try {
        await createSftpDirectory(panelId, makeChildPath(folderName));
      } catch {
        throw new Error(`Failed to create ${folderName}. A file or folder with the same name may already exist, or you may not have permission.`);
      }
    });
  };

  const renameEntry = async () => {
    const targetEntry = selectedEntries[0] ?? selectedEntry;

    if (!targetEntry || selectedEntries.length > 1) {
      return;
    }

    const nextName = (await appPrompt({
      defaultValue: targetEntry.filename,
      confirmLabel: 'Rename',
      message: 'Enter a new name for the selected remote item.',
      title: 'Rename',
    }))?.trim();

    if (!nextName || nextName === targetEntry.filename) {
      return;
    }

    await runBrowserAction(() => renameSftpPath(panelId, targetEntry.path, makeChildPath(nextName)));
  };

  const deleteEntry = async () => {
    if (selectedEntries.length === 0) {
      return;
    }

    const confirmed = await appConfirm({
      confirmLabel: 'Delete',
      message: selectedEntries.length === 1
        ? `Delete ${selectedEntries[0].filename}?`
        : `Delete ${selectedEntries.length} selected items?`,
      title: 'Delete Remote Item',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    await runBrowserAction(async () => {
      for (const entry of selectedEntries) {
        if (entry.isDirectory) {
          await removeSftpDirectory(panelId, entry.path);
        } else {
          await removeSftpFile(panelId, entry.path);
        }
      }
    });
  };

  const cleanResidualUploadFiles = async () => {
    if (residualUploadEntries.length === 0) {
      return;
    }

    const confirmed = await appConfirm({
      confirmLabel: 'Clean',
      message: `Delete ${residualUploadEntries.length} leftover upload file${residualUploadEntries.length === 1 ? '' : 's'} in ${path}?`,
      title: 'Clean Upload Leftovers',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    await runBrowserAction(async () => {
      for (const entry of residualUploadEntries) {
        await removeSftpFile(panelId, entry.path);
      }
    });
  };

  return {
    cleanResidualUploadFiles,
    createFolder,
    deleteEntry,
    renameEntry,
  };
}
