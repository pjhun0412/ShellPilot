import { useCallback, useRef, type RefObject } from 'react';

import { sendVncInput } from './vncBridge';
import { resolveVncKeysym } from './vncKeys';

interface UseVncInputHandlersOptions {
  canvasRef: RefObject<HTMLCanvasElement>;
  desktopSize?: { height: number; width: number };
  panelId: string;
  setMessage: (message: string) => void;
  showCanvas: boolean;
}

export function useVncInputHandlers({
  canvasRef,
  desktopSize,
  panelId,
  setMessage,
  showCanvas,
}: UseVncInputHandlersOptions) {
  const buttonMaskRef = useRef(0);
  const lastPointerRef = useRef<{ buttons: number; x: number; y: number } | undefined>(undefined);
  const pointerAnimationFrameRef = useRef<number | undefined>(undefined);
  const pendingPointerRef = useRef<{ buttons: number; x: number; y: number } | undefined>(undefined);
  const pressedModifierKeysymsRef = useRef<Set<number>>(new Set());

  const focusCanvas = useCallback(() => {
    canvasRef.current?.focus();
  }, [canvasRef]);

  const resolvePoint = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;

      if (!canvas || !desktopSize) {
        return undefined;
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = desktopSize.width / Math.max(1, rect.width);
      const scaleY = desktopSize.height / Math.max(1, rect.height);

      return {
        x: Math.min(desktopSize.width - 1, Math.max(0, Math.floor((event.clientX - rect.left) * scaleX))),
        y: Math.min(desktopSize.height - 1, Math.max(0, Math.floor((event.clientY - rect.top) * scaleY))),
      };
    },
    [canvasRef, desktopSize],
  );

  const sendPointerNow = useCallback(
    (x: number, y: number, buttons = buttonMaskRef.current) => {
      const lastPointer = lastPointerRef.current;

      if (lastPointer?.x === x && lastPointer.y === y && lastPointer.buttons === buttons) {
        return;
      }

      lastPointerRef.current = { buttons, x, y };
      void sendVncInput(panelId, { type: 'pointer', x, y, buttons }).catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Failed to send VNC pointer input.');
      });
    },
    [panelId, setMessage],
  );

  const flushPendingPointer = useCallback(() => {
    pointerAnimationFrameRef.current = undefined;

    const pointer = pendingPointerRef.current;
    pendingPointerRef.current = undefined;

    if (pointer) {
      sendPointerNow(pointer.x, pointer.y, pointer.buttons);
    }
  }, [sendPointerNow]);

  const sendPointerCoalesced = useCallback(
    (x: number, y: number, buttons = buttonMaskRef.current) => {
      pendingPointerRef.current = { buttons, x, y };

      if (pointerAnimationFrameRef.current == null) {
        pointerAnimationFrameRef.current = window.requestAnimationFrame(flushPendingPointer);
      }
    },
    [flushPendingPointer],
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!showCanvas) {
        return;
      }

      const point = resolvePoint(event);

      if (point) {
        sendPointerCoalesced(point.x, point.y);
      }
    },
    [resolvePoint, sendPointerCoalesced, showCanvas],
  );

  const handleMouseButton = useCallback(
    (down: boolean) => (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!showCanvas) {
        return;
      }

      const point = resolvePoint(event);
      const buttonMask = event.button === 0 ? 1 : event.button === 1 ? 2 : event.button === 2 ? 4 : 0;

      if (!point || buttonMask === 0) {
        return;
      }

      event.preventDefault();
      buttonMaskRef.current = down ? buttonMaskRef.current | buttonMask : buttonMaskRef.current & ~buttonMask;
      pendingPointerRef.current = undefined;
      sendPointerNow(point.x, point.y, buttonMaskRef.current);
    },
    [resolvePoint, sendPointerNow, showCanvas],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      if (!showCanvas) {
        return;
      }

      const point = resolvePoint(event);

      if (!point) {
        return;
      }

      event.preventDefault();
      const wheelMask = event.deltaY < 0 ? 8 : 16;

      pendingPointerRef.current = undefined;
      sendPointerNow(point.x, point.y, buttonMaskRef.current | wheelMask);
      window.setTimeout(() => sendPointerNow(point.x, point.y, buttonMaskRef.current), 20);
    },
    [resolvePoint, sendPointerNow, showCanvas],
  );

  const handleKey = useCallback(
    (down: boolean) => (event: React.KeyboardEvent<HTMLCanvasElement>) => {
      const keysym = resolveVncKeysym(event);

      if (!showCanvas || keysym == null) {
        return;
      }

      event.preventDefault();

      if (isModifierKeysym(keysym)) {
        if (down) {
          if (pressedModifierKeysymsRef.current.has(keysym) && event.repeat) {
            return;
          }

          pressedModifierKeysymsRef.current.add(keysym);
        } else {
          pressedModifierKeysymsRef.current.delete(keysym);
        }
      }

      void sendVncInput(panelId, { type: 'key', keysym, down }).catch((error) => {
        setMessage(error instanceof Error ? error.message : 'Failed to send VNC keyboard input.');
      });
    },
    [panelId, setMessage, showCanvas],
  );

  const handleBlur = useCallback(() => {
    if (pointerAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(pointerAnimationFrameRef.current);
      pointerAnimationFrameRef.current = undefined;
    }

    pendingPointerRef.current = undefined;

    if (buttonMaskRef.current !== 0) {
      buttonMaskRef.current = 0;

      const lastPointer = lastPointerRef.current;
      if (lastPointer) {
        sendPointerNow(lastPointer.x, lastPointer.y, 0);
      }
    }

    if (pressedModifierKeysymsRef.current.size === 0) {
      return;
    }

    const pressedModifiers = [...pressedModifierKeysymsRef.current];
    pressedModifierKeysymsRef.current.clear();

    for (const keysym of pressedModifiers) {
      void sendVncInput(panelId, { type: 'key', keysym, down: false }).catch(() => undefined);
    }
  }, [panelId, sendPointerNow]);

  return {
    focusCanvas,
    handleBlur,
    handleKeyDown: handleKey(true),
    handleKeyUp: handleKey(false),
    handleMouseButton,
    handleMouseMove,
    handleWheel,
  };
}

function isModifierKeysym(keysym: number) {
  return keysym >= 0xffe1 && keysym <= 0xffee;
}
