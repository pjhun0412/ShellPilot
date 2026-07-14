import { listenSftpTransferEvents, type SftpTransferEvent } from './sftpBridge';
import { mergeTransferEvent } from './sftpPanelUtils';
import type { SftpTransferItem } from './sftpTransferTypes';

type SftpTransferStoreListener = (transfers: SftpTransferItem[], event?: SftpTransferEvent) => void;

const maxStoredTransfers = 300;
const listeners = new Set<SftpTransferStoreListener>();
let transfers: SftpTransferItem[] = [];
let listenStarted = false;

export function getSftpTransferStoreSnapshot() {
  ensureSftpTransferStoreListening();

  return transfers;
}

export function subscribeSftpTransferStore(listener: SftpTransferStoreListener) {
  ensureSftpTransferStoreListening();
  listeners.add(listener);
  listener(transfers);

  return () => {
    listeners.delete(listener);
  };
}

export function addSftpPendingTransfer(transfer: SftpTransferItem, replaceTransferId?: string) {
  const pendingTransfer = {
    ...transfer,
    startedAt: transfer.startedAt ?? Date.now(),
  };

  transfers = [
    pendingTransfer,
    ...transfers.filter((item) =>
      item.transferId !== transfer.transferId && item.transferId !== replaceTransferId
    ),
  ].slice(0, maxStoredTransfers);
  notifySftpTransferStore();
}

export function markSftpTransferFailed(transferId: string, message: string) {
  transfers = transfers.map((item) =>
    item.transferId === transferId
      ? { ...item, message, status: 'failed' }
      : item,
  );
  notifySftpTransferStore();
}

export function removeSftpTransfer(transferId: string) {
  transfers = transfers.filter((item) => item.transferId !== transferId);
  notifySftpTransferStore();
}

export function clearFinishedSftpTransfers() {
  transfers = transfers.filter((item) => item.status === 'progress' || item.status === 'started');
  notifySftpTransferStore();
}

function ensureSftpTransferStoreListening() {
  if (listenStarted) {
    return;
  }

  listenStarted = true;

  void listenSftpTransferEvents((event) => {
    const current = transfers.find((item) => item.transferId === event.transferId);
    const nextItem = mergeTransferEvent(current, event);

    transfers = current
      ? transfers.map((item) => (item.transferId === event.transferId ? nextItem : item))
      : [nextItem, ...transfers];
    transfers = transfers.slice(0, maxStoredTransfers);
    notifySftpTransferStore(event);
  }).catch((error) => {
    listenStarted = false;
    console.error('Failed to listen for SFTP transfer events.', error);
  });
}

function notifySftpTransferStore(event?: SftpTransferEvent) {
  for (const listener of listeners) {
    listener(transfers, event);
  }
}
