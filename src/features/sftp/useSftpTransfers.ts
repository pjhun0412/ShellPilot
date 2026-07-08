import { useEffect, useMemo, useRef, useState } from 'react';

import { listenSftpTransferEvents, revealLocalPath } from './sftpBridge';
import {
  isSftpTerminalTransferStatus,
  mergeTransferEvent,
} from './sftpPanelUtils';
import type { SftpTransferItem } from './sftpTransferTypes';

export function useSftpTransfers({
  maxItems = 8,
  onError,
  onUploadCompleted,
  panelId,
}: {
  maxItems?: number;
  onError: (message: string) => void;
  onUploadCompleted: () => void;
  panelId: string;
}) {
  const transferWaitersRef = useRef(new Map<string, () => void>());
  const onUploadCompletedRef = useRef(onUploadCompleted);
  const onErrorRef = useRef(onError);
  const [transfers, setTransfers] = useState<SftpTransferItem[]>([]);
  const transferSummary = useMemo(
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
    onUploadCompletedRef.current = onUploadCompleted;
  }, [onUploadCompleted]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenSftpTransferEvents((event) => {
      if (disposed || event.panelId !== panelId) {
        return;
      }

      setTransfers((items) => {
        const nextEvent = mergeTransferEvent(items.find((item) => item.transferId === event.transferId), event);
        const nextItems = items.some((item) => item.transferId === event.transferId)
          ? items.map((item) => (item.transferId === event.transferId ? nextEvent : item))
          : [nextEvent, ...items];

        return nextItems.slice(0, maxItems);
      });

      if (isSftpTerminalTransferStatus(event.status)) {
        transferWaitersRef.current.get(event.transferId)?.();
        transferWaitersRef.current.delete(event.transferId);
      }

      if (event.status === 'completed' && event.direction === 'upload') {
        onUploadCompletedRef.current();
      }
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
  }, [maxItems, panelId]);

  const addPendingTransfer = (transfer: SftpTransferItem, replaceTransferId?: string) => {
    const pendingTransfer = {
      ...transfer,
      startedAt: Date.now(),
    };

    setTransfers((items) =>
      [
        pendingTransfer,
        ...items.filter((item) =>
          item.transferId !== transfer.transferId && item.transferId !== replaceTransferId
        ),
      ].slice(0, maxItems),
    );
  };

  const waitForTransferCompletion = (transferId: string) =>
    new Promise<void>((resolve) => {
      transferWaitersRef.current.set(transferId, resolve);
    });

  const markTransferFailed = (transferId: string, message: string) => {
    setTransfers((items) =>
      items.map((item) =>
        item.transferId === transferId
          ? { ...item, message, status: 'failed' }
          : item,
      ),
    );
  };

  const removeTransfer = (transferId: string) => {
    setTransfers((items) => items.filter((item) => item.transferId !== transferId));
  };

  const deleteTransferWaiter = (transferId: string) => {
    transferWaitersRef.current.delete(transferId);
  };

  const revealDownloadedTransfer = async (transfer: SftpTransferItem) => {
    try {
      await revealLocalPath(transfer.localPath);
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    addPendingTransfer,
    deleteTransferWaiter,
    markTransferFailed,
    removeTransfer,
    revealDownloadedTransfer,
    transferSummary,
    transfers,
    waitForTransferCompletion,
  };
}
