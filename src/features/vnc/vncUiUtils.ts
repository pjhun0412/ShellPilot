import type { ConnectionStatus } from '@/features/connections/connectionStatus';
import { VncOpenError, type VncStatus } from './vncBridge';

export function mapVncStatusToConnectionStatus(status: VncStatus): ConnectionStatus {
  if (status === 'connecting') {
    return 'connecting';
  }

  if (status === 'connected' || status === 'frameReady') {
    return 'connected';
  }

  if (status === 'failed') {
    return 'failed';
  }

  return 'closed';
}

export function normalizeVncOpenError(error: unknown): VncOpenError {
  if (error instanceof VncOpenError) {
    return error;
  }

  return new VncOpenError(error instanceof Error ? error.message : String(error));
}

export function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('button,input,select,textarea,[role="button"]'));
}

