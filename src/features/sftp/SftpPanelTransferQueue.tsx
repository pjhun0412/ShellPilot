import { AlertTriangle, CheckCircle2, Download, ListChecks, Upload, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SftpTransferItem } from './sftpTransferTypes';

export function SftpPanelTransferSummary({
  onOpenQueue,
  summary,
  transfers,
}: {
  onOpenQueue: () => void;
  summary: {
    canceled: number;
    completed: number;
    failed: number;
    running: number;
    total: number;
  };
  transfers: SftpTransferItem[];
}) {
  if (summary.total === 0) {
    return null;
  }

  const activeTransfers = transfers
    .filter((transfer) => transfer.status !== 'completed')
    .slice(0, 2);

  return (
    <div className="shrink-0 border-t border-border/60 bg-slate-950/75 px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <ListChecks className="size-3.5 shrink-0 text-primary" />
          <span className="shrink-0 font-semibold text-slate-200">Transfers</span>
          <span className="min-w-0 truncate font-mono text-[11px] text-slate-300">
            {summary.running} running
            {summary.failed > 0 && ` / ${summary.failed} failed`}
            {summary.canceled > 0 && ` / ${summary.canceled} stopped`}
            {summary.completed > 0 && ` / ${summary.completed} done`}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          type="button"
          onClick={onOpenQueue}
          title="Open global Transfer Queue"
        >
          Open Queue
        </Button>
      </div>

      {activeTransfers.length > 0 && (
        <div className="mt-2 grid gap-1.5">
        {activeTransfers.map((transfer) => {
          const progress = getTransferProgress(transfer);
          const detailText = getTransferDetailText(transfer);
          const errorText = getTransferErrorText(transfer);

          return (
            <button
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded border border-border/60 bg-background/45 px-2 py-1.5 text-left hover:bg-accent/60"
              key={transfer.transferId}
              type="button"
              title={`${detailText}\nOpen global Transfer Queue`}
              onClick={onOpenQueue}
            >
              {getTransferIcon(transfer)}
              <span className="grid min-w-0 gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-slate-200">{getTransferFileName(transfer)}</span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-300">{formatTransferStatus(transfer)}</span>
                </span>
                {errorText && (
                  <span className="truncate text-[11px] font-medium text-destructive" title={errorText}>
                    {errorText}
                  </span>
                )}
                <span className="h-1 overflow-hidden rounded bg-slate-800">
                  <span
                    className={[
                      'block h-full rounded transition-[width]',
                      transfer.status === 'failed'
                        ? 'bg-destructive'
                        : transfer.status === 'canceled'
                          ? 'bg-slate-600'
                          : 'bg-primary',
                    ].join(' ')}
                    style={{ width: `${progress}%` }}
                  />
                </span>
              </span>
            </button>
          );
        })}
        </div>
      )}
    </div>
  );
}

function getTransferIcon(transfer: SftpTransferItem) {
  if (transfer.status === 'failed') {
    return <AlertTriangle className="size-3.5 text-destructive" />;
  }

  if (transfer.status === 'canceled') {
    return <XCircle className="size-3.5 text-slate-500" />;
  }

  if (transfer.status === 'completed') {
    return <CheckCircle2 className="size-3.5 text-primary" />;
  }

  return transfer.direction === 'upload' ? (
    <Upload className="size-3.5 text-primary" />
  ) : (
    <Download className="size-3.5 text-primary" />
  );
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
  const errorText = getTransferErrorText(transfer);

  if (errorText) {
    return `${pathText}\n${errorText}`;
  }

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

function getTransferErrorText(transfer: SftpTransferItem) {
  if (transfer.status !== 'failed' || !transfer.message?.trim()) {
    return '';
  }

  return transfer.message.trim();
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
