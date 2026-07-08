import type { SftpTransferEvent } from './sftpBridge';

export type SftpTransferRetryPayload =
  | { kind: 'path-upload'; localPath: string; remotePath: string }
  | { file: File; kind: 'drop-upload'; relativePath: string; remotePath: string }
  | { kind: 'download'; localPath: string; remotePath: string; totalBytes: number };

export type SftpTransferItem = SftpTransferEvent & {
  retryPayload?: SftpTransferRetryPayload;
  startedAt?: number;
};
