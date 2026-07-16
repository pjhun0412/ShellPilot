import { useEffect } from 'react';

export function useSftpActivationSelectionSync({
  clearPendingActivationSelectionPath,
  commanderRemoteSelectedPaths,
  localSelectedEntryPaths,
  pendingActivationSelectionPath,
  selectedEntryPath,
  selectedEntryPaths,
}: {
  clearPendingActivationSelectionPath: () => void;
  commanderRemoteSelectedPaths: string[];
  localSelectedEntryPaths: string[];
  pendingActivationSelectionPath?: string | null;
  selectedEntryPath?: string;
  selectedEntryPaths: string[];
}) {
  useEffect(() => {
    if (pendingActivationSelectionPath === undefined) {
      return;
    }

    const isSelectionApplied = pendingActivationSelectionPath === null
      ? selectedEntryPath === undefined
        && selectedEntryPaths.length === 0
        && commanderRemoteSelectedPaths.length === 0
        && localSelectedEntryPaths.length === 0
      : selectedEntryPath === pendingActivationSelectionPath
        || selectedEntryPaths.includes(pendingActivationSelectionPath)
        || commanderRemoteSelectedPaths.includes(pendingActivationSelectionPath)
        || localSelectedEntryPaths.includes(pendingActivationSelectionPath);

    if (isSelectionApplied) {
      clearPendingActivationSelectionPath();
    }
  }, [
    clearPendingActivationSelectionPath,
    commanderRemoteSelectedPaths,
    localSelectedEntryPaths,
    pendingActivationSelectionPath,
    selectedEntryPath,
    selectedEntryPaths,
  ]);
}
