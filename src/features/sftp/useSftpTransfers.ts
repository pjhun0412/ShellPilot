import { useEffect, useMemo, useRef, useState } from 'react';

import { revealLocalPath, type SftpTransferEvent } from './sftpBridge';
import {
  getSftpTransferStoreSnapshot,
  removeSftpTransfer,
  subscribeSftpTransferStore,
} from './sftpTransferStore';
import type { SftpTransferItem } from './sftpTransferTypes';

export function useSftpTransfers({
  maxItems = 8,
  onError,
  onDownloadCompleted,
  onUploadCompleted,
  panelId,
}: {
  maxItems?: number;
  onDownloadCompleted?: (event: SftpTransferEvent) => void;
  onError: (message: string) => void;
  onUploadCompleted: () => void;
  panelId: string;
}) {
  const uploadCompletedRefreshTimerRef = useRef<number>();
  const onDownloadCompletedRef = useRef(onDownloadCompleted);
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
      queued: transfers.filter((item) => item.status === 'queued').length,
      running: transfers.filter((item) => item.status === 'paused' || item.status === 'progress' || item.status === 'started').length,
      total: transfers.length,
    }),
    [transfers],
  );

  useEffect(() => {
    onDownloadCompletedRef.current = onDownloadCompleted;
  }, [onDownloadCompleted]);

  useEffect(() => {
    onUploadCompletedRef.current = onUploadCompleted;
  }, [onUploadCompleted]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    return () => {
      if (uploadCompletedRefreshTimerRef.current !== undefined) {
        window.clearTimeout(uploadCompletedRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return subscribeSftpTransferStore((items, event) => {
      setTransfers(getPanelTransfers(items, panelId, maxItems));

      if (!event || event.panelId !== panelId) {
        return;
      }

      if (event.status === 'completed' && event.direction === 'upload') {
        scheduleUploadCompletedRefresh();
      }

      if (event.status === 'completed' && event.direction === 'download') {
        onDownloadCompletedRef.current?.(event);
      }
    });
  }, [maxItems, panelId]);

  const scheduleUploadCompletedRefresh = () => {
    if (uploadCompletedRefreshTimerRef.current !== undefined) {
      window.clearTimeout(uploadCompletedRefreshTimerRef.current);
    }

    uploadCompletedRefreshTimerRef.current = window.setTimeout(() => {
      uploadCompletedRefreshTimerRef.current = undefined;
      onUploadCompletedRef.current();
    }, 150);
  };

  const removeTransfer = (transferId: string) => {
    removeSftpTransfer(transferId);
  };

  const revealDownloadedTransfer = async (transfer: SftpTransferItem) => {
    try {
      await revealLocalPath(transfer.localPath);
    } catch (error) {
      onErrorRef.current(error instanceof Error ? error.message : String(error));
    }
  };

  return {
    removeTransfer,
    revealDownloadedTransfer,
    transferSummary,
    transfers,
  };
}

function getPanelTransfers(transfers: SftpTransferItem[], panelId: string, maxItems: number) {
  return transfers.filter((item) => item.panelId === panelId).slice(0, maxItems);
}
