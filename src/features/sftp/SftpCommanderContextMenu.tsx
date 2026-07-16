import {
  Copy,
  Download,
  Folder,
  FolderOpen,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';

import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import type { CommanderPaneVariant } from './sftpCommanderUtils';

export function CommanderContextMenu({
  canDelete,
  canDownload,
  canRename,
  isLoading,
  isRemoteReady,
  path,
  selectedCount,
  selectedPaths,
  showHiddenEntries,
  showPermissions,
  variant,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onRefresh,
  onRename,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onUploadFiles,
  onUploadFolder,
  onUploadSelectedLocal,
}: {
  canDelete: boolean;
  canDownload: boolean;
  canRename: boolean;
  isLoading: boolean;
  isRemoteReady: boolean;
  path: string;
  selectedCount: number;
  selectedPaths: string[];
  showHiddenEntries: boolean;
  showPermissions: boolean;
  variant: CommanderPaneVariant;
  onCopyPath?: () => void;
  onCreateFolder?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
  onRefresh: () => void;
  onRename?: () => void;
  onSetShowHiddenEntries?: (value: boolean) => void;
  onSetShowPermissions?: (value: boolean) => void;
  onUploadFiles?: () => void;
  onUploadFolder?: () => void;
  onUploadSelectedLocal?: () => void;
}) {
  if (variant === 'local') {
    const copyLocalPath = async () => {
      const targetPath = selectedPaths.length === 1 ? selectedPaths[0] : path;
      await navigator.clipboard?.writeText(targetPath);
    };

    return (
      <ContextMenuContent>
        <ContextMenuLabel>
          {selectedCount > 0 ? `${selectedCount} selected` : 'Local'}
        </ContextMenuLabel>
        <ContextMenuItem onSelect={onRefresh} disabled={isLoading}>
          Refresh
          <ContextMenuShortcut>F5</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCreateFolder} disabled={isLoading}>
          <Folder className="size-3.5" />
          New Folder
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onUploadSelectedLocal} disabled={isLoading || selectedCount === 0}>
          <Upload className="size-3.5" />
          Upload to Remote
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyLocalPath()}>
          <Copy className="size-3.5" />
          Copy Path
        </ContextMenuItem>
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          onSelect={onDelete}
          disabled={isLoading || selectedCount === 0}
        >
          <Trash2 className="size-3.5" />
          Delete
          <ContextMenuShortcut>Del</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  return (
    <ContextMenuContent>
      <ContextMenuLabel>
        {selectedCount > 0 ? `${selectedCount} selected` : 'Remote'}
      </ContextMenuLabel>
      <ContextMenuItem onSelect={onRefresh} disabled={isLoading}>
        Refresh
        <ContextMenuShortcut>F5</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onCreateFolder} disabled={!isRemoteReady || isLoading}>
        <Folder className="size-3.5" />
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
      <ContextMenuItem onSelect={onCopyPath}>
        <Copy className="size-3.5" />
        Copy Path
      </ContextMenuItem>
      <ContextMenuItem onSelect={onRename} disabled={!isRemoteReady || isLoading || !canRename}>
        <Pencil className="size-3.5" />
        Rename
        <ContextMenuShortcut>F2</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem
        className="text-destructive focus:text-destructive"
        onSelect={onDelete}
        disabled={!isRemoteReady || isLoading || !canDelete}
      >
        <Trash2 className="size-3.5" />
        Delete
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuCheckboxItem
        checked={showHiddenEntries}
        onCheckedChange={(checked) => onSetShowHiddenEntries?.(Boolean(checked))}
      >
        Show Hidden Files
      </ContextMenuCheckboxItem>
      <ContextMenuCheckboxItem
        checked={showPermissions}
        onCheckedChange={(checked) => onSetShowPermissions?.(Boolean(checked))}
      >
        Show Permissions
      </ContextMenuCheckboxItem>
    </ContextMenuContent>
  );
}
