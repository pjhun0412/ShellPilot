import { useCallback, useEffect, useRef, type MouseEventHandler, type RefObject, type WheelEventHandler } from 'react';

import { pasteRdpClipboardFiles, sendRdpInput, setWindowsKeyCapture } from './rdpBridge';
import { resolveScanCode } from './rdpScancodes';
import { isEditableTarget } from './rdpUiUtils';

const MOUSE_BUTTONS = ['left', 'middle', 'right'] as const;
const CLIPBOARD_FILE_READY_DELAY_MS = 650;
const CLIPBOARD_TEXT_READY_DELAY_MS = 250;

interface UseRdpInputHandlersOptions {
  canvasRef: RefObject<HTMLCanvasElement>;
  desktopSize?: { height: number; width: number };
  isActive: boolean;
  panelId: string;
  setMessage: (message: string) => void;
  showCanvas: boolean;
}

export function useRdpInputHandlers({
  canvasRef,
  desktopSize,
  isActive,
  panelId,
  setMessage,
  showCanvas,
}: UseRdpInputHandlersOptions) {
  const pendingMouseMoveRef = useRef<{ x: number; y: number }>();
  const mouseMoveFrameRef = useRef<number>();

  const focusCanvas = useCallback(() => {
    canvasRef.current?.focus({ preventScroll: true });
  }, [canvasRef]);

  const toCanvasPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const canvas = canvasRef.current;

      if (!canvas || !desktopSize) {
        return undefined;
      }

      const rect = canvas.getBoundingClientRect();

      if (rect.width === 0 || rect.height === 0) {
        return undefined;
      }

      const x = Math.round(((event.clientX - rect.left) / rect.width) * desktopSize.width);
      const y = Math.round(((event.clientY - rect.top) / rect.height) * desktopSize.height);

      return {
        x: Math.min(Math.max(x, 0), desktopSize.width - 1),
        y: Math.min(Math.max(y, 0), desktopSize.height - 1),
      };
    },
    [canvasRef, desktopSize],
  );

  const handleMouseMove: MouseEventHandler<HTMLCanvasElement> = useCallback(
    (event) => {
      const point = toCanvasPoint(event);

      if (!point) {
        return;
      }

      pendingMouseMoveRef.current = point;

      if (mouseMoveFrameRef.current !== undefined) {
        return;
      }

      mouseMoveFrameRef.current = requestAnimationFrame(() => {
        mouseMoveFrameRef.current = undefined;
        const latestPoint = pendingMouseMoveRef.current;
        pendingMouseMoveRef.current = undefined;

        if (latestPoint) {
          void sendRdpInput(panelId, { type: 'mouseMove', x: latestPoint.x, y: latestPoint.y });
        }
      });
    },
    [panelId, toCanvasPoint],
  );

  const handleMouseButton = useCallback(
    (down: boolean): MouseEventHandler<HTMLCanvasElement> =>
      (event) => {
        const point = toCanvasPoint(event);
        const button = MOUSE_BUTTONS[event.button];

        if (point && button) {
          event.currentTarget.focus();
          event.preventDefault();
          void sendRdpInput(panelId, { type: 'mouseButton', x: point.x, y: point.y, button, down });
        }
      },
    [panelId, toCanvasPoint],
  );

  const handleWheel: WheelEventHandler<HTMLCanvasElement> = useCallback(
    (event) => {
      const point = toCanvasPoint(event);

      if (point) {
        const delta = Math.max(Math.min(-event.deltaY, 255), -255);

        event.preventDefault();
        void sendRdpInput(panelId, { type: 'mouseWheel', x: point.x, y: point.y, delta });
      }
    },
    [panelId, toCanvasPoint],
  );

  const sendKeyInput = useCallback(
    async (code: string, down: boolean) => {
      const scanCode = resolveScanCode(code);

      if (!scanCode) {
        return;
      }

      await sendRdpInput(panelId, { type: 'key', code: scanCode.code, extended: scanCode.extended, down });
    },
    [panelId],
  );

  const sendRemoteWindowsMenu = useCallback(async () => {
    await sendKeyInput('ControlLeft', true);
    await sendKeyInput('Escape', true);
    await sendKeyInput('Escape', false);
    await sendKeyInput('ControlLeft', false);
    focusCanvas();
  }, [focusCanvas, sendKeyInput]);

  const sendPasteShortcut = useCallback(async () => {
    await sendKeyInput('ControlLeft', true);
    await sendKeyInput('KeyV', true);
    await sendKeyInput('KeyV', false);
    await sendKeyInput('ControlLeft', false);
    focusCanvas();
  }, [focusCanvas, sendKeyInput]);

  const pasteLocalClipboard = useCallback(async () => {
    let pastedFileCount = 0;

    try {
      pastedFileCount = await pasteRdpClipboardFiles(panelId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      focusCanvas();
      return;
    }

    if (pastedFileCount > 0) {
      setMessage(`Shared ${pastedFileCount} local file${pastedFileCount === 1 ? '' : 's'} with the RDP clipboard.`);
      await waitForClipboardAdvertisement(CLIPBOARD_FILE_READY_DELAY_MS);
      await sendPasteShortcut();
      return;
    }

    const text = await navigator.clipboard?.readText().catch(() => '');

    if (!text) {
      setMessage('Local clipboard is empty or unavailable.');
      focusCanvas();
      return;
    }

    await sendRdpInput(panelId, { type: 'clipboardText', text });
    setMessage('Shared local clipboard text with the RDP clipboard.');
    await waitForClipboardAdvertisement(CLIPBOARD_TEXT_READY_DELAY_MS);
    await sendPasteShortcut();
  }, [focusCanvas, panelId, sendPasteShortcut, setMessage]);

  const sendKeyboardEvent = useCallback(
    (code: string, down: boolean) => {
      if (code === 'MetaLeft' || code === 'MetaRight') {
        if (down) {
          void sendRemoteWindowsMenu();
        }

        return true;
      }

      const scanCode = resolveScanCode(code);

      if (!scanCode) {
        return false;
      }

      void sendRdpInput(panelId, { type: 'key', code: scanCode.code, extended: scanCode.extended, down });
      return true;
    },
    [panelId, sendRemoteWindowsMenu],
  );

  useEffect(() => {
    if (!isActive || !showCanvas) {
      return;
    }

    focusCanvas();
  }, [focusCanvas, isActive, showCanvas]);

  useEffect(() => {
    if (!isActive || !showCanvas) {
      return;
    }

    void setWindowsKeyCapture(panelId);

    return () => {
      void setWindowsKeyCapture(null);
    };
  }, [isActive, panelId, showCanvas]);

  useEffect(() => {
    if (!isActive || !showCanvas) {
      return;
    }

    const handleWindowKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (
        event.type === 'keydown' &&
        !event.repeat &&
        event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === 'KeyV'
      ) {
        event.preventDefault();
        event.stopPropagation();
        void pasteLocalClipboard();
        return;
      }

      if ((event.code === 'MetaLeft' || event.code === 'MetaRight') && event.repeat) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!sendKeyboardEvent(event.code, event.type === 'keydown')) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleWindowKey, true);
    window.addEventListener('keyup', handleWindowKey, true);

    return () => {
      window.removeEventListener('keydown', handleWindowKey, true);
      window.removeEventListener('keyup', handleWindowKey, true);
    };
  }, [isActive, pasteLocalClipboard, sendKeyboardEvent, showCanvas]);

  useEffect(() => {
    return () => {
      if (mouseMoveFrameRef.current !== undefined) {
        cancelAnimationFrame(mouseMoveFrameRef.current);
        mouseMoveFrameRef.current = undefined;
      }
    };
  }, []);

  return {
    focusCanvas,
    handleMouseButton,
    handleMouseMove,
    handleWheel,
    sendRemoteWindowsMenu,
  };
}

function waitForClipboardAdvertisement(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}
