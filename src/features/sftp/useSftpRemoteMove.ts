import { useRef, useState, type DragEvent } from 'react';

import { joinSftpPath } from './sftpPathUtils';
import { renameSftpPath, type SftpEntry } from './sftpBridge';

const remoteMoveMimeType = 'application/x-shellpilot-sftp-remote-move';

type RemoteMovePayload = {
  paths: string[];
};

type RemoteMoveStatus = {
  count: number;
  targetPath: string;
};

export function useSftpRemoteMove({
  entries,
  isRemoteReady,
  panelId,
  runBrowserAction,
}: {
  entries: SftpEntry[];
  isRemoteReady: boolean;
  panelId: string;
  runBrowserAction: (action: () => Promise<void>) => Promise<void>;
}) {
  const draggedPathsRef = useRef<string[]>([]);
  const [moveTargetPath, setMoveTargetPath] = useState<string>();
  const [moveStatus, setMoveStatus] = useState<RemoteMoveStatus>();

  const createRemoteMovePayload = (paths: string[]) => JSON.stringify({ paths } satisfies RemoteMovePayload);

  const canMoveRemotePaths = (sourcePaths: string[], targetDirectoryPath: string) => {
    const sourceSet = new Set(sourcePaths);

    if (sourceSet.has(targetDirectoryPath)) {
      return false;
    }

    return sourcePaths.every((sourcePath) => !isSftpAncestorPath(sourcePath, targetDirectoryPath));
  };

  const readRemoteMovePayload = (dataTransfer: DataTransfer) => {
    const rawPayload = dataTransfer.getData(remoteMoveMimeType);

    if (!rawPayload) {
      return draggedPathsRef.current.length > 0 ? draggedPathsRef.current : undefined;
    }

    try {
      const payload = JSON.parse(rawPayload) as Partial<RemoteMovePayload>;

      if (Array.isArray(payload.paths) && payload.paths.every((path) => typeof path === 'string')) {
        return payload.paths;
      }
    } catch {
      return draggedPathsRef.current.length > 0 ? draggedPathsRef.current : undefined;
    }

    return draggedPathsRef.current.length > 0 ? draggedPathsRef.current : undefined;
  };

  const hasRemoteMovePayload = (dataTransfer: DataTransfer) =>
    draggedPathsRef.current.length > 0 || Array.from(dataTransfer.types).includes(remoteMoveMimeType);

  const markRemoteMoveDrag = (dataTransfer: DataTransfer, paths: string[]) => {
    draggedPathsRef.current = paths;
    dataTransfer.effectAllowed = 'copyMove';
    dataTransfer.setData(remoteMoveMimeType, createRemoteMovePayload(paths));
  };

  const handleRemoteMoveDragOver = (event: DragEvent<HTMLElement>, targetEntry: SftpEntry | undefined) => {
    if (!isRemoteReady) {
      return false;
    }

    if (!hasRemoteMovePayload(event.dataTransfer) || !targetEntry) {
      setMoveTargetPath(undefined);
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setMoveTargetPath(targetEntry.path);
    return true;
  };

  const handleRemoteMoveDrop = (event: DragEvent<HTMLElement>, targetEntry: SftpEntry | undefined) => {
    if (!isRemoteReady) {
      return false;
    }

    const sourcePaths = readRemoteMovePayload(event.dataTransfer);

    setMoveTargetPath(undefined);

    if (!sourcePaths || !targetEntry || !canMoveRemotePaths(sourcePaths, targetEntry.path)) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();

    const sourceEntries = sourcePaths
      .map((sourcePath) => entries.find((entry) => entry.path === sourcePath))
      .filter((entry): entry is SftpEntry => Boolean(entry));

    if (sourceEntries.length === 0) {
      return false;
    }

    setMoveStatus({ count: sourceEntries.length, targetPath: targetEntry.path });

    void runBrowserAction(async () => {
      for (const entry of sourceEntries) {
        const destinationPath = joinSftpPath(targetEntry.path, entry.filename);

        if (destinationPath !== entry.path) {
          await renameSftpPath(panelId, entry.path, destinationPath);
        }
      }
    }).finally(() => {
      draggedPathsRef.current = [];
      setMoveStatus(undefined);
    });

    return true;
  };

  const clearRemoteMoveTarget = () => {
    draggedPathsRef.current = [];
    setMoveTargetPath(undefined);
  };

  return {
    clearRemoteMoveTarget,
    handleRemoteMoveDragOver,
    handleRemoteMoveDrop,
    markRemoteMoveDrag,
    moveTargetPath,
    moveStatus,
  };
}

function isSftpAncestorPath(sourcePath: string, targetPath: string) {
  const normalizedSource = sourcePath.replace(/\/+$/, '');
  const normalizedTarget = targetPath.replace(/\/+$/, '');

  return normalizedTarget.startsWith(`${normalizedSource}/`);
}
