import { RotateCcw, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import type { SftpConnectionState } from './sftpPanelUtils';
import { SftpClosedCard, SftpRestoredCard } from './SftpPanelChrome';
import { SftpPanelTransferSummary } from './SftpPanelTransferQueue';
import { requestSftpTransferQueueOpen } from './sftpTransferQueueState';
import type { SftpTransferItem } from './sftpTransferTypes';

export type SftpOperationNotice = {
  message: string;
};

export type SftpMoveStatus = {
  count: number;
  targetPath: string;
};

export function SftpPanelBody({
  children,
  connectionState,
  entriesCount,
  error,
  isLoading,
  moveStatus,
  onDismissOperationNotice,
  onReconnect,
  operationNotice,
  parentPath,
  transferSummary,
  transfers,
}: {
  children: ReactNode;
  connectionState: SftpConnectionState;
  entriesCount: number;
  error?: string;
  isLoading: boolean;
  moveStatus?: SftpMoveStatus;
  onDismissOperationNotice: () => void;
  onReconnect: () => void;
  operationNotice?: SftpOperationNotice;
  parentPath?: string;
  transferSummary: SftpTransferSummary;
  transfers: SftpTransferItem[];
}) {
  if (connectionState === 'restored') {
    return <SftpRestoredCard onReconnect={onReconnect} />;
  }

  if (connectionState === 'closed') {
    return <SftpClosedCard onReconnect={onReconnect} />;
  }

  if (error) {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 break-words">{error}</span>
          <Button size="sm" type="button" onClick={onReconnect}>
            <RotateCcw className="size-3.5" />
            Reconnect
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {operationNotice ? (
        <div className="mx-4 mt-3 rounded-md border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 whitespace-pre-line break-words">{operationNotice.message}</span>
            <button
              type="button"
              className="rounded p-1 text-amber-100/70 transition hover:bg-amber-400/10 hover:text-amber-50"
              aria-label="Dismiss file operation notice"
              onClick={onDismissOperationNotice}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {isLoading && entriesCount === 0 && !parentPath ? (
        <div className="min-h-0 flex-1 p-3 text-xs text-muted-foreground">Loading SFTP directory...</div>
      ) : entriesCount === 0 && !parentPath ? (
        <div className="min-h-0 flex-1 p-3 text-xs text-muted-foreground">No remote entries.</div>
      ) : (
        <>
          {children}
          {moveStatus && (
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 border-b border-primary/20 bg-slate-950/90 px-3 py-1 text-[11px] font-medium text-primary shadow-sm">
              Moving {moveStatus.count} item{moveStatus.count === 1 ? '' : 's'} to {moveStatus.targetPath}...
            </div>
          )}
          <SftpPanelTransferSummary
            summary={transferSummary}
            transfers={transfers}
            onOpenQueue={requestSftpTransferQueueOpen}
          />
        </>
      )}
    </div>
  );
}

type SftpTransferSummary = {
  canceled: number;
  completed: number;
  failed: number;
  running: number;
  total: number;
};
