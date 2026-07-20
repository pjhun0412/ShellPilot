import type { SftpTransferEvent } from './sftpBridge';

export type SftpTransferRetryPayload =
  | { kind: 'path-upload'; localModifiedAt?: number; localPath: string; localSize: number; remotePath: string; uploadId: string }
  | { file: File; kind: 'drop-upload'; relativePath: string; remotePath: string; uploadId: string }
  | { downloadId: string; kind: 'download'; localPath: string; remotePath: string; totalBytes: number };

export type SftpTransferItem = SftpTransferEvent & {
  retryPayload?: SftpTransferRetryPayload;
  startedAt?: number;
};
