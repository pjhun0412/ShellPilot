import { useCallback, useRef, type RefObject } from 'react';

import type { VncFrameEvent } from './vncBridge';

export function useVncFrameRenderer(canvasRef: RefObject<HTMLCanvasElement>) {
  const queuedFramesRef = useRef<VncFrameEvent[]>([]);
  const lastFrameSequenceRef = useRef(0);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const canvasContextRef = useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  }>();

  const renderFrame = useCallback(
    (frame: VncFrameEvent) => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return false;
      }

      let context = canvasContextRef.current;

      if (context?.canvas !== canvas) {
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          return false;
        }

        context = { canvas, ctx };
        canvasContextRef.current = context;
      }

      if (frame.kind === 'copy') {
        context.ctx.drawImage(
          canvas,
          frame.sourceX,
          frame.sourceY,
          frame.width,
          frame.height,
          frame.x,
          frame.y,
          frame.width,
          frame.height,
        );
        return true;
      }

      context.ctx.putImageData(
        new ImageData(decodeBase64ToClampedArray(frame.data), frame.width, frame.height),
        frame.x,
        frame.y,
      );
      return true;
    },
    [canvasRef],
  );

  const flushQueuedFrames = useCallback(() => {
    animationFrameRef.current = undefined;

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

  const scheduleFlush = useCallback(() => {
    if (animationFrameRef.current != null) {
      return;
    }

    animationFrameRef.current = window.requestAnimationFrame(flushQueuedFrames);
  }, [flushQueuedFrames]);

  const drawFrame = useCallback(
    (frame: VncFrameEvent) => {
      if (frame.sequence <= lastFrameSequenceRef.current) {
        return;
      }

      queuedFramesRef.current.push(frame);
      scheduleFlush();

      if (queuedFramesRef.current.length > 300) {
        flushQueuedFrames();
      }
    },
    [flushQueuedFrames, scheduleFlush],
  );

  const drawFrames = useCallback(
    (frames: VncFrameEvent[]) => {
      if (frames.length === 0) {
        return;
      }

      let queued = false;

      for (const frame of frames) {
        if (frame.sequence > lastFrameSequenceRef.current) {
          queuedFramesRef.current.push(frame);
          queued = true;
        }
      }

      if (!queued) {
        return;
      }

      scheduleFlush();
      if (queuedFramesRef.current.length > 300) {
        flushQueuedFrames();
      }
    },
    [flushQueuedFrames, scheduleFlush],
  );

  const resetFrames = useCallback(() => {
    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    canvasContextRef.current = undefined;
    queuedFramesRef.current = [];
    lastFrameSequenceRef.current = 0;
  }, []);

  return {
    drawFrame,
    drawFrames,
    flushQueuedFrames,
    resetFrames,
  };
}

function decodeBase64ToClampedArray(data: string) {
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (value: string) => Uint8Array }).fromBase64;

  if (fromBase64) {
    const bytes = fromBase64(data);

    if (bytes.buffer instanceof ArrayBuffer) {
      return new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }

    return new Uint8ClampedArray(bytes);
  }

  const binary = atob(data);
  const bytes = new Uint8ClampedArray(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
