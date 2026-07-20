import { AlertTriangle, CheckCircle2, Download, Pause, Play, RotateCcw, Upload, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { cancelSftpTransfer, pauseSftpTransfer, resumeSftpTransfer } from './sftpBridge';
import {
  subscribeSftpSidebarPanelStates,
  type SftpSidebarPanelState,
} from './sftpSidebarState';
import {
  clearFinishedSftpTransfers,
  getSftpTransferStoreSnapshot,
  markSftpTransferPaused,
  markSftpTransferResumed,
  subscribeSftpTransferStore,
} from './sftpTransferStore';
import type { SftpTransferItem } from './sftpTransferTypes';
import {
  formatBytes,
  formatLocalDisplayPath,
} from './sftpPanelUtils';
import {
  cancelQueuedSftpTransfer,
  getSftpTransferSchedulerSnapshot,
  pauseSftpTransferQueue,
  resumeSftpTransferQueue,
  retryFailedSftpTransfers,
  retrySftpTransfer,
  restartSftpTransfer,
  setSftpTransferConcurrency,
  subscribeSftpTransferScheduler,
} from './sftpTransferScheduler';

export function SftpTransferQueuePanel() {
  const [transfers, setTransfers] = useState<SftpTransferItem[]>(() => getSftpTransferStoreSnapshot());
  const [panelStates, setPanelStates] = useState<Record<string, SftpSidebarPanelState>>({});
  const [scheduler, setScheduler] = useState(() => getSftpTransferSchedulerSnapshot());
  const summary = useMemo(
    () => ({
      canceled: transfers.filter((item) => item.status === 'canceled').length,
      completed: transfers.filter((item) => item.status === 'completed').length,
      failed: transfers.filter((item) => item.status === 'failed').length,
      queued: transfers.filter((item) => item.status === 'queued').length,
      running: transfers.filter((item) => item.status === 'paused' || item.status === 'progress' || item.status === 'started').length,
      total: transfers.length,
    }),
    [transfers],
  );
  const clearableCount = summary.completed + summary.failed + summary.canceled;
  const retryableTransfers = useMemo(
    () => transfers.filter((item) => item.status === 'failed' && item.retryPayload),
    [transfers],
  );

  useEffect(() => subscribeSftpTransferStore(setTransfers), []);

  useEffect(() => subscribeSftpSidebarPanelStates(setPanelStates), []);

  useEffect(() => subscribeSftpTransferScheduler(setScheduler), []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--workspace-terminal))] text-xs text-foreground">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-slate-950/55 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-semibold text-foreground">Transfer Queue</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {summary.running} running
            {summary.queued > 0 && ` / ${summary.queued} queued`}
            {summary.failed > 0 && ` / ${summary.failed} failed`}
            {summary.canceled > 0 && ` / ${summary.canceled} stopped`}
            {summary.completed > 0 && ` / ${summary.completed} done`}
            {scheduler.paused && ' / paused'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <label className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-background/35 px-2 py-1 text-[11px] font-semibold text-muted-foreground">
            Concurrent
            <select
              className="bg-transparent font-mono text-foreground outline-none"
              value={scheduler.concurrency}
              onChange={(event) => setSftpTransferConcurrency(Number(event.target.value))}
            >
              {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <button
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            type="button"
            onClick={scheduler.paused ? resumeSftpTransferQueue : pauseSftpTransferQueue}
          >
            {scheduler.paused ? <Play className="size-3" /> : <Pause className="size-3" />}
            {scheduler.paused ? 'Resume' : 'Pause'}
          </button>
          <button
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            type="button"
            disabled={retryableTransfers.length === 0}
            onClick={() => void retryFailedSftpTransfers(transfers)}
          >
            <RotateCcw className="size-3" />
            Retry Failed
          </button>
          <button
            className="rounded px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            type="button"
            disabled={clearableCount === 0}
            onClick={clearFinishedSftpTransfers}
          >
            Clear Finished
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <OverlayScrollArea>
          <div className="grid min-w-[46rem] gap-2 p-2 pr-4">
            {transfers.length === 0 ? (
              <div className="grid h-24 place-items-center rounded border border-dashed border-border/70 text-muted-foreground">
                File transfers will appear here.
              </div>
            ) : (
              transfers.map((transfer) => (
                <SftpTransferQueueRow
                  key={transfer.transferId}
                  panelState={panelStates[transfer.panelId]}
                  transfer={transfer}
                  onCancel={() => {
                    if (transfer.status === 'queued') {
                      cancelQueuedSftpTransfer(transfer.transferId);
                      return;
                    }

                    void cancelSftpTransfer(transfer.transferId);
                  }}
                  onPause={() => {
                    markSftpTransferPaused(transfer.transferId);
                    void pauseSftpTransfer(transfer.transferId).catch((error) => {
                      if (!isTransferNotRunningError(error instanceof Error ? error.message : String(error))) {
                        console.error('Failed to pause SFTP transfer.', error);
                      }
                    });
                  }}
                  onResume={() => {
                    markSftpTransferResumed(transfer.transferId);
                    void resumeSftpTransfer(transfer.transferId).catch((error) => {
                      if (!isTransferNotRunningError(error instanceof Error ? error.message : String(error))) {
                        console.error('Failed to resume SFTP transfer.', error);
                      }
                    });
                  }}
                  onRetry={() => void retrySftpTransfer(transfer)}
                  onRestart={() => void restartSftpTransfer(transfer)}
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
  onPause,
  onResume,
  onRetry,
  onRestart,
  panelState,
  transfer,
}: {
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onRestart: () => void;
  panelState?: SftpSidebarPanelState;
  transfer: SftpTransferItem;
}) {
  const progress = getTransferProgress(transfer);
  const isCancelable = transfer.status === 'paused' || transfer.status === 'progress' || transfer.status === 'queued' || transfer.status === 'started';
  const isPausable = transfer.status === 'progress' || transfer.status === 'started';
  const isPaused = transfer.status === 'paused';
  const isRetryable = transfer.status === 'failed' && Boolean(transfer.retryPayload);
  const serverLabel = formatTransferServerLabel(transfer, panelState);
  const localPathText = formatLocalDisplayPath(transfer.localPath);
  const detailText = transfer.direction === 'upload'
    ? `${localPathText} -> ${transfer.remotePath}`
    : `${transfer.remotePath} -> ${localPathText}`;
  const errorText = getTransferErrorText(transfer);
  const noticeText = getTransferNoticeText(transfer);

  return (
    <div className="rounded-lg border border-border/70 bg-slate-950/55 px-3 py-2.5 shadow-sm shadow-black/20 hover:border-primary/35 hover:bg-slate-900/45">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <div className="mt-0.5 grid size-7 place-items-center rounded-md border border-primary/20 bg-primary/10">
          {transfer.direction === 'upload' ? (
            <Upload className="size-4 text-primary" />
          ) : (
            <Download className="size-4 text-primary" />
          )}
        </div>

        <div className="grid min-w-0 gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[13px] font-semibold text-foreground">{getTransferFileName(transfer)}</span>
            <span
              className="max-w-[18rem] truncate rounded border border-border/70 bg-background/50 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              title={serverLabel}
            >
              {serverLabel}
            </span>
            <span className={getTransferStatusClassName(transfer)}>
              {getTransferStatusIcon(transfer)}
              {formatTransferStatus(transfer)}
            </span>
          </div>
          <span className="truncate font-mono text-[11px] text-muted-foreground" title={detailText}>
            {detailText}
          </span>
          {errorText && (
            <span className="truncate text-[11px] font-medium text-destructive" title={errorText}>
              {errorText}
            </span>
          )}
          {noticeText && (
            <span className="truncate text-[11px] font-medium text-primary" title={noticeText}>
              {noticeText}
            </span>
          )}
        </div>

        <div className="grid min-w-[12rem] justify-items-end gap-1 text-right font-mono text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>{getTransferMetricText(transfer) || '—'}</span>
            <span>{formatBytes(transfer.transferredBytes)}</span>
            {isRetryable && (
              <>
                <button
                  className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                  type="button"
                  title="Retry transfer"
                  aria-label="Retry transfer"
                  onClick={onRetry}
                >
                  <RotateCcw className="size-3.5" />
                </button>
                <button
                  className="rounded px-1.5 py-1 text-[10px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
                  type="button"
                  title="Restart transfer from the beginning"
                  aria-label="Restart transfer from the beginning"
                  onClick={onRestart}
                >
                  Restart
                </button>
              </>
            )}
            {isPausable && (
              <button
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                type="button"
                title="Pause transfer"
                aria-label="Pause transfer"
                onClick={onPause}
              >
                <Pause className="size-3.5" />
              </button>
            )}
            {isPaused && (
              <button
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                type="button"
                title="Resume transfer"
                aria-label="Resume transfer"
                onClick={onResume}
              >
                <Play className="size-3.5" />
              </button>
            )}
            {isCancelable && (
              <button
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                type="button"
                title={transfer.status === 'queued' ? 'Cancel queued transfer' : 'Cancel transfer'}
                aria-label={transfer.status === 'queued' ? 'Cancel queued transfer' : 'Cancel transfer'}
                onClick={onCancel}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">{progress}%</span>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-slate-800/80">
        <div
          className={[
            'h-full rounded',
            transfer.status === 'failed'
              ? 'bg-destructive'
              : transfer.status === 'canceled' || transfer.status === 'paused' || transfer.status === 'queued'
                ? 'bg-slate-600'
                : 'bg-primary',
          ].join(' ')}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function getTransferStatusIcon(transfer: SftpTransferItem) {
  if (transfer.status === 'completed') {
    return <CheckCircle2 className="size-3 text-primary" />;
  }

  if (transfer.status === 'failed') {
    return <AlertTriangle className="size-3 text-destructive" />;
  }

  if (transfer.status === 'canceled') {
    return <XCircle className="size-3 text-muted-foreground" />;
  }

  if (transfer.status === 'paused') {
    return <Pause className="size-3 text-muted-foreground" />;
  }

  return null;
}

function getTransferStatusClassName(transfer: SftpTransferItem) {
  const baseClassName = 'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold';

  if (transfer.status === 'failed') {
    return `${baseClassName} bg-destructive/10 text-destructive`;
  }

  if (transfer.status === 'completed') {
    return `${baseClassName} bg-primary/10 text-primary`;
  }

  if (transfer.status === 'canceled' || transfer.status === 'paused' || transfer.status === 'queued') {
    return `${baseClassName} bg-slate-800 text-muted-foreground`;
  }

  return `${baseClassName} bg-primary/10 text-foreground`;
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

  if (transfer.status === 'paused') {
    return 'paused';
  }

  if (transfer.status === 'queued') {
    return 'queued';
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

function getTransferErrorText(transfer: SftpTransferItem) {
  if (transfer.status !== 'failed' || !transfer.message?.trim()) {
    return '';
  }

  return transfer.message.trim();
}

function getTransferNoticeText(transfer: SftpTransferItem) {
  if (transfer.status === 'failed' || !transfer.message?.trim()) {
    return '';
  }

  return transfer.message.trim();
}

function getTransferFileName(transfer: SftpTransferItem) {
  const path = transfer.direction === 'upload' ? transfer.localPath : transfer.remotePath;
  const normalizedPath = (transfer.direction === 'upload' ? formatLocalDisplayPath(path) : path).replace(/\\/g, '/');

  return normalizedPath.split('/').filter(Boolean).pop() ?? path;
}

function isTransferNotRunningError(message: string) {
  return message.toLowerCase().includes('transfer is not running');
}
