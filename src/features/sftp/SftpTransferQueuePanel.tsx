import { AlertTriangle, CheckCircle2, Download, Upload, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { cancelSftpTransfer } from './sftpBridge';
import {
  subscribeSftpSidebarPanelStates,
  type SftpSidebarPanelState,
} from './sftpSidebarState';
import {
  clearFinishedSftpTransfers,
  getSftpTransferStoreSnapshot,
  subscribeSftpTransferStore,
} from './sftpTransferStore';
import type { SftpTransferItem } from './sftpTransferTypes';
import {
  formatBytes,
  formatLocalDisplayPath,
} from './sftpPanelUtils';

export function SftpTransferQueuePanel() {
  const [transfers, setTransfers] = useState<SftpTransferItem[]>(() => getSftpTransferStoreSnapshot());
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

  useEffect(() => subscribeSftpTransferStore(setTransfers), []);

  useEffect(() => subscribeSftpSidebarPanelStates(setPanelStates), []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--workspace-terminal))] text-xs text-slate-200">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-slate-950/55 px-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-semibold text-slate-100">Transfer Queue</span>
          <span className="font-mono text-[11px] text-slate-300">
            {summary.running} running
            {summary.failed > 0 && ` / ${summary.failed} failed`}
            {summary.canceled > 0 && ` / ${summary.canceled} stopped`}
            {summary.completed > 0 && ` / ${summary.completed} done`}
          </span>
        </div>
        <button
          className="rounded px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-accent hover:text-slate-100 disabled:pointer-events-none disabled:opacity-40"
          type="button"
          disabled={summary.total === summary.running}
          onClick={clearFinishedSftpTransfers}
        >
          Clear Finished
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <OverlayScrollArea>
          <div className="grid min-w-[46rem] gap-2 p-2 pr-4">
            {transfers.length === 0 ? (
              <div className="grid h-24 place-items-center rounded border border-dashed border-border/70 text-slate-400">
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
  const localPathText = formatLocalDisplayPath(transfer.localPath);
  const detailText = transfer.direction === 'upload'
    ? `${localPathText} -> ${transfer.remotePath}`
    : `${transfer.remotePath} -> ${localPathText}`;
  const errorText = getTransferErrorText(transfer);

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
            <span className="truncate text-[13px] font-semibold text-slate-50">{getTransferFileName(transfer)}</span>
            <span
              className="max-w-[18rem] truncate rounded border border-border/70 bg-background/50 px-2 py-0.5 font-mono text-[10px] text-slate-300"
              title={serverLabel}
            >
              {serverLabel}
            </span>
            <span className={getTransferStatusClassName(transfer)}>
              {getTransferStatusIcon(transfer)}
              {formatTransferStatus(transfer)}
            </span>
          </div>
          <span className="truncate font-mono text-[11px] text-slate-300" title={detailText}>
            {detailText}
          </span>
          {errorText && (
            <span className="truncate text-[11px] font-medium text-destructive" title={errorText}>
              {errorText}
            </span>
          )}
        </div>

        <div className="grid min-w-[12rem] justify-items-end gap-1 text-right font-mono text-[11px] text-slate-300">
          <div className="flex items-center gap-3">
            <span>{getTransferMetricText(transfer) || '—'}</span>
            <span>{formatBytes(transfer.transferredBytes)}</span>
            {isRunning && (
              <button
                className="grid size-6 place-items-center rounded text-slate-400 hover:bg-destructive/10 hover:text-destructive"
                type="button"
                title="Cancel transfer"
                aria-label="Cancel transfer"
                onClick={onCancel}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-[10px] text-slate-300">{progress}%</span>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded bg-slate-800/80">
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
    return <XCircle className="size-3 text-slate-400" />;
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

  if (transfer.status === 'canceled') {
    return `${baseClassName} bg-slate-800 text-slate-300`;
  }

  return `${baseClassName} bg-primary/10 text-slate-100`;
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

function getTransferFileName(transfer: SftpTransferItem) {
  const path = transfer.direction === 'upload' ? transfer.localPath : transfer.remotePath;
  const normalizedPath = (transfer.direction === 'upload' ? formatLocalDisplayPath(path) : path).replace(/\\/g, '/');

  return normalizedPath.split('/').filter(Boolean).pop() ?? path;
}
