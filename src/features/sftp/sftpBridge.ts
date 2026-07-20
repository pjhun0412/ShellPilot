import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  createSshConnectionTarget,
  type SshConnectionTargetOptions,
} from '@/features/connections/sshTarget';
import type { SessionItem } from '@/types/workspace';

export interface SftpEntry {
  filename: string;
  isDirectory: boolean;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  modifiedAt?: number;
  owner?: string;
  path: string;
  permissions?: string;
  size?: number;
}

export interface SftpListResult {
  entries: SftpEntry[];
  path: string;
}

export interface LocalFileEntry {
  filename: string;
  isDirectory: boolean;
  kind: 'directory' | 'file' | 'symlink' | 'other';
  modifiedAt?: number;
  path: string;
  size?: number;
}

export interface LocalListResult {
  entries: LocalFileEntry[];
  path: string;
}

export interface LocalRootEntry {
  label: string;
  path: string;
}

export interface LocalRootsResult {
  roots: LocalRootEntry[];
}

export interface LocalPathMetadata {
  modifiedAt?: number;
  size: number;
}

export type SftpTransferDirection = 'download' | 'upload';
export type SftpTransferStatus = 'canceled' | 'completed' | 'failed' | 'paused' | 'progress' | 'queued' | 'started';

export interface SftpTransferEvent {
  direction: SftpTransferDirection;
  localPath: string;
  message?: string;
  panelId: string;
  remotePath: string;
  status: SftpTransferStatus;
  totalBytes: number;
  transferredBytes: number;
  transferId: string;
}

export async function openSftpSession(
  panelId: string,
  session: SessionItem,
  options: SshConnectionTargetOptions = {},
) {
  const target = createSshConnectionTarget(panelId, session, options);

  await invoke('sftp_open', { target });
}

export async function listSftpDirectory(panelId: string, path: string) {
  return invoke<SftpListResult>('sftp_list', { panelId, path });
}

export async function listLocalDirectory(path?: string) {
  return invoke<LocalListResult>('local_list', { path });
}

export async function listLocalRoots() {
  return invoke<LocalRootsResult>('local_roots');
}

export async function createLocalDirectory(parentPath: string, name: string) {
  await invoke('local_mkdir', { name, parentPath });
}

export async function removeLocalPath(path: string) {
  await invoke('local_remove_path', { path });
}

export async function localPathExists(path: string) {
  return invoke<boolean>('local_path_exists', { path });
}

export async function getLocalPathMetadata(path: string) {
  return invoke<LocalPathMetadata>('local_path_metadata', { path });
}

export async function keepaliveSftpSession(panelId: string) {
  await invoke('sftp_keepalive', { panelId });
}

export async function closeSftpSession(panelId: string) {
  await invoke('sftp_close', { panelId });
}

export async function createSftpDirectory(panelId: string, path: string) {
  await invoke('sftp_mkdir', { panelId, path });
}

export async function renameSftpPath(panelId: string, oldPath: string, newPath: string) {
  await invoke('sftp_rename', { newPath, oldPath, panelId });
}

export async function sftpPathExists(panelId: string, path: string) {
  return invoke<boolean>('sftp_path_exists', { panelId, path });
}

export async function removeSftpFile(panelId: string, path: string) {
  await invoke('sftp_remove_file', { panelId, path });
}

export async function removeSftpDirectory(panelId: string, path: string) {
  await invoke('sftp_remove_dir', { panelId, path });
}

export async function uploadSftpFile(
  panelId: string,
  localPath: string,
  remotePath: string,
  transferId: string,
  uploadId?: string,
) {
  await invoke('sftp_upload', { localPath, panelId, remotePath, transferId, uploadId });
}

export async function openSftpUploadStream(
  panelId: string,
  localPath: string,
  remotePath: string,
  transferId: string,
  totalBytes: number,
  uploadId?: string,
) {
  return invoke<number>('sftp_upload_stream_open', { localPath, panelId, remotePath, totalBytes, transferId, uploadId });
}

export async function writeSftpUploadStreamChunk(transferId: string, chunk: Uint8Array) {
  await invoke('sftp_upload_stream_chunk', chunk, {
    headers: { 'x-transfer-id': transferId },
  });
}

export async function closeSftpUploadStream(transferId: string) {
  await invoke('sftp_upload_stream_close', { transferId });
}

export async function downloadSftpFile(
  panelId: string,
  remotePath: string,
  localPath: string,
  transferId: string,
  downloadId?: string,
) {
  await invoke('sftp_download', { downloadId, localPath, panelId, remotePath, transferId });
}

export async function cancelSftpTransfer(transferId: string) {
  await invoke('sftp_cancel_transfer', { transferId });
}

export async function pauseSftpTransfer(transferId: string) {
  await invoke('sftp_pause_transfer', { transferId });
}

export async function resumeSftpTransfer(transferId: string) {
  await invoke('sftp_resume_transfer', { transferId });
}

export async function revealLocalPath(path: string) {
  await invoke('reveal_local_path', { path });
}

export async function listenSftpTransferEvents(
  listener: (event: SftpTransferEvent) => void,
): Promise<UnlistenFn> {
  return listen<SftpTransferEvent>('shellpilot-sftp-transfer', (event) => listener(event.payload));
}
