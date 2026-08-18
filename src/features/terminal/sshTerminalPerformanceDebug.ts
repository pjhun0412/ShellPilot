const MAX_LATENCY_SAMPLES = 128;

export interface SshTerminalBackendPerfEvent {
  ackCount: number;
  creditWaitCount: number;
  creditWaitMaxMs: number;
  creditWaitTotalMs: number;
  maxReceiveGapMs: number;
  outstandingBatches: number;
  outstandingBytes: number;
  panelId: string;
  receivedBytes: number;
  receivedPackets: number;
  streamId: number;
}

export interface SshTerminalPerformanceDebug {
  acceptStream: (streamId: number) => void;
  dispose: () => void;
  endStream: (streamId?: number) => void;
  recordAck: (streamId: number, startedAt: number, succeeded: boolean) => void;
  recordBackend: (event: SshTerminalBackendPerfEvent) => void;
  recordData: (streamId: number, dataLength: number) => number;
  recordParsed: (streamId: number, startedAt: number) => void;
}

export function createSshTerminalPerformanceDebug(
  panelId: string,
): SshTerminalPerformanceDebug {
  if (!isSshTerminalPerformanceDebugEnabled()) {
    return createNoopPerformanceDebug();
  }

  let activeStreamId: number | undefined;
  let ackErrors = 0;
  let dataCharacters = 0;
  let dataEvents = 0;
  let disposed = false;
  let frameId: number | undefined;
  let lastDataAt: number | undefined;
  let lastFrameAt: number | undefined;
  let maxDataGapMs = 0;
  let maxFrameGapMs = 0;
  let ackSampleCursor = 0;
  let parseSampleCursor = 0;
  let ackSamples: number[] = [];
  let parseSamples: number[] = [];

  const recordFrame = (now: number) => {
    if (activeStreamId !== undefined && lastFrameAt !== undefined) {
      maxFrameGapMs = Math.max(maxFrameGapMs, now - lastFrameAt);
    }
    lastFrameAt = now;
    frameId = window.requestAnimationFrame(recordFrame);
  };
  frameId = window.requestAnimationFrame(recordFrame);

  const resetWindow = () => {
    ackErrors = 0;
    dataCharacters = 0;
    dataEvents = 0;
    maxDataGapMs = 0;
    maxFrameGapMs = 0;
    ackSampleCursor = 0;
    parseSampleCursor = 0;
    ackSamples = [];
    parseSamples = [];
  };

  return {
    acceptStream(streamId) {
      if (disposed || (activeStreamId !== undefined && streamId < activeStreamId)) {
        return;
      }
      if (streamId !== activeStreamId) {
        activeStreamId = streamId;
        lastDataAt = undefined;
        lastFrameAt = performance.now();
        resetWindow();
      }
    },
    dispose() {
      disposed = true;
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
        frameId = undefined;
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
      activeStreamId = undefined;
      lastDataAt = undefined;
      lastFrameAt = undefined;
    },
    recordAck(streamId, startedAt, succeeded) {
      if (disposed || streamId !== activeStreamId) {
        return;
      }
      if (!succeeded) {
        ackErrors += 1;
      }
      addBoundedSample(ackSamples, performance.now() - startedAt, ackSampleCursor);
      ackSampleCursor = (ackSampleCursor + 1) % MAX_LATENCY_SAMPLES;
    },
    recordBackend(event) {
      if (
        disposed ||
        event.panelId !== panelId ||
        event.streamId !== activeStreamId
      ) {
        return;
      }

      console.info(
        [
          `[ssh-perf] panel=${panelId} stream=${event.streamId}`,
          `rust bytes=${event.receivedBytes} packets=${event.receivedPackets}`,
          `acks=${event.ackCount}`,
          `rxGapMax=${formatMs(event.maxReceiveGapMs)}`,
          `creditWait=${formatMs(event.creditWaitTotalMs)}`,
          `creditWaitMax=${formatMs(event.creditWaitMaxMs)}`,
          `creditStops=${event.creditWaitCount}`,
          `out=${event.outstandingBatches}/${formatBytes(event.outstandingBytes)}`,
          `frontend chars=${dataCharacters} events=${dataEvents}`,
          `eventGapMax=${formatMs(maxDataGapMs)}`,
          `parseP95=${formatMs(percentile95(parseSamples))}`,
          `parseMax=${formatMs(maxSample(parseSamples))}`,
          `ackP95=${formatMs(percentile95(ackSamples))}`,
          `ackErrors=${ackErrors}`,
          `frameGapMax=${formatMs(maxFrameGapMs)}`,
        ].join(' | '),
      );
      resetWindow();
    },
    recordData(streamId, dataLength) {
      const now = performance.now();
      if (disposed || streamId !== activeStreamId) {
        return now;
      }
      if (lastDataAt !== undefined) {
        maxDataGapMs = Math.max(maxDataGapMs, now - lastDataAt);
      }
      lastDataAt = now;
      dataCharacters += dataLength;
      dataEvents += 1;
      return now;
    },
    recordParsed(streamId, startedAt) {
      if (disposed || streamId !== activeStreamId) {
        return;
      }
      addBoundedSample(parseSamples, performance.now() - startedAt, parseSampleCursor);
      parseSampleCursor = (parseSampleCursor + 1) % MAX_LATENCY_SAMPLES;
    },
  };
}

export function isSshTerminalPerformanceDebugEnabled() {
  return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
}

function addBoundedSample(samples: number[], value: number, cursor: number) {
  if (samples.length < MAX_LATENCY_SAMPLES) {
    samples.push(value);
    return;
  }
  samples[cursor] = value;
}

function percentile95(samples: number[]) {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1)];
}

function maxSample(samples: number[]) {
  return samples.length === 0 ? 0 : Math.max(...samples);
}

function formatMs(value: number) {
  return `${value.toFixed(1)}ms`;
}

function formatBytes(value: number) {
  return `${(value / 1024).toFixed(0)}KiB`;
}

function createNoopPerformanceDebug(): SshTerminalPerformanceDebug {
  return {
    acceptStream() {},
    dispose() {},
    endStream() {},
    recordAck() {},
    recordBackend() {},
    recordData: () => 0,
    recordParsed() {},
  };
}
