import { Download, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { cancelSftpTransfer, listenSftpTransferEvents, type SftpTransferEvent } from './sftpBridge';
import {
  subscribeSftpSidebarPanelStates,
  type SftpSidebarPanelState,
} from './sftpSidebarState';

type SftpTransferItem = SftpTransferEvent & {
  startedAt?: number;
  updatedAt?: number;
};

export function SftpTransferQueuePanel() {
  const [transfers, setTransfers] = useState<SftpTransferItem[]>([]);
  const [panelStates, setPanelStates] = useState<Record<string, SftpSidebarPanelState>>({});
  const summary = useMemo(
    () => ({
      canceled: transfers.filter((item) => item.status === 'canceled').length,
      completed: transfers.filter((item) => item.status === 'completed').length,
      failed: transfers.filter((item) => item.status === 'failed').length,
      running: transfers.filter((item) => item.status === 'progress' || item.status === 'started').length,
      total: transfers.length,
    }),
    [transfers],
  );

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenSftpTransferEvents((event) => {
      if (disposed) {
        return;
      }

      setTransfers((items) => {
        const current = items.find((item) => item.transferId === event.transferId);
        const nextItem = mergeTransferEvent(current, event);
        const nextItems = current
          ? items.map((item) => (item.transferId === event.transferId ? nextItem : item))
          : [nextItem, ...items];

        return nextItems.slice(0, 300);
      });
    }).then((dispose) => {
      unlisten = dispose;
      if (disposed) {
        dispose();
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => subscribeSftpSidebarPanelStates(setPanelStates), []);

  const clearFinished = () => {
    setTransfers((items) =>
      items.filter((item) => item.status === 'progress' || item.status === 'started'),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--workspace-terminal))] text-xs">
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/70 px-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-semibold text-slate-100">Transfer Queue</span>
          <span className="font-mono text-[11px] text-slate-500">
            {summary.running} running
            {summary.failed > 0 && ` / ${summary.failed} failed`}
            {summary.canceled > 0 && ` / ${summary.canceled} stopped`}
            {summary.completed > 0 && ` / ${summary.completed} done`}
          </span>
        </div>
        <button
          className="rounded px-2 py-1 text-[11px] font-semibold text-slate-400 hover:bg-accent hover:text-slate-100 disabled:pointer-events-none disabled:opacity-40"
          type="button"
          disabled={summary.total === summary.running}
          onClick={clearFinished}
        >
          Clear Finished
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <OverlayScrollArea>
          <div className="grid min-w-[58rem] gap-0.5 p-2 pr-4">
            {transfers.length === 0 ? (
              <div className="grid h-24 place-items-center rounded border border-dashed border-border/70 text-slate-500">
                File transfers will appear here.
              </div>
            ) : (
              transfers.map((transfer) => (
                <SftpTransferQueueRow
                  key={transfer.transferId}
                  panelState={panelStates[transfer.panelId]}
                  transfer={transfer}
                  onCancel={() => void cancelSftpTransfer(transfer.transferId)}
                />
              ))
            )}
          </div>
        </OverlayScrollArea>
      </div>
    </div>
  );
}

function SftpTransferQueueRow({
  onCancel,
  panelState,
  transfer,
}: {
  onCancel: () => void;
  panelState?: SftpSidebarPanelState;
  transfer: SftpTransferItem;
}) {
  const progress = getTransferProgress(transfer);
  const isRunning = transfer.status === 'progress' || transfer.status === 'started';
  const serverLabel = formatTransferServerLabel(transfer, panelState);
  const detailText = transfer.direction === 'upload'
    ? `${transfer.localPath} -> ${transfer.remotePath}`
    : `${transfer.remotePath} -> ${transfer.localPath}`;

  return (
    <div className="grid grid-cols-[1.2rem_10rem_minmax(10rem,1fr)_7rem_7rem_5rem_auto] items-center gap-3 rounded px-2 py-1.5 hover:bg-accent/70">
      {transfer.direction === 'upload' ? (
        <Upload className="size-4 text-primary" />
      ) : (
        <Download className="size-4 text-primary" />
      )}
      <span
        className="truncate rounded border border-border/70 bg-background/40 px-2 py-1 font-mono text-[10px] text-slate-400"
        title={serverLabel}
      >
        {serverLabel}
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate font-semibold text-slate-100">{getTransferFileName(transfer)}</span>
        <span className="truncate font-mono text-[10px] text-slate-500" title={detailText}>
          {detailText}
        </span>
      </div>
      <span className="font-mono text-[11px] text-slate-400">{formatTransferStatus(transfer)}</span>
      <span className="font-mono text-[11px] text-slate-500">{getTransferMetricText(transfer)}</span>
      <span className="font-mono text-[11px] text-slate-500">{formatBytes(transfer.transferredBytes)}</span>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-28 overflow-hidden rounded bg-slate-800">
          <div
            className={[
              'h-full rounded',
              transfer.status === 'failed'
                ? 'bg-destructive'
                : transfer.status === 'canceled'
                  ? 'bg-slate-600'
                  : 'bg-primary',
            ].join(' ')}
            style={{ width: `${progress}%` }}
          />
        </div>
        {isRunning && (
          <button
            className="grid size-6 place-items-center rounded text-slate-500 hover:bg-destructive/10 hover:text-destructive"
            type="button"
            title="Cancel transfer"
            aria-label="Cancel transfer"
            onClick={onCancel}
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

function formatTransferServerLabel(
  transfer: SftpTransferItem,
  panelState?: SftpSidebarPanelState,
) {
  const endpoint = panelState?.host
    ? `${panelState.username ? `${panelState.username}@` : ''}${panelState.host}`
    : '';
  const alias = normalizeRemoteAlias(panelState?.title);

  if (alias && endpoint && !isConnectionAlias(alias, endpoint, panelState?.host)) {
    return `${alias} (${endpoint})`;
  }

  return endpoint || alias || transfer.panelId;
}

function normalizeRemoteAlias(title?: string) {
  return title?.replace(/^SFTP\s+-\s+/i, '').trim() ?? '';
}

function isConnectionAlias(alias: string, endpoint: string, host?: string) {
  const normalizedAlias = alias.toLowerCase();

  return normalizedAlias === endpoint.toLowerCase() || normalizedAlias === host?.toLowerCase();
}

function mergeTransferEvent(current: SftpTransferItem | undefined, event: SftpTransferEvent): SftpTransferItem {
  return {
    ...event,
    startedAt: current?.startedAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

function getTransferProgress(transfer: SftpTransferItem) {
  if (transfer.status === 'completed') {
    return 100;
  }

  if (!transfer.totalBytes) {
    return transfer.status === 'started' ? 4 : 0;
  }

  return Math.max(0, Math.min(100, Math.round((transfer.transferredBytes / transfer.totalBytes) * 100)));
}

function formatTransferStatus(transfer: SftpTransferItem) {
  if (transfer.status === 'completed') {
    return 'done';
  }

  if (transfer.status === 'failed') {
    return 'failed';
  }

  if (transfer.status === 'canceled') {
    return 'stopped';
  }

  return `${getTransferProgress(transfer)}%`;
}

function getTransferMetricText(transfer: SftpTransferItem) {
  if (!transfer.startedAt || transfer.transferredBytes <= 0) {
    return '';
  }

  const elapsedSeconds = Math.max(1, (Date.now() - transfer.startedAt) / 1000);
  const bytesPerSecond = transfer.transferredBytes / elapsedSeconds;

  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '';
  }

  return `${formatBytes(bytesPerSecond)}/s`;
}

function getTransferFileName(transfer: SftpTransferItem) {
  const path = transfer.direction === 'upload' ? transfer.localPath : transfer.remotePath;
  const normalizedPath = path.replace(/\\/g, '/');

  return normalizedPath.split('/').filter(Boolean).pop() ?? path;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}
