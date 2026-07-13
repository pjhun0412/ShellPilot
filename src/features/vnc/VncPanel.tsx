import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import type { SessionItem } from '@/types/workspace';
import {
  closeVncSession,
  listenVncEvents,
  listenVncFrameBatches,
  openVncSession,
  sendVncInput,
  type VncEvent,
  type VncStatus,
} from './vncBridge';
import { isInteractiveTarget, mapVncStatusToConnectionStatus, normalizeVncOpenError } from './vncUiUtils';
import { useVncFrameRenderer } from './useVncFrameRenderer';
import { useVncInputHandlers } from './useVncInputHandlers';
import { useVncViewportSize } from './useVncViewportSize';
import { subscribeVncDisconnect, subscribeVncReconnect } from './vncPanelLifecycle';

type VncDisplayMode = 'actual' | 'fit';

interface VncPanelProps {
  autoConnect?: boolean;
  isActive?: boolean;
  panelId: string;
  session: SessionItem;
}

export function VncPanel({ autoConnect = true, isActive: _isActive = false, panelId, session }: VncPanelProps) {
  const [status, setStatus] = useState<VncStatus>('closed');
  const [message, setMessage] = useState('VNC session is not connected.');
  const [desktopSize, setDesktopSize] = useState<{ height: number; width: number }>();
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => document.visibilityState === 'visible');
  const [isPanelVisible, setIsPanelVisible] = useState(true);
  const [displayMode, setDisplayMode] = useState<VncDisplayMode>('fit');
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasFramebufferSizeRef = useRef<{ height: number; width: number }>();
  const canRenderFramesRef = useRef(true);
  const skippedFramesWhileHiddenRef = useRef(false);
  const { drawFrames, flushQueuedFrames, resetFrames } = useVncFrameRenderer(canvasRef);
  const { viewportRef, viewportSize } = useVncViewportSize<HTMLDivElement>();

  const endpoint = useMemo(() => `${session.host ?? 'unknown'}:${session.port ?? 5900}`, [session.host, session.port]);
  const authLabel = useMemo(() => (session.username?.trim() ? `ARD · ${session.username.trim()}` : 'VNC password'), [session.username]);
  const showCanvas = Boolean(desktopSize) && (status === 'connected' || status === 'frameReady');
  const canvasDisplaySize = useMemo(() => {
    if (!desktopSize || !viewportSize || viewportSize.width === 0 || viewportSize.height === 0) {
      return undefined;
    }

    if (displayMode === 'actual') {
      return desktopSize;
    }

    const scale = Math.min(viewportSize.width / desktopSize.width, viewportSize.height / desktopSize.height);

    return {
      height: Math.max(1, Math.floor(desktopSize.height * scale)),
      width: Math.max(1, Math.floor(desktopSize.width * scale)),
    };
  }, [desktopSize, displayMode, viewportSize]);
  const canvasStyle = useMemo<CSSProperties | undefined>(() => {
    if (!canvasDisplaySize) {
      return undefined;
    }

    return {
      ...canvasDisplaySize,
      imageRendering: 'auto',
    };
  }, [canvasDisplaySize]);
  const canRenderFrames = showCanvas && isDocumentVisible && isPanelVisible;
  const { focusCanvas, handleBlur, handleKeyDown, handleKeyUp, handleMouseButton, handleMouseMove, handleWheel } =
    useVncInputHandlers({
      canvasRef,
      desktopSize,
      panelId,
      setMessage,
      showCanvas,
    });

  useEffect(() => {
    canRenderFramesRef.current = canRenderFrames;
  }, [canRenderFrames]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    const root = rootRef.current;

    if (!root || typeof IntersectionObserver === 'undefined') {
      setIsPanelVisible(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setIsPanelVisible(Boolean(entry?.isIntersecting));
    });

    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const applyEvent = useCallback(
    (event: VncEvent) => {
      setStatus(event.status);
      publishConnectionStatus({ panelId, status: mapVncStatusToConnectionStatus(event.status) });
      setIsConnecting(event.status === 'connecting');

      if (event.message) {
        setMessage(event.message);
      }

      if (event.desktopWidth && event.desktopHeight) {
        setDesktopSize({ height: event.desktopHeight, width: event.desktopWidth });
      }
    },
    [panelId],
  );

  useEffect(() => {
    let unlistenEvents: (() => void) | undefined;
    let unlistenFrames: (() => void) | undefined;
    let disposed = false;

    listenVncEvents((event) => {
      if (event.panelId === panelId) {
        applyEvent(event);
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }

      unlistenEvents = unlisten;
    });

    listenVncFrameBatches((frames) => {
      const firstFrame = frames[0];

      if (!firstFrame) {
        return;
      }

      let panelFrames: typeof frames | undefined;

      if (firstFrame.panelId === panelId && frames.every((frame) => frame.panelId === panelId)) {
        panelFrames = frames;
      } else {
        panelFrames = frames.filter((frame) => frame.panelId === panelId);
      }

      if (panelFrames.length === 0) {
        return;
      }

      if (!canRenderFramesRef.current) {
        skippedFramesWhileHiddenRef.current = true;
        return;
      }

      drawFrames(panelFrames);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }

      unlistenFrames = unlisten;
    });

    return () => {
      disposed = true;
      unlistenEvents?.();
      unlistenFrames?.();
      publishConnectionStatus({ panelId, status: 'closed' });
      void closeVncSession(panelId);
    };
  }, [applyEvent, drawFrames, panelId]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !desktopSize || !canRenderFrames) {
      return;
    }

    const canvasFramebufferSize = canvasFramebufferSizeRef.current;

    if (canvasFramebufferSize?.width !== desktopSize.width || canvasFramebufferSize.height !== desktopSize.height) {
      canvas.width = desktopSize.width;
      canvas.height = desktopSize.height;
      canvasFramebufferSizeRef.current = desktopSize;
    }

    flushQueuedFrames();
  }, [canRenderFrames, desktopSize, flushQueuedFrames]);

  useEffect(() => {
    if (!canRenderFrames || !skippedFramesWhileHiddenRef.current) {
      return;
    }

    skippedFramesWhileHiddenRef.current = false;
    resetFrames();
    void sendVncInput(panelId, { type: 'refresh', full: true }).catch(() => undefined);
  }, [canRenderFrames, panelId, resetFrames]);

  useEffect(() => {
    if (!autoConnect) {
      return;
    }

    void connect();
    // Only auto-connect on panel mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, panelId]);

  useEffect(() => {
    if (!canRenderFrames) {
      return;
    }

    let disposed = false;
    let timer: number | undefined;

    const scheduleRefresh = () => {
      timer = window.setTimeout(() => {
        void sendVncInput(panelId, { type: 'refresh' })
          .catch(() => undefined)
          .finally(() => {
            if (!disposed) {
              scheduleRefresh();
            }
          });
      }, 33);
    };

    scheduleRefresh();

    return () => {
      disposed = true;

      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [canRenderFrames, panelId]);

  const connect = async () => {
    setNeedsPassword(false);
    setIsConnecting(true);
    setStatus('connecting');
    publishConnectionStatus({ panelId, status: 'connecting' });
    setMessage(`Connecting to ${endpoint}...`);
    canvasFramebufferSizeRef.current = undefined;
    resetFrames();

    try {
      await openVncSession(panelId, session, {
        ...(password ? { password } : {}),
      });
    } catch (error) {
      const normalized = normalizeVncOpenError(error);
      setIsConnecting(false);
      setStatus('failed');
      publishConnectionStatus({ panelId, status: 'failed' });
      setMessage(normalized.message);
      setNeedsPassword(normalized.authPrompt);
    }
  };

  const disconnect = async () => {
    await closeVncSession(panelId);
    setStatus('closed');
    publishConnectionStatus({ panelId, status: 'closed' });
    setMessage('VNC session closed.');
    setIsConnecting(false);
  };

  const connectRequestRef = useRef(connect);
  const disconnectRequestRef = useRef(disconnect);

  useEffect(() => {
    connectRequestRef.current = connect;
    disconnectRequestRef.current = disconnect;
  });

  useEffect(() => {
    const unsubscribeDisconnect = subscribeVncDisconnect((requestedPanelId) => {
      if (requestedPanelId !== panelId) {
        return false;
      }

      void disconnectRequestRef.current();
      return true;
    });
    const unsubscribeReconnect = subscribeVncReconnect((requestedPanelId) => {
      if (requestedPanelId !== panelId) {
        return false;
      }

      void connectRequestRef.current();
      return true;
    });

    return () => {
      unsubscribeDisconnect();
      unsubscribeReconnect();
    };
  }, [panelId]);

  const content = showCanvas ? (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      className="block outline-none"
      style={canvasStyle}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onMouseDown={handleMouseButton(true)}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseButton(false)}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={handleWheel}
    />
  ) : (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="grid max-w-md gap-4 rounded-lg border border-slate-800 bg-slate-950/80 p-5 text-sm shadow-xl">
        <div>
          <div className="text-base font-semibold text-slate-100">VNC connection</div>
          <p className="mt-1 text-slate-400">{message}</p>
        </div>
        {needsPassword && (
          <input
            className="session-input"
            type="password"
            autoComplete="current-password"
            placeholder="VNC password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void connect();
              }
            }}
          />
        )}
        <button
          className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          type="button"
          disabled={isConnecting}
          onClick={() => void connect()}
        >
          {isConnecting ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-col bg-background"
      onPointerDownCapture={(event) => {
        if (!showCanvas || isInteractiveTarget(event.target)) {
          return;
        }

        focusCanvas();
      }}
    >
      <header className="flex min-h-11 items-center gap-2 border-b border-slate-800 bg-slate-950 px-3 text-xs text-slate-300">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-semibold text-slate-100">{session.name}</span>
            <span className="hidden shrink-0 rounded border border-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 md:inline">
              {authLabel}
            </span>
          </div>
          <div className="truncate text-[11px] text-slate-500">{endpoint}</div>
        </div>
        <span
          className={[
            'min-w-20 shrink-0 rounded border px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide',
            status === 'frameReady' || status === 'connected'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : status === 'connecting'
                ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                : status === 'failed'
                  ? 'border-destructive/40 bg-destructive/10 text-destructive'
                  : 'border-slate-800 text-slate-400',
          ].join(' ')}
          title={message || status}
        >
          {formatVncStatus(status)}
        </span>
        {desktopSize && (
          <span
            className="hidden shrink-0 rounded border border-slate-800 px-2 py-1 font-mono text-[11px] text-slate-400 sm:inline"
            title="Remote framebuffer size"
          >
            {desktopSize.width}×{desktopSize.height}
          </span>
        )}
        <button
          className="shrink-0 rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-900"
          type="button"
          title={displayMode === 'actual' ? 'Original size' : 'Fit to panel'}
          onClick={() => setDisplayMode(displayMode === 'actual' ? 'fit' : 'actual')}
        >
          {displayMode === 'actual' ? 'Original' : 'Fit'}
        </button>
        <button
          className="shrink-0 rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={isConnecting}
          onClick={() => void connect()}
        >
          Reconnect
        </button>
        <button
          className="shrink-0 rounded border border-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-900"
          type="button"
          onClick={() => void disconnect()}
        >
          Disconnect
        </button>
      </header>

      <main className="min-h-0 flex-1 bg-black p-0">
        <OverlayScrollArea
          ref={viewportRef}
          className={
            displayMode === 'actual'
              ? 'grid place-items-center bg-black p-0'
              : 'grid place-items-center overflow-hidden bg-black p-0'
          }
          containerClassName="h-full min-h-0"
        >
          {content}
        </OverlayScrollArea>
      </main>
    </div>
  );
}

function formatVncStatus(status: VncStatus) {
  if (status === 'frameReady') {
    return 'Ready';
  }

  return status;
}
