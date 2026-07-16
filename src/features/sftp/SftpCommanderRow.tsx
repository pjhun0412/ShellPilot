import { File, Folder, FolderOpen } from 'lucide-react';
import { useRef, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';

import { getSftpFileIcon } from './SftpPanelChrome';
import { formatModifiedAt } from './sftpPanelUtils';
import {
  COMMANDER_ROW_CLASS_NAME,
  formatEntrySize,
  formatLocalDisplayPath,
  getGridTemplateColumns,
  type CommanderEntry,
  type CommanderPaneVariant,
} from './sftpCommanderUtils';

export function CommanderRow({
  entry,
  selected,
  showSelection,
  pendingActivationSelectionPath,
  onActivate,
  onNavigate,
  onSelect,
  onSelectRange,
  onRemoteMoveDragOver,
  onRemoteMoveDrop,
  onDragStart,
  onDragEnd,
  remoteMoveTargetDirectoryPath,
  remoteMoveTargetPath,
  variant,
}: {
  entry: CommanderEntry;
  selected: boolean;
  showSelection: boolean;
  pendingActivationSelectionPath?: string | null;
  onActivate: () => void;
  onNavigate: (path: string) => void;
  onSelect: (path: string, additive: boolean) => void;
  onSelectRange: (path: string) => void;
  onDragEnd?: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onRemoteMoveDragOver?: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  onRemoteMoveDrop?: (event: DragEvent<HTMLElement>, targetDirectoryPath: string | undefined) => boolean;
  remoteMoveTargetDirectoryPath?: string;
  remoteMoveTargetPath?: string;
  variant: CommanderPaneVariant;
}) {
  const didDragRef = useRef(false);
  const pendingSelectedClickRef = useRef(false);
  const gridTemplateColumns = getGridTemplateColumns(variant);
  const isPendingActivationSelection = pendingActivationSelectionPath === entry.path;
  const shouldShowSelection = showSelection && (
    isPendingActivationSelection || (pendingActivationSelectionPath === undefined && selected)
  );
  const fileIcon = entry.kind === 'symlink'
    ? { Icon: File, className: 'text-sky-300' }
    : getSftpFileIcon(entry.filename);

  const selectEntry = (additive: boolean, range: boolean) => {
    onActivate();
    if (range) {
      onSelectRange(entry.path);
      return;
    }
    onSelect(entry.path, additive);
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    didDragRef.current = false;

    if (selected && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      onActivate();
      pendingSelectedClickRef.current = true;
      return;
    }

    pendingSelectedClickRef.current = false;
    selectEntry(event.ctrlKey || event.metaKey, event.shiftKey);
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (pendingSelectedClickRef.current) {
      pendingSelectedClickRef.current = false;

      if (!didDragRef.current) {
        selectEntry(false, false);
      }

      didDragRef.current = false;
      return;
    }

    if (event.detail !== 0) {
      return;
    }

    selectEntry(event.ctrlKey || event.metaKey, event.shiftKey);
  };

  return (
    <div
      data-commander-entry-path={entry.path}
      className={[
        COMMANDER_ROW_CLASS_NAME,
        !shouldShowSelection ? 'odd:bg-slate-950/20' : '',
        shouldShowSelection ? 'border-primary/60 bg-primary/15 text-white shadow-[inset_3px_0_0_hsl(var(--primary))]' : '',
        remoteMoveTargetPath === entry.path ? 'border-primary/70 bg-primary/20' : '',
      ].join(' ')}
      role="button"
      style={{ gridTemplateColumns }}
      tabIndex={-1}
      draggable={Boolean(onDragStart)}
      title={variant === 'local' ? formatLocalDisplayPath(entry.path) : entry.path}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={() => {
        onActivate();
        if (!selected) {
          onSelect(entry.path, false);
        }
      }}
      onDragEnd={() => {
        onDragEnd?.();
        pendingSelectedClickRef.current = false;
        didDragRef.current = false;
      }}
      onDragOver={(event) => onRemoteMoveDragOver?.(event, remoteMoveTargetDirectoryPath)}
      onDragStart={(event) => {
        didDragRef.current = true;
        onDragStart?.(event);
      }}
      onDrop={(event) => onRemoteMoveDrop?.(event, remoteMoveTargetDirectoryPath)}
      onDoubleClick={() => {
        if (entry.isDirectory) {
          onNavigate(entry.path);
        }
      }}
    >
      <span className="min-w-0 px-1">
        <span className="flex min-w-0 items-center gap-2">
          {entry.filename === '..' ? (
            <FolderOpen className="size-4 shrink-0 text-amber-300" />
          ) : entry.isDirectory ? (
            <Folder className="size-3.5 shrink-0 text-primary" />
          ) : (
            <fileIcon.Icon className={['size-3.5 shrink-0', fileIcon.className].join(' ')} />
          )}
          <span className="truncate font-semibold text-slate-100">{entry.filename}</span>
        </span>
      </span>

      <span className="min-w-0 whitespace-nowrap px-1 font-mono text-[11px] text-slate-300">
        {formatModifiedAt(entry.modifiedAt)}
      </span>

      <span className="min-w-0 whitespace-nowrap px-1 text-right font-mono text-[11px] text-slate-300">
        {formatEntrySize(entry)}
      </span>

      <span aria-hidden="true" />
    </div>
  );
}
