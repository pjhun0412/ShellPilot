import {
  cancelSftpTransfer,
  closeSftpUploadStream,
  downloadSftpFile,
  getLocalPathMetadata,
  openSftpUploadStream,
  pauseSftpTransfer,
  resumeSftpTransfer,
  uploadSftpFile,
  writeSftpUploadStreamChunk,
} from './sftpBridge';
import {
  createTransferId,
  isSftpTerminalTransferStatus,
  isSftpTransferCanceledError,
} from './sftpPanelUtils';
import {
  addSftpPendingTransfer,
  ensureSftpTransferStoreListening,
  markSftpTransferCanceled,
  markSftpTransferFailed,
  markSftpTransferPaused,
  markSftpTransferResumed,
  markSftpTransferStarted,
  subscribeSftpTransferStore,
} from './sftpTransferStore';
import type {
  SftpTransferItem,
  SftpTransferRetryPayload,
} from './sftpTransferTypes';

const sftpTransferConcurrencyStorageKey = 'shellpilot.sftp.transferConcurrency';
const sftpTransferDefaultConcurrency = 4;
const sftpTransferMinConcurrency = 1;
const sftpTransferMaxConcurrency = 8;
const sftpUploadStreamChunkSize = 4 * 1024 * 1024;

type SftpQueuedTransfer = {
  resolve: () => void;
  run: () => Promise<void>;
  transferId: string;
};

type SftpTransferQueueListener = (snapshot: SftpTransferSchedulerSnapshot) => void;

export type SftpTransferSchedulerSnapshot = {
  activeCount: number;
  concurrency: number;
  paused: boolean;
  queuedCount: number;
};

const queue: SftpQueuedTransfer[] = [];
const listeners = new Set<SftpTransferQueueListener>();
const activeTransferIds = new Set<string>();
let activeCount = 0;
let sftpTransferConcurrency = readSftpTransferConcurrency();
let paused = false;
let readinessPumpPending = false;

export function enqueueSftpTransfer(
  transfer: SftpTransferItem,
  run: () => Promise<void>,
  replaceTransferId?: string,
) {
  const queuedTransfer = { ...transfer, message: undefined, startedAt: undefined, status: 'queued' as const, transferredBytes: 0 };

  addSftpPendingTransfer(queuedTransfer, replaceTransferId);

  return new Promise<void>((resolve) => {
    queue.push({ resolve, run, transferId: transfer.transferId });
    notifySftpTransferQueue();
    pumpSftpTransferQueue();
  });
}

export function cancelQueuedSftpTransfer(transferId: string) {
  const index = queue.findIndex((item) => item.transferId === transferId);

  if (index === -1) {
    return false;
  }

  const [item] = queue.splice(index, 1);
  markSftpTransferCanceled(transferId, 'Transfer canceled before it started.');
  item.resolve();
  notifySftpTransferQueue();

  return true;
}

export function pauseSftpTransferQueue() {
  paused = true;
  for (const transferId of activeTransferIds) {
    markSftpTransferPaused(transferId);
    void pauseSftpTransfer(transferId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);

      if (!isTransferNotRunningError(message)) {
        markSftpTransferFailed(transferId, message);
      }
    });
  }
  notifySftpTransferQueue();
}

export function resumeSftpTransferQueue() {
  paused = false;
  for (const transferId of activeTransferIds) {
    markSftpTransferResumed(transferId);
    void resumeSftpTransfer(transferId).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);

      if (!isTransferNotRunningError(message)) {
        markSftpTransferFailed(transferId, message);
      }
    });
  }
  notifySftpTransferQueue();
  pumpSftpTransferQueue();
}

export function getSftpTransferSchedulerSnapshot(): SftpTransferSchedulerSnapshot {
  return {
    activeCount,
    concurrency: sftpTransferConcurrency,
    paused,
    queuedCount: queue.length,
  };
}

export function setSftpTransferConcurrency(nextConcurrency: number) {
  const concurrency = clampSftpTransferConcurrency(nextConcurrency);

  if (sftpTransferConcurrency === concurrency) {
    return;
  }

  sftpTransferConcurrency = concurrency;
  writeSftpTransferConcurrency(concurrency);
  notifySftpTransferQueue();
  pumpSftpTransferQueue();
}

