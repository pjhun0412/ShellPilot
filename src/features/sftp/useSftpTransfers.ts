import { useEffect, useMemo, useRef, useState } from 'react';

import { revealLocalPath } from './sftpBridge';
import { isSftpTerminalTransferStatus } from './sftpPanelUtils';
import {
  addSftpPendingTransfer,
  getSftpTransferStoreSnapshot,
  markSftpTransferFailed,
  removeSftpTransfer,
  subscribeSftpTransferStore,
} from './sftpTransferStore';
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
  const [transfers, setTransfers] = useState<SftpTransferItem[]>(() =>
    getPanelTransfers(getSftpTransferStoreSnapshot(), panelId, maxItems)
  );
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
    return subscribeSftpTransferStore((items, event) => {
      setTransfers(getPanelTransfers(items, panelId, maxItems));

      if (!event || event.panelId !== panelId) {
        return;
      }

      if (isSftpTerminalTransferStatus(event.status)) {
        transferWaitersRef.current.get(event.transferId)?.();
        transferWaitersRef.current.delete(event.transferId);
      }

      if (event.status === 'completed' && event.direction === 'upload') {
        onUploadCompletedRef.current();
      }
    });
  }, [maxItems, panelId]);

  const addPendingTransfer = (transfer: SftpTransferItem, replaceTransferId?: string) => {
    addSftpPendingTransfer(transfer, replaceTransferId);
  };

  const waitForTransferCompletion = (transferId: string) =>
    new Promise<void>((resolve) => {
      transferWaitersRef.current.set(transferId, resolve);
    });

  const markTransferFailed = (transferId: string, message: string) => {
    markSftpTransferFailed(transferId, message);
  };

  const removeTransfer = (transferId: string) => {
    removeSftpTransfer(transferId);
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

function getPanelTransfers(transfers: SftpTransferItem[], panelId: string, maxItems: number) {
  return transfers.filter((item) => item.panelId === panelId).slice(0, maxItems);
}
