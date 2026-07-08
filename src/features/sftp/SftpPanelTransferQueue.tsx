import { Download, FolderOpen, RotateCcw, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import type { SftpTransferItem } from './sftpTransferTypes';

export function SftpTransferQueue({
  onCancel,
  onClearFinished,
  onReveal,
  onRetry,
  transfers,
}: {
  onCancel: (transferId: string) => void;
  onClearFinished: () => void;
  onReveal: (transfer: SftpTransferItem) => void;
  onRetry: (transfer: SftpTransferItem) => void;
  transfers: SftpTransferItem[];
}) {
  const runningCount = transfers.filter((item) => item.status === 'progress' || item.status === 'started').length;
  const failedCount = transfers.filter((item) => item.status === 'failed').length;
  const completedCount = transfers.filter((item) => item.status === 'completed').length;
  const canceledCount = transfers.filter((item) => item.status === 'canceled').length;

  return (
    <div className="shrink-0 border-t border-border/60 bg-slate-950/60 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs font-semibold text-slate-200">
          Transfer Queue
          <span className="ml-2 font-mono text-[11px] font-normal text-slate-500" title="Transfer summary">
            {runningCount} running
            {failedCount > 0 && ` / ${failedCount} failed`}
            {canceledCount > 0 && ` / ${canceledCount} canceled`}
            {completedCount > 0 && ` / ${completedCount} done`}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={onClearFinished}
          disabled={completedCount + failedCount + canceledCount === 0}
        >
          Clear Finished
        </Button>
      </div>
      <div className="h-36 min-h-0">
        <OverlayScrollArea>
          <div className="grid gap-1 pr-2">
            {transfers.map((transfer) => {
              const progress = getTransferProgress(transfer);
              const isRunning = transfer.status === 'progress' || transfer.status === 'started';
              const canRetry = Boolean(
                transfer.retryPayload &&
                (transfer.status === 'failed' || transfer.status === 'canceled'),
              );
              const canReveal = transfer.direction === 'download' && transfer.status === 'completed';
              const displayName = getTransferFileName(transfer);
              const detailText = getTransferDetailText(transfer);
              const statusStyle = getTransferStatusStyle(transfer);

              return (
                <div
                  className={[
                    'grid gap-1 rounded border border-border/70 bg-background/70 px-2 py-1.5 text-xs',
                    transfer.status === 'completed' ? 'opacity-70' : '',
                    transfer.status === 'failed' ? 'border-destructive/35 bg-destructive/5' : '',
                  ].join(' ')}
                  key={transfer.transferId}
                >
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                    {transfer.direction === 'upload' ? (
                      <Upload className="size-3.5 text-primary" />
                    ) : (
                      <Download className="size-3.5 text-primary" />
                    )}
                    <div className="grid min-w-0 gap-0.5">
                      <div className="min-w-0 truncate font-medium text-slate-200" title={getTransferDisplayName(transfer)}>
                        {displayName}
                      </div>
                      <div className="min-w-0 truncate font-mono text-[10px] text-slate-500" title={detailText}>
                        {detailText}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase',
                          statusStyle,
                        ].join(' ')}
                      >
                        {formatTransferStatus(transfer)}
                      </span>
                      {isRunning && (
                        <button
                          className="grid size-6 place-items-center rounded text-slate-500 hover:bg-destructive/10 hover:text-destructive"
                          type="button"
                          title="Cancel transfer"
                          aria-label="Cancel transfer"
                          onClick={() => onCancel(transfer.transferId)}
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                      {canRetry && (
                        <button
                          className="grid size-6 place-items-center rounded text-slate-500 hover:bg-primary/10 hover:text-primary"
                          type="button"
                          title="Retry transfer"
                          aria-label="Retry transfer"
                          onClick={() => onRetry(transfer)}
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}
                      {canReveal && (
                        <button
                          className="grid size-6 place-items-center rounded text-slate-500 hover:bg-primary/10 hover:text-primary"
                          type="button"
                          title="Reveal in Explorer"
                          aria-label="Reveal in Explorer"
                          onClick={() => onReveal(transfer)}
                        >
                          <FolderOpen className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-slate-800">
                    <div
                      className={[
                        'h-full rounded transition-[width]',
                        transfer.status === 'failed'
                          ? 'bg-destructive'
                          : transfer.status === 'canceled'
                            ? 'bg-slate-600'
                            : 'bg-primary',
                      ].join(' ')}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {transfer.message && (
                    <div className="truncate text-[11px] text-destructive" title={transfer.message}>
                      {transfer.message}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </OverlayScrollArea>
      </div>
    </div>
  );
}

function getTransferDisplayName(transfer: SftpTransferItem) {
  const sourceName = getLocalFileName(transfer.localPath);
  const targetName = getLocalFileName(transfer.remotePath);

  return transfer.direction === 'upload' ? `${sourceName} -> ${transfer.remotePath}` : `${targetName} -> ${transfer.localPath}`;
}

function getTransferFileName(transfer: SftpTransferItem) {
  return transfer.direction === 'upload'
    ? getLocalFileName(transfer.localPath)
    : getLocalFileName(transfer.remotePath);
}

function getTransferDetailText(transfer: SftpTransferItem) {
  const pathText = transfer.direction === 'upload'
    ? `to ${transfer.remotePath}`
    : `to ${transfer.localPath}`;
  const metricText = getTransferMetricText(transfer);

  return metricText ? `${pathText} / ${metricText}` : pathText;
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
    return 'canceled';
  }

  if (!transfer.totalBytes) {
    return transfer.status === 'started' ? 'starting' : formatBytes(transfer.transferredBytes);
  }

  return `${getTransferProgress(transfer)}%`;
}

function getTransferStatusStyle(transfer: SftpTransferItem) {
  if (transfer.status === 'failed') {
    return 'border-destructive/35 bg-destructive/10 text-destructive';
  }

  if (transfer.status === 'canceled') {
    return 'border-slate-700 bg-slate-900 text-slate-400';
  }

  if (transfer.status === 'completed') {
    return 'border-primary/25 bg-primary/10 text-primary';
  }

  return 'border-slate-700 bg-slate-900 text-slate-300';
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

  const speedText = `${formatBytes(bytesPerSecond)}/s`;

  if (
    transfer.status !== 'started' &&
    transfer.status !== 'progress' ||
    !transfer.totalBytes ||
    transfer.transferredBytes >= transfer.totalBytes
  ) {
    return speedText;
  }

  const remainingSeconds = Math.max(0, (transfer.totalBytes - transfer.transferredBytes) / bytesPerSecond);

  return `${speedText} / ${formatDuration(remainingSeconds)} left`;
}

function getLocalFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function formatBytes(size: number | undefined) {
  if (size === undefined) {
    return '';
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number) {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const restSeconds = roundedSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;

    return `${hours}h ${restMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${restSeconds}s`;
  }

  return `${restSeconds}s`;
}
