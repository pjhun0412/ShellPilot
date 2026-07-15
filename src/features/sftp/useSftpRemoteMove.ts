import { useRef, useState, type DragEvent } from 'react';

import { joinSftpPath } from './sftpPathUtils';
import { renameSftpPath, sftpPathExists, type SftpEntry } from './sftpBridge';

const remoteMoveMimeType = 'application/x-shellpilot-sftp-remote-move';

type RemoteMovePayload = {
  remoteIdentity: string;
  sources: RemoteMoveSource[];
};

type LegacyRemoteMovePayload = {
  paths?: unknown;
};

type RemoteMoveSource = {
  filename: string;
  path: string;
};

type RemoteMoveStatus = {
  count: number;
  targetPath: string;
};

export function useSftpRemoteMove({
  entries,
  isRemoteReady,
  onMoveComplete,
  onMoveNotice,
  panelId,
  remoteIdentity,
  runBrowserAction,
}: {
  entries: SftpEntry[];
  isRemoteReady: boolean;
  onMoveComplete?: () => void;
  onMoveNotice: (message: string | undefined) => void;
  panelId: string;
  remoteIdentity: string;
  runBrowserAction: (action: () => Promise<void>) => Promise<void>;
}) {
  const draggedPayloadRef = useRef<RemoteMovePayload>();
  const [moveTargetPath, setMoveTargetPath] = useState<string>();
  const [moveStatus, setMoveStatus] = useState<RemoteMoveStatus>();

  const createRemoteMovePayload = (paths: string[]) => {
    const sources = paths.map((path) => {
      const entry = entries.find((candidate) => candidate.path === path);

      return {
        filename: entry?.filename ?? getSftpPathFilename(path),
        path,
      };
    });

    return {
      remoteIdentity,
      sources,
    } satisfies RemoteMovePayload;
  };

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
      return draggedPayloadRef.current;
    }

    try {
      const payload = JSON.parse(rawPayload) as Partial<RemoteMovePayload> & LegacyRemoteMovePayload;
      const sources = Array.isArray(payload.sources)
        ? payload.sources.filter((source): source is RemoteMoveSource =>
          typeof source?.path === 'string' && typeof source.filename === 'string',
        )
        : [];

      if (typeof payload.remoteIdentity === 'string' && sources.length > 0) {
        return {
          remoteIdentity: payload.remoteIdentity,
          sources,
        } satisfies RemoteMovePayload;
      }

      if (Array.isArray(payload.paths) && payload.paths.every((path): path is string => typeof path === 'string')) {
        return {
          remoteIdentity: '',
          sources: payload.paths.map((path) => ({
            filename: getSftpPathFilename(path),
            path,
          })),
        } satisfies RemoteMovePayload;
      }
    } catch {
      return draggedPayloadRef.current;
    }

    return draggedPayloadRef.current;
  };

  const hasRemoteMovePayload = (dataTransfer: DataTransfer) =>
    Boolean(draggedPayloadRef.current) || Array.from(dataTransfer.types).includes(remoteMoveMimeType);

  const markRemoteMoveDrag = (dataTransfer: DataTransfer, paths: string[]) => {
    const payload = createRemoteMovePayload(paths);

    draggedPayloadRef.current = payload;
    dataTransfer.effectAllowed = 'copyMove';
    dataTransfer.setData(remoteMoveMimeType, JSON.stringify(payload));
  };

  const handleRemoteMoveDragOver = (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => {
    if (!isRemoteReady) {
      return false;
    }

    if (!hasRemoteMovePayload(event.dataTransfer)) {
      setMoveTargetPath(undefined);
      return false;
    }

    if (!targetDirectoryPath) {
      setMoveTargetPath(undefined);
      event.stopPropagation();
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setMoveTargetPath(targetDirectoryPath);
    return true;
  };

  const handleRemoteMoveDrop = (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => {
    if (!isRemoteReady) {
      return false;
    }

    const payload = readRemoteMovePayload(event.dataTransfer);

    setMoveTargetPath(undefined);

    if (!payload) {
      return false;
    }

    if (!targetDirectoryPath) {
      event.stopPropagation();
      draggedPayloadRef.current = undefined;
      return true;
    }

    event.preventDefault();
    event.stopPropagation();
    onMoveNotice(undefined);

    if (payload.remoteIdentity !== remoteIdentity) {
      onMoveNotice('Server-to-server transfer is not ready yet. Use the same SFTP session to move remote files.');
      draggedPayloadRef.current = undefined;
      return true;
    }

    const sourcePaths = payload.sources.map((source) => source.path);

    if (!canMoveRemotePaths(sourcePaths, targetDirectoryPath)) {
      return false;
    }

    const movePlans = payload.sources.map((source) => ({
      destinationPath: joinSftpPath(targetDirectoryPath, source.filename),
      source,
    })).filter(({ destinationPath, source }) => destinationPath !== source.path);

    if (movePlans.length === 0) {
      draggedPayloadRef.current = undefined;
      return true;
    }

    void runBrowserAction(async () => {
      try {
        const collisions: string[] = [];

        for (const { destinationPath, source } of movePlans) {
          if (await sftpPathExists(panelId, destinationPath)) {
            collisions.push(source.filename);
          }
        }

        if (collisions.length > 0) {
          onMoveNotice(formatRemoteMoveConflictError(collisions, targetDirectoryPath));
          return;
        }

        setMoveStatus({ count: movePlans.length, targetPath: targetDirectoryPath });

        const failures: string[] = [];
        let movedCount = 0;

        for (const { destinationPath, source } of movePlans) {
          try {
            await renameSftpPath(panelId, source.path, destinationPath);
            movedCount += 1;
          } catch (error) {
            failures.push(`${source.filename}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        if (movedCount > 0) {
          onMoveComplete?.();
        }

        if (failures.length > 0) {
          onMoveNotice(formatRemoteMoveFailureError(failures, movedCount));
        }
      } catch (error) {
        onMoveNotice(`Move failed. ${error instanceof Error ? error.message : String(error)}`);
      }
    }).finally(() => {
      draggedPayloadRef.current = undefined;
      setMoveStatus(undefined);
    });

    return true;
  };

  const clearRemoteMoveTarget = () => {
    draggedPayloadRef.current = undefined;
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

function getSftpPathFilename(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function formatRemoteMoveConflictError(filenames: string[], targetPath: string) {
  const visibleNames = filenames.slice(0, 3).join(', ');
  const suffix = filenames.length > 3 ? ` and ${filenames.length - 3} more` : '';

  return `Move canceled. ${visibleNames}${suffix} already exists in ${targetPath}.`;
}

function formatRemoteMoveFailureError(failures: string[], movedCount: number) {
  const visibleFailures = failures.slice(0, 3).join('\n');
  const suffix = failures.length > 3 ? `\n...and ${failures.length - 3} more` : '';
  const prefix = movedCount > 0
    ? `Moved ${movedCount} item${movedCount === 1 ? '' : 's'}, but ${failures.length} failed.`
    : `Move failed for ${failures.length} item${failures.length === 1 ? '' : 's'}.`;

  return `${prefix}\n${visibleFailures}${suffix}`;
}

function isSftpAncestorPath(sourcePath: string, targetPath: string) {
  const normalizedSource = sourcePath.replace(/\/+$/, '');
  const normalizedTarget = targetPath.replace(/\/+$/, '');

  return normalizedTarget.startsWith(`${normalizedSource}/`);
}
