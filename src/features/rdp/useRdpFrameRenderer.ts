import { useCallback, useRef, useState, type RefObject } from 'react';

import type { RdpFrameEvent } from './rdpBridge';
import {
  createIdleRdpNetworkStats,
  estimateRdpNetworkHealth,
  type RdpNetworkStats,
} from './rdpNetworkStats';

export function useRdpFrameRenderer(canvasRef: RefObject<HTMLCanvasElement>) {
  const [networkStats, setNetworkStats] = useState<RdpNetworkStats>(createIdleRdpNetworkStats);
  const queuedFramesRef = useRef<RdpFrameEvent[]>([]);
  const lastFrameSequenceRef = useRef(0);
  const frameSamplesRef = useRef<Array<{ bytes: number; time: number }>>([]);
  const lastStatsUpdateRef = useRef(0);

  const renderFrame = useCallback(
    (frame: RdpFrameEvent) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');

      if (!ctx) {
        return false;
      }

      const binary = atob(frame.data);
      const bytes = new Uint8ClampedArray(binary.length);

      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }

      ctx.putImageData(new ImageData(bytes, frame.width, frame.height), frame.x, frame.y);
      return true;
    },
    [canvasRef],
  );

  const recordFrameStats = useCallback((frame: RdpFrameEvent) => {
    const now = performance.now();
    const samples = frameSamplesRef.current;
    const bytes = Math.floor((frame.data.length * 3) / 4);

    samples.push({ bytes, time: now });

    while (samples.length > 0 && now - samples[0].time > 5000) {
      samples.shift();
    }

    if (now - lastStatsUpdateRef.current < 350) {
      return;
    }

    lastStatsUpdateRef.current = now;

    const durationMs = samples.length >= 2 ? samples[samples.length - 1].time - samples[0].time : 0;
    const totalBytes = samples.reduce((sum, sample) => sum + sample.bytes, 0);
    const fps = durationMs > 0 ? ((samples.length - 1) / durationMs) * 1000 : 0;
    const averageFrameGapMs = samples.length >= 2 ? durationMs / (samples.length - 1) : null;
    const bytesPerSecond = durationMs > 0 ? (totalBytes / durationMs) * 1000 : 0;

    setNetworkStats({
      averageFrameGapMs,
      bytesPerSecond,
      fps,
      health: estimateRdpNetworkHealth(fps, averageFrameGapMs),
    });
  }, []);

  const flushQueuedFrames = useCallback(() => {
    if (queuedFramesRef.current.length === 0) {
      return;
    }

    const frames = queuedFramesRef.current;
    queuedFramesRef.current = [];

    for (const frame of frames) {
      if (frame.sequence <= lastFrameSequenceRef.current) {
        continue;
      }

      if (!renderFrame(frame)) {
        queuedFramesRef.current = frames.slice(frames.indexOf(frame));
        break;
      }

      lastFrameSequenceRef.current = frame.sequence;
    }
  }, [renderFrame]);

  const drawFrame = useCallback(
    (frame: RdpFrameEvent) => {
      if (frame.sequence <= lastFrameSequenceRef.current) {
        return;
      }

      recordFrameStats(frame);

      if (renderFrame(frame)) {
        lastFrameSequenceRef.current = frame.sequence;
        return;
      }

      queuedFramesRef.current.push(frame);

      if (queuedFramesRef.current.length > 160) {
        queuedFramesRef.current = queuedFramesRef.current.slice(-160);
      }
    },
    [recordFrameStats, renderFrame],
  );

  const resetFrames = useCallback(() => {
    queuedFramesRef.current = [];
    lastFrameSequenceRef.current = 0;
    frameSamplesRef.current = [];
    lastStatsUpdateRef.current = 0;
    setNetworkStats(createIdleRdpNetworkStats());
  }, []);

  return {
    drawFrame,
    flushQueuedFrames,
    networkStats,
    resetFrames,
  };
}

