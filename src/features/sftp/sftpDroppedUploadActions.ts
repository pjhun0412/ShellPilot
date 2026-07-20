import { createSftpDirectory, type SftpEntry } from './sftpBridge';
import {
  getDroppedUploadPlan,
  getSftpAncestorPaths,
  getSftpTopLevelPathName,
  joinSftpPath,
  type SftpDroppedUploadPlan,
} from './sftpPathUtils';
import { chooseFileConflictDecision } from './sftpTransferActionHelpers';

export async function startDroppedUploadPlan({
  dataTransfer,
  getTargetEntries,
  isRemoteReady,
  panelId,
  setError,
  startDroppedFileUpload,
  targetDirectory,
}: {
  dataTransfer: DataTransfer;
  getTargetEntries: (targetDirectory: string) => Promise<SftpEntry[] | undefined>;
  isRemoteReady: boolean;
  panelId: string;
  setError: (message: string) => void;
  startDroppedFileUpload: (file: File, filename: string, remotePath: string) => Promise<void>;
  targetDirectory: string;
}) {
  let uploadPlan: SftpDroppedUploadPlan;

  try {
    uploadPlan = await getDroppedUploadPlan(dataTransfer);
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
    return;
  }

  if (!isRemoteReady || (uploadPlan.files.length === 0 && uploadPlan.directories.length === 0)) {
    setError('Dropped files did not include readable files.');
    return;
  }

  const targetEntries = await getTargetEntries(targetDirectory);

  if (!targetEntries) {
    return;
  }

  const existingNames = new Set(targetEntries.map((entry) => entry.filename));
  const skippedTopLevelNames = new Set<string>();
  let conflictActionForRemaining: 'overwrite' | 'skip' | undefined;
  const topLevelNames = Array.from(new Set([
    ...uploadPlan.directories.map(getSftpTopLevelPathName),
    ...uploadPlan.files.map((file) => getSftpTopLevelPathName(file.relativePath)),
  ]));

  for (const topLevelName of topLevelNames) {
    if (existingNames.has(topLevelName)) {
      const conflictDecision = await chooseFileConflictDecision({
        conflictActionForRemaining,
        filename: topLevelName,
        targetDirectory,
        title: 'Remote File Exists',
      });

      if (conflictDecision.shouldCancel) {
        return;
      }

      conflictActionForRemaining = conflictDecision.conflictActionForRemaining;

      if (conflictDecision.shouldSkip) {
        skippedTopLevelNames.add(topLevelName);
        continue;
      }
    }
  }

  const ensuredRemoteDirectories = new Set([
    targetDirectory,
    ...getSftpAncestorPaths(targetDirectory),
  ]);

  await ensureDroppedUploadDirectories({
    directories: uploadPlan.directories,
    ensuredRemoteDirectories,
    panelId,
    skippedTopLevelNames,
    targetDirectory,
  });

  const uploadTasks: Array<() => Promise<void>> = [];

  for (const uploadFile of uploadPlan.files) {
    const topLevelName = getSftpTopLevelPathName(uploadFile.relativePath);

    if (skippedTopLevelNames.has(topLevelName)) {
      continue;
    }

    const remotePath = joinSftpPath(targetDirectory, uploadFile.relativePath);
    await ensureRemoteDirectoriesForFile({
      ensuredRemoteDirectories,
      panelId,
      remoteFilePath: remotePath,
    });
    uploadTasks.push(() => startDroppedFileUpload(uploadFile.file, uploadFile.relativePath, remotePath));
    existingNames.add(topLevelName);
  }

  await Promise.all(uploadTasks.map((task) => task()));
}

async function ensureDroppedUploadDirectories({
  directories,
  ensuredRemoteDirectories,
  panelId,
  skippedTopLevelNames,
  targetDirectory,
}: {
  directories: string[];
  ensuredRemoteDirectories: Set<string>;
  panelId: string;
  skippedTopLevelNames: Set<string>;
  targetDirectory: string;
}) {
  const uploadDirectories = directories
    .filter((directoryPath) => !skippedTopLevelNames.has(getSftpTopLevelPathName(directoryPath)))
    .sort((left, right) => left.split('/').length - right.split('/').length);

  for (const directoryPath of uploadDirectories) {
    const remoteDirectoryPath = joinSftpPath(targetDirectory, directoryPath);

    if (ensuredRemoteDirectories.has(remoteDirectoryPath)) {
      continue;
    }

    try {
      await createSftpDirectory(panelId, remoteDirectoryPath);
    } catch {
      // Directory may already exist. Uploading files will surface real path problems.
    }

    ensuredRemoteDirectories.add(remoteDirectoryPath);
  }
}

async function ensureRemoteDirectoriesForFile({
  ensuredRemoteDirectories,
  panelId,
  remoteFilePath,
}: {
  ensuredRemoteDirectories: Set<string>;
  panelId: string;
  remoteFilePath: string;
}) {
  for (const directoryPath of getSftpAncestorPaths(remoteFilePath)) {
    if (ensuredRemoteDirectories.has(directoryPath)) {
      continue;
    }

    try {
      await createSftpDirectory(panelId, directoryPath);
    } catch {
      // Directory may already exist. Uploading the file will surface real path problems.
    }

    ensuredRemoteDirectories.add(directoryPath);
  }
}
