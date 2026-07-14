const transferQueueOpenEventName = 'shellpilot:sftp-transfer-queue-open';

export function requestSftpTransferQueueOpen() {
  window.dispatchEvent(new CustomEvent(transferQueueOpenEventName));
}

export function subscribeSftpTransferQueueOpen(listener: () => void) {
  window.addEventListener(transferQueueOpenEventName, listener);

  return () => window.removeEventListener(transferQueueOpenEventName, listener);
}
