import {
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  RefreshCcw,
} from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { CommanderPaneActionMenu } from './SftpCommanderActionMenu';
import {
  COMMANDER_ACTION_COMPACT_WIDTH,
  COMMANDER_ACTION_FULL_WIDTH,
  COMMANDER_ACTION_TIGHT_WIDTH,
  type CommanderPaneVariant,
} from './sftpCommanderUtils';
import { useSftpDismissibleLayer } from './useSftpDismissibleLayer';

export function CommanderPaneActionGroup({
  backStackLength,
  canDelete = false,
  canDownload = false,
  canRename = false,
  canTransfer = false,
  forwardStackLength,
  isLoading,
  isMenuOpen,
  isRemoteReady = true,
  label,
  showHiddenEntries = false,
  showPermissions = false,
  variant,
  onBack,
  onCopyPath,
  onCreateFolder,
  onDelete,
  onDownload,
  onForward,
  onRefresh,
  onRename,
  onSetMenuOpen,
  onSetShowHiddenEntries,
  onSetShowPermissions,
  onTransfer,
  onUploadFiles,
  onUploadFolder,
}: {
  backStackLength: number;
  canDelete?: boolean;
  canDownload?: boolean;
  canRename?: boolean;
  canTransfer?: boolean;
  forwardStackLength: number;
  isLoading: boolean;
  isMenuOpen: boolean;
  isRemoteReady?: boolean;
  label: string;
  showHiddenEntries?: boolean;
  showPermissions?: boolean;
  variant: CommanderPaneVariant;
  onBack: () => void;
  onCopyPath: () => void;
  onCreateFolder: () => void;
  onDelete: () => void;
  onDownload?: () => void;
  onForward: () => void;
  onRefresh: () => void;
  onRename?: () => void;
  onSetMenuOpen: (isOpen: boolean) => void;
  onSetShowHiddenEntries?: (value: boolean) => void;
  onSetShowPermissions?: (value: boolean) => void;
  onTransfer?: () => void;
  onUploadFiles?: () => void;
  onUploadFolder?: () => void;
}) {
  const actionGroupRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);
  const actionGroupWidth = useElementWidth(actionGroupRef);
  const isActionDisabled = isLoading || (variant === 'remote' && !isRemoteReady);
  const isFull = actionGroupWidth >= COMMANDER_ACTION_FULL_WIDTH;
  const isCompact = actionGroupWidth >= COMMANDER_ACTION_COMPACT_WIDTH;
  const isTight = actionGroupWidth >= COMMANDER_ACTION_TIGHT_WIDTH;
  const showInlineHistory = isCompact;
  const showInlineNewFolder = isTight;

  useSftpDismissibleLayer({
    isOpen: isMenuOpen,
    layerRef: actionMenuRef,
    onDismiss: () => onSetMenuOpen(false),
  });

  return (
    <div ref={actionGroupRef} className="flex w-full min-w-0 max-w-full items-center justify-end gap-1 pb-1">
      {isFull && (
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
      )}
      {showInlineHistory && (
        <>
          <Button
            aria-label={`${label} back`}
            title={`${label} back`}
            size="sm"
            variant="secondary"
            type="button"
            onClick={onBack}
            disabled={isActionDisabled || backStackLength === 0}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            aria-label={`${label} forward`}
            title={`${label} forward`}
            size="sm"
            variant="secondary"
            type="button"
            onClick={onForward}
            disabled={isActionDisabled || forwardStackLength === 0}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </>
      )}
      <Button
        aria-label={`Refresh ${label.toLowerCase()}`}
        title={`Refresh ${label.toLowerCase()}`}
        size="sm"
        variant="secondary"
        type="button"
        onClick={onRefresh}
        disabled={isActionDisabled}
      >
        <RefreshCcw className="size-3.5" />
      </Button>
      {showInlineNewFolder && (
        <Button
          aria-label={`New ${label.toLowerCase()} folder`}
          title={`New ${label.toLowerCase()} folder`}
          size="sm"
          variant="secondary"
          type="button"
          onClick={onCreateFolder}
          disabled={isActionDisabled}
        >
          <FolderPlus className="size-3.5" />
        </Button>
      )}
      <div className="relative" ref={actionMenuRef}>
        <Button
          aria-label={`${label} more actions`}
          title={`${label} more actions`}
          size="sm"
          variant="secondary"
          type="button"
          onClick={() => onSetMenuOpen(!isMenuOpen)}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
        {isMenuOpen && (
          <CommanderPaneActionMenu
            backStackLength={backStackLength}
            canDelete={canDelete}
            canDownload={canDownload}
            canRename={canRename}
            canTransfer={canTransfer}
            forwardStackLength={forwardStackLength}
            isActionDisabled={isActionDisabled}
            isLoading={isLoading}
            label={label}
            onBack={onBack}
            onCopyPath={onCopyPath}
            onCreateFolder={onCreateFolder}
            onDelete={onDelete}
            onDownload={onDownload}
            onForward={onForward}
            onRename={onRename}
            onSetMenuOpen={onSetMenuOpen}
            onSetShowHiddenEntries={onSetShowHiddenEntries}
            onSetShowPermissions={onSetShowPermissions}
            onTransfer={onTransfer}
            onUploadFiles={onUploadFiles}
            onUploadFolder={onUploadFolder}
            showHiddenEntries={showHiddenEntries}
            showInlineHistory={showInlineHistory}
            showInlineNewFolder={showInlineNewFolder}
            showPermissions={showPermissions}
            variant={variant}
          />
        )}
      </div>
    </div>
  );
}

function useElementWidth<TElement extends HTMLElement>(ref: RefObject<TElement>) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;

    if (!element) {
      return undefined;
    }

    const updateWidth = () => {
      setWidth(element.getBoundingClientRect().width);
    };

    updateWidth();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);

      return () => {
        window.removeEventListener('resize', updateWidth);
      };
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return width;
}
