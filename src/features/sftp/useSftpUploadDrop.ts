import { useState, type DragEvent, type RefObject } from 'react';

import { hasDroppedFiles } from './sftpPathUtils';
import { resolveSftpUploadDropTargetAt } from './sftpPanelUtils';
import type { SftpEntry } from './sftpBridge';

export function useSftpUploadDrop({
  entries,
  isRemoteReady,
  panelRef,
  parentEntryPathKey,
  parentPath,
  path,
  startUploadFromDataTransfer,
}: {
  entries: SftpEntry[];
  isRemoteReady: boolean;
  panelRef: RefObject<HTMLDivElement>;
  parentEntryPathKey: string;
  parentPath: string | undefined;
  path: string;
  startUploadFromDataTransfer: (dataTransfer: DataTransfer, targetDirectory: string) => Promise<void>;
}) {
  const [dragUploadTargetPath, setDragUploadTargetPath] = useState<string>();
  const [isUploadDragOver, setIsUploadDragOver] = useState(false);

  const resolveDropTarget = (event: DragEvent<HTMLElement>) =>
    resolveSftpUploadDropTargetAt({
      clientX: event.clientX,
      clientY: event.clientY,
      entries,
      panelElement: panelRef.current,
      parentEntryPathKey,
      parentPath,
      path,
    });

  const handleUploadDragOver = (event: DragEvent<HTMLElement>) => {
    if (!isRemoteReady || !hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = resolveDropTarget(event);

    if (!target) {
      setIsUploadDragOver(false);
      setDragUploadTargetPath(undefined);
      return;
    }

    event.dataTransfer.dropEffect = 'copy';
    setIsUploadDragOver(true);
    setDragUploadTargetPath(target.path);
  };

  const handleUploadDragLeave = (event: DragEvent<HTMLElement>) => {
    const relatedTarget = event.relatedTarget;

    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }

    setIsUploadDragOver(false);
    setDragUploadTargetPath(undefined);
  };

  const handleUploadDrop = (event: DragEvent<HTMLElement>) => {
    if (!isRemoteReady || !hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = resolveDropTarget(event);

    setIsUploadDragOver(false);
    setDragUploadTargetPath(undefined);

    if (!target) {
      return;
    }

    void startUploadFromDataTransfer(event.dataTransfer, target.path);
  };

  return {
    dragUploadTargetPath,
    handleUploadDragLeave,
    handleUploadDragOver,
    handleUploadDrop,
    isUploadDragOver,
  };
}