export function subscribeSftpTransferScheduler(listener: SftpTransferQueueListener) {
  listeners.add(listener);
  listener(getSftpTransferSchedulerSnapshot());

  return () => {
    listeners.delete(listener);
  };
}

export function retrySftpTransfer(transfer: SftpTransferItem) {
  return retrySftpTransferWithMode(transfer, 'resume');
}

export function restartSftpTransfer(transfer: SftpTransferItem) {
  return retrySftpTransferWithMode(transfer, 'restart');
}

function retrySftpTransferWithMode(transfer: SftpTransferItem, mode: 'restart' | 'resume') {
  const retryPayload = transfer.retryPayload;

  if (transfer.status !== 'failed' || !retryPayload) {
    return Promise.resolve();
  }

  const retryTransfer = createRetryTransferItem({ ...transfer, retryPayload }, mode);
  const run = createRetryTransferRunner(retryTransfer);

  return enqueueSftpTransfer(retryTransfer, run, transfer.transferId);
}

export function retryFailedSftpTransfers(transfers: SftpTransferItem[]) {
  return Promise.all(
    transfers
      .filter((transfer) => transfer.status === 'failed' && transfer.retryPayload)
      .map((transfer) => retrySftpTransfer(transfer)),
  );
}

function pumpSftpTransferQueue() {
  if (
    readinessPumpPending ||
    paused ||
    activeCount >= sftpTransferConcurrency ||
    queue.length === 0
  ) {
    return;
  }

  readinessPumpPending = true;
  const pendingTransferId = queue[0].transferId;

  void ensureSftpTransferStoreListening().then(
    () => {
      readinessPumpPending = false;
      startReadySftpTransfers();
    },
    (error) => {
      readinessPumpPending = false;
      failQueuedSftpTransfer(pendingTransferId, error);
      pumpSftpTransferQueue();
    },
  );
}

function startReadySftpTransfers() {
  while (!paused && activeCount < sftpTransferConcurrency && queue.length > 0) {
    const item = queue.shift();

    if (!item) {
      return;
    }

    activeCount += 1;
    activeTransferIds.add(item.transferId);
    markSftpTransferStarted(item.transferId);
    notifySftpTransferQueue();

    void item.run()
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);

        if (!isSftpTransferCanceledError(message)) {
          markSftpTransferFailed(item.transferId, message);
        }
      })
      .finally(() => {
        activeTransferIds.delete(item.transferId);
        activeCount = Math.max(0, activeCount - 1);
        item.resolve();
        notifySftpTransferQueue();
        pumpSftpTransferQueue();
      });
  }
}

function failQueuedSftpTransfer(transferId: string, error: unknown) {
  const index = queue.findIndex((item) => item.transferId === transferId);

  if (index === -1) {
    return;
  }

  const [item] = queue.splice(index, 1);
  const message = error instanceof Error ? error.message : String(error);

  markSftpTransferFailed(transferId, message);
  item.resolve();
  notifySftpTransferQueue();
}

function notifySftpTransferQueue() {
  const snapshot = getSftpTransferSchedulerSnapshot();

  for (const listener of listeners) {
    listener(snapshot);
  }
}

function createRetryTransferItem(
  previous: SftpTransferItem & { retryPayload: SftpTransferRetryPayload },
  mode: 'restart' | 'resume',
): SftpTransferItem {
  let retryPayload = previous.retryPayload;
  const transferId = createTransferId();

  if (retryPayload.kind === 'path-upload') {
    retryPayload = { ...retryPayload, uploadId: mode === 'restart' ? transferId : retryPayload.uploadId };
  } else if (retryPayload.kind === 'drop-upload') {
    retryPayload = { ...retryPayload, uploadId: mode === 'restart' ? transferId : retryPayload.uploadId };
  } else if (retryPayload.kind === 'download') {
    retryPayload = { ...retryPayload, downloadId: mode === 'restart' ? transferId : retryPayload.downloadId };
  }

  return {
    ...previous,
    message: undefined,
    retryPayload,
    startedAt: undefined,
    status: 'queued',
    totalBytes: getRetryTransferTotalBytes(retryPayload, previous.totalBytes),
    transferredBytes: 0,
    transferId,
  };
}

