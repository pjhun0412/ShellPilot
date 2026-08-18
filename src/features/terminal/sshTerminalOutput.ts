import { acknowledgeSshOutput } from './sshTerminalBridge';
import type { SshTerminalPerformanceDebug } from './sshTerminalPerformanceDebug';

const ACK_RETRY_DELAY_MS = 250;

export interface SshTerminalOutputAcknowledger {
  acknowledge: (streamId: number, sequence: number) => void;
  acceptStream: (streamId: number) => boolean;
  dispose: () => void;
  endStream: (streamId?: number) => void;
}

export function createSshTerminalOutputAcknowledger(
  panelId: string,
  performanceDebug: SshTerminalPerformanceDebug,
): SshTerminalOutputAcknowledger {
  let acknowledgedSequence = 0;
  let activeStreamId: number | undefined;
  let streamActive = false;
  let disposed = false;
  let inFlight = false;
  let pendingSequence = 0;
  let retryTimer: number | undefined;

  const scheduleRetry = () => {
    if (disposed || retryTimer !== undefined) {
      return;
    }

    retryTimer = window.setTimeout(() => {
      retryTimer = undefined;
      void drain();
    }, ACK_RETRY_DELAY_MS);
  };

  const drain = async () => {
    if (
      disposed ||
      inFlight ||
      activeStreamId === undefined ||
      !streamActive ||
      pendingSequence <= acknowledgedSequence
    ) {
      return;
    }

    const streamId = activeStreamId;
    const throughSequence = pendingSequence;
    const startedAt = performance.now();
    let succeeded = false;
    inFlight = true;

    try {
      await acknowledgeSshOutput(panelId, streamId, throughSequence);
      succeeded = true;
      if (!disposed && streamActive && activeStreamId === streamId) {
        acknowledgedSequence = Math.max(acknowledgedSequence, throughSequence);
      }
    } catch {
      if (!disposed && streamActive && activeStreamId === streamId) {
        scheduleRetry();
      }
    } finally {
      performanceDebug.recordAck(streamId, startedAt, succeeded);
      inFlight = false;
      if (
        !disposed &&
        streamActive &&
        retryTimer === undefined &&
        pendingSequence > acknowledgedSequence
      ) {
        void drain();
      }
    }
  };

  return {
    acknowledge(streamId, sequence) {
      if (
        disposed ||
        !streamActive ||
        streamId !== activeStreamId ||
        sequence <= acknowledgedSequence
      ) {
        return;
      }

      pendingSequence = Math.max(pendingSequence, sequence);
      void drain();
    },
    acceptStream(streamId) {
      if (disposed || (activeStreamId !== undefined && streamId < activeStreamId)) {
        return false;
      }

      if (streamId === activeStreamId) {
        return true;
      }

      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }

      activeStreamId = streamId;
      streamActive = true;
      acknowledgedSequence = 0;
      pendingSequence = 0;
      return true;
    },
    dispose() {
      disposed = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    },
    endStream(streamId) {
      if (
        disposed ||
        activeStreamId === undefined ||
        (streamId !== undefined && streamId !== activeStreamId)
      ) {
        return;
      }

      streamActive = false;
      pendingSequence = acknowledgedSequence;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    },
  };
}
