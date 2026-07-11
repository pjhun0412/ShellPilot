import type { ConnectionStatus } from '@/features/connections/connectionStatus';

import { RdpOpenError, type RdpStatus } from './rdpBridge';

export function mapRdpStatusToConnectionStatus(status: RdpStatus): ConnectionStatus {
  if (status === 'connected' || status === 'frameReady') {
    return 'connected';
  }

  if (status === 'connecting') {
    return 'connecting';
  }

  if (status === 'failed') {
    return 'failed';
  }

  return 'closed';
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  return Boolean(element.closest('input, textarea, select, [contenteditable="true"]'));
}

export function isInteractiveTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  return Boolean(element.closest('button, input, textarea, select, a, [contenteditable="true"]'));
}

export function normalizeRdpOpenError(error: unknown): RdpOpenError {
  if (error instanceof RdpOpenError) {
    return error;
  }

  return new RdpOpenError(error instanceof Error ? error.message : String(error));
}

