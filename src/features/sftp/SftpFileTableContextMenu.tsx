import { Download, FolderOpen, Upload } from 'lucide-react';

import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';

export function SftpFileTableContextMenu({
  canDelete,
  canDownload,
  canRename,
  isLoading,
  isRemoteReady,
  onCopySelectedPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onRefresh,
  onRename,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onUploadFiles,
  onUploadFolder,
  selectedEntriesCount,
  showHiddenEntries,
  showPermissions,
}: {
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  isLoading: boolean;
  isRemoteReady: boolean;
  onCopySelectedPath: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onRefresh: () => void;
  onRename: () => void;
  onSetShowHiddenEntries: (value: boolean) => void;
  onSetShowPermissions: (value: boolean) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  selectedEntriesCount: number;
  showHiddenEntries: boolean;
  showPermissions: boolean;
}) {
  return (
    <ContextMenuContent>
      <ContextMenuLabel>
        {selectedEntriesCount > 0 ? `${selectedEntriesCount} selected` : 'SFTP Explorer'}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={onRefresh} disabled={isLoading}>
        Refresh
        <ContextMenuShortcut>F5</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onCreateFolder} disabled={isLoading}>
        New Folder
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onUploadFiles} disabled={!isRemoteReady || isLoading}>
        <Upload className="size-3.5" />
        Upload Files
      </ContextMenuItem>
      <ContextMenuItem onSelect={onUploadFolder} disabled={!isRemoteReady || isLoading}>
        <FolderOpen className="size-3.5" />
        Upload Folder
      </ContextMenuItem>
      <ContextMenuItem onSelect={onDownload} disabled={!isRemoteReady || isLoading || !canDownload}>
        <Download className="size-3.5" />
        Download
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onCopySelectedPath}>
        Copy Path
      </ContextMenuItem>
      <ContextMenuItem onSelect={onRename} disabled={!isRemoteReady || isLoading || !canRename}>
        Rename
        <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={onDelete}
        disabled={!isRemoteReady || isLoading || !canDelete}
      >
        Delete
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuCheckboxItem checked={showHiddenEntries} onCheckedChange={(checked) => onSetShowHiddenEntries(Boolean(checked))}>
        Show Hidden Files
      </ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem checked={showPermissions} onCheckedChange={(checked) => onSetShowPermissions(Boolean(checked))}>
        Show Permissions
      </ContextMenuCheckboxItem>
    </ContextMenuContent>
  );
}
