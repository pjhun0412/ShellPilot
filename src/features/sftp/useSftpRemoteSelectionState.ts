import type { SftpEntry } from './sftpBridge';
import type { SftpViewMode } from './sftpPanelTypes';

export function useSftpRemoteSelectionState({
  commanderSelectedEntries,
  explorerSelectedEntries,
  fallbackExplorerEntry,
  viewMode,
}: {
  commanderSelectedEntries: SftpEntry[];
  explorerSelectedEntries: SftpEntry[];
  fallbackExplorerEntry?: SftpEntry;
  viewMode: SftpViewMode;
}) {
  const selectedEntries = viewMode === 'commander'
    ? commanderSelectedEntries
    : explorerSelectedEntries;
  const selectedEntry = selectedEntries[0] ?? fallbackExplorerEntry;

  return {
    canDelete: selectedEntries.length > 0,
    canDownload: selectedEntries.length > 0,
    canRename: selectedEntries.length === 1,
    downloadableEntries: selectedEntries,
    selectedEntries,
    selectedEntry,
  };
}