function getRetryTransferTotalBytes(
  retryPayload: SftpTransferRetryPayload,
  fallbackTotalBytes: number,
) {
  if (retryPayload.kind === 'drop-upload') {
    return retryPayload.file.size;
  }

  if (retryPayload.kind === 'download') {
    return retryPayload.totalBytes;
  }

  return fallbackTotalBytes;
}

function createRetryTransferRunner(transfer: SftpTransferItem) {
  const retryPayload = transfer.retryPayload;

  if (!retryPayload) {
    return async () => undefined;
  }

  if (retryPayload.kind === 'path-upload') {
    return async () => {
      const currentMetadata = await getLocalPathMetadata(retryPayload.localPath);
      const shouldRestart = hasPathUploadSourceChanged(retryPayload, currentMetadata);
      const uploadId = shouldRestart ? transfer.transferId : retryPayload.uploadId;

      await runBackendTransferUntilTerminal(
        transfer.transferId,
        () => uploadSftpFile(
          transfer.panelId,
          retryPayload.localPath,
          retryPayload.remotePath,
          transfer.transferId,
          uploadId,
        ),
      );
    };
  }

  if (retryPayload.kind === 'download') {
    return () => runBackendTransferUntilTerminal(
      transfer.transferId,
      () => downloadSftpFile(
        transfer.panelId,
        retryPayload.remotePath,
        retryPayload.localPath,
        transfer.transferId,
        retryPayload.downloadId,
      ),
    );
  }

  return async () => {
    try {
      const resumeOffset = await openSftpUploadStream(
        transfer.panelId,
        retryPayload.relativePath,
        retryPayload.remotePath,
        transfer.transferId,
        retryPayload.file.size,
        retryPayload.uploadId,
      );

      for (let offset = resumeOffset; offset < retryPayload.file.size; offset += sftpUploadStreamChunkSize) {
        const chunk = retryPayload.file.slice(offset, Math.min(offset + sftpUploadStreamChunkSize, retryPayload.file.size));
        const buffer = await chunk.arrayBuffer();

        await writeSftpUploadStreamChunk(transfer.transferId, new Uint8Array(buffer));
      }

      await closeSftpUploadStream(transfer.transferId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isSftpTransferCanceledError(message)) {
        return;
      }

      try {
        await cancelSftpTransfer(transfer.transferId);
      } catch {
        // The backend may already have removed the stream after a write failure.
      }

      throw error;
    }
  };
}

function isTransferNotRunningError(message: string) {
  return message.toLowerCase().includes('transfer is not running');
}

function hasPathUploadSourceChanged(
  retryPayload: Extract<SftpTransferRetryPayload, { kind: 'path-upload' }>,
  currentMetadata: { modifiedAt?: number; size: number },
) {
  if (retryPayload.localSize !== currentMetadata.size) {
    return true;
  }

  if (
    retryPayload.localModifiedAt !== undefined &&
    currentMetadata.modifiedAt !== undefined &&
    retryPayload.localModifiedAt !== currentMetadata.modifiedAt
  ) {
    return true;
  }

  return false;
}

function readSftpTransferConcurrency() {
  const storedValue = typeof window === 'undefined'
    ? undefined
    : window.localStorage.getItem(sftpTransferConcurrencyStorageKey);
  const parsedValue = storedValue ? Number.parseInt(storedValue, 10) : sftpTransferDefaultConcurrency;

  return clampSftpTransferConcurrency(parsedValue);
}

function writeSftpTransferConcurrency(concurrency: number) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(sftpTransferConcurrencyStorageKey, String(concurrency));
}

function clampSftpTransferConcurrency(concurrency: number) {
  if (!Number.isFinite(concurrency)) {
    return sftpTransferDefaultConcurrency;
  }

  return Math.max(
    sftpTransferMinConcurrency,
    Math.min(sftpTransferMaxConcurrency, Math.round(concurrency)),
  );
}

export async function runBackendTransferUntilTerminal(
  transferId: string,
  action: () => Promise<void>,
) {
  await ensureSftpTransferStoreListening();

  let unsubscribe: (() => void) | undefined;
  const completion = new Promise<void>((resolve) => {
    unsubscribe = subscribeSftpTransferStore((_, event) => {
      if (event?.transferId === transferId && isSftpTerminalTransferStatus(event.status)) {
        resolve();
      }
    });
  });

  try {
    await action();
    await completion;
  } finally {
    unsubscribe?.();
  }
}
