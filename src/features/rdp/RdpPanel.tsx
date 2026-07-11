import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import type { SessionItem } from '@/types/workspace';
import { RdpDisconnectedState } from './RdpDisconnectedState';
import { RdpPanelHeader } from './RdpPanelHeader';
import {
  closeRdpSession,
  forgetRdpCertificate,
  listenRdpClipboardText,
  listenRdpCursor,
  listenRdpEvents,
  listenRdpFrames,
  openRdpSession,
  sendRdpInput,
  setLocalClipboardText,
  type RdpCursorEvent,
  type RdpEvent,
  type RdpStatus,
} from './rdpBridge';
import {
  getLocalScreenResolution,
  type RdpDisplayMode,
  type RdpImageQuality,
  type RdpResolutionOption,
} from './rdpDisplayOptions';
import {
  isInteractiveTarget,
  mapRdpStatusToConnectionStatus,
  normalizeRdpOpenError,
} from './rdpUiUtils';
import { subscribeRdpDisconnect, subscribeRdpReconnect } from './rdpPanelLifecycle';
import { useRdpFrameRenderer } from './useRdpFrameRenderer';
import { useRdpInputHandlers } from './useRdpInputHandlers';
import { useRdpViewportSize } from './useRdpViewportSize';

interface RdpPanelProps {
  autoConnect?: boolean;
  isActive?: boolean;
  panelId: string;
  session: SessionItem;
}

export function RdpPanel({ autoConnect = true, isActive = false, panelId, session }: RdpPanelProps) {
  const [status, setStatus] = useState<RdpStatus>('closed');
  const [message, setMessage] = useState('RDP session is not connected.');
  const [errorCode, setErrorCode] = useState<string>();
  const [desktopSize, setDesktopSize] = useState<{ height: number; width: number }>();
  const [certificateFingerprint, setCertificateFingerprint] = useState<string>();
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [displayMode, setDisplayMode] = useState<RdpDisplayMode>('actual');
  const [imageQuality, setImageQuality] = useState<RdpImageQuality>('balanced');
  const [resolution, setResolution] = useState<RdpResolutionOption>(() => getLocalScreenResolution());
  const [isDisplayMenuOpen, setIsDisplayMenuOpen] = useState(false);
  const [cursorStyle, setCursorStyle] = useState('default');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayMenuRef = useRef<HTMLDivElement>(null);
  const { drawFrame, flushQueuedFrames, networkStats, resetFrames } = useRdpFrameRenderer(canvasRef);
  const { viewportRef, viewportSize } = useRdpViewportSize<HTMLDivElement>();

  const endpoint = useMemo(() => {
    const port = session.port ?? 3389;

    return `${session.host ?? 'unknown'}:${port}`;
  }, [session.host, session.port]);

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
      cursor: cursorStyle,
      imageRendering: imageQuality === 'speed' ? 'pixelated' : 'auto',
    };
  }, [canvasDisplaySize, cursorStyle, imageQuality]);
  const {
    focusCanvas,
    handleMouseButton,
    handleMouseMove,
    handleWheel,
    sendRemoteWindowsMenu,
  } = useRdpInputHandlers({
    canvasRef,
    desktopSize,
    isActive,
    panelId,
    setMessage,
    showCanvas,
  });

  const applyEvent = useCallback(
    (event: RdpEvent) => {
      setStatus(event.status);
      publishConnectionStatus({ panelId, status: mapRdpStatusToConnectionStatus(event.status) });
      setErrorCode(event.code);
      setIsConnecting(event.status === 'connecting');

      if (event.message) {
        setMessage(event.message);
      }

      if (event.desktopWidth && event.desktopHeight) {
        setDesktopSize({ height: event.desktopHeight, width: event.desktopWidth });
      }

      if (event.certificateFingerprint) {
        setCertificateFingerprint(event.certificateFingerprint);
      }
    },
    [panelId],
  );

  useEffect(() => {
    let unlistenEvents: (() => void) | undefined;
    let unlistenFrames: (() => void) | undefined;
    let unlistenCursor: (() => void) | undefined;
    let unlistenClipboard: (() => void) | undefined;
    let disposed = false;

    listenRdpEvents((event) => {
      if (event.panelId !== panelId) {
        return;
      }

      applyEvent(event);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }

      unlistenEvents = unlisten;
    });

    listenRdpFrames((frame) => {
      if (frame.panelId !== panelId) {
        return;
      }

      drawFrame(frame);
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }

      unlistenFrames = unlisten;
    });

    listenRdpCursor((event) => {
      if (event.panelId !== panelId) {
        return;
      }

      setCursorStyle(createRdpCursorStyle(event));
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }

      unlistenCursor = unlisten;
    });

    listenRdpClipboardText((event) => {
      if (event.panelId !== panelId) {
        return;
      }

      void setLocalClipboardText(event.text).catch(() => {
        void navigator.clipboard?.writeText(event.text).catch(() => undefined);
      });
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }

      unlistenClipboard = unlisten;
    });

    return () => {
      disposed = true;
      unlistenEvents?.();
      unlistenFrames?.();
      unlistenCursor?.();
      unlistenClipboard?.();
      publishConnectionStatus({ panelId, status: 'closed' });
      void closeRdpSession(panelId);
    };
  }, [applyEvent, drawFrame, panelId]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !desktopSize || !showCanvas) {
      return;
    }

    canvas.width = desktopSize.width;
    canvas.height = desktopSize.height;
    flushQueuedFrames();
  }, [desktopSize, flushQueuedFrames, showCanvas]);

  useEffect(() => {
    if (!isDisplayMenuOpen) {
      return;
    }

    const closeMenu = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;

      if (target && displayMenuRef.current?.contains(target)) {
        return;
      }

      setIsDisplayMenuOpen(false);
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDisplayMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeMenuOnEscape);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [isDisplayMenuOpen]);

  useEffect(() => {
    if (!autoConnect) {
      return;
    }

    void connect();
    // We only want initial panel mount auto-connect here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, panelId]);

  const connect = async (
    options: {
      acceptNewCertificate?: boolean;
      resolutionOverride?: RdpResolutionOption;
    } = {},
  ) => {
    const nextResolution = options.resolutionOverride ?? resolution;

    setNeedsPassword(false);
    setIsConnecting(true);
    setStatus('connecting');
    publishConnectionStatus({ panelId, status: 'connecting' });
    setMessage(`Connecting to ${endpoint}...`);
    setErrorCode(undefined);
    setCursorStyle('default');
    if (!options.acceptNewCertificate) {
      setCertificateFingerprint(undefined);
    }
    resetFrames();

    try {
      await openRdpSession(panelId, session, {
        acceptNewCertificate: options.acceptNewCertificate,
        desktopHeight: nextResolution.height,
        desktopWidth: nextResolution.width,
        ...(password ? { password } : {}),
      });
    } catch (error) {
      const normalized = normalizeRdpOpenError(error);
      setIsConnecting(false);
      setStatus('failed');
      publishConnectionStatus({ panelId, status: 'failed' });
      setMessage(normalized.message);
      setNeedsPassword(normalized.authPrompt);
    }
  };

  const disconnect = async () => {
    await closeRdpSession(panelId);
    setStatus('closed');
    publishConnectionStatus({ panelId, status: 'closed' });
    setMessage('RDP session closed.');
    setIsConnecting(false);
    setCursorStyle('default');
  };

  const connectRequestRef = useRef(connect);
  const disconnectRequestRef = useRef(disconnect);

  useEffect(() => {
    connectRequestRef.current = connect;
    disconnectRequestRef.current = disconnect;
  });

  useEffect(() => {
    const unsubscribeDisconnect = subscribeRdpDisconnect((requestedPanelId) => {
      if (requestedPanelId !== panelId) {
        return false;
      }

      void disconnectRequestRef.current();
      return true;
    });
    const unsubscribeReconnect = subscribeRdpReconnect((requestedPanelId) => {
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

  const trustCertificateAndConnect = () => {
    void connect({ acceptNewCertificate: true });
  };

  const changeResolution = async (nextResolution: RdpResolutionOption) => {
    setResolution(nextResolution);
    setIsDisplayMenuOpen(false);

    if (!showCanvas && status !== 'connected' && status !== 'frameReady') {
      return;
    }

    try {
      await sendRdpInput(panelId, {
        type: 'resize',
        width: nextResolution.width,
        height: nextResolution.height,
      });
      setMessage(`Requested remote display resize to ${nextResolution.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to request RDP display resize.');
    }
  };

  const forgetCertificateAndReconnect = async () => {
    setIsConnecting(true);

    try {
      await forgetRdpCertificate(session);
      await connect();
    } catch (error) {
      const normalized = normalizeRdpOpenError(error);
      setIsConnecting(false);
      setStatus('failed');
      publishConnectionStatus({ panelId, status: 'failed' });
      setMessage(normalized.message);
    }
  };

  const content = showCanvas ? (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      className="block outline-none"
      style={canvasStyle}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseButton(true)}
      onMouseUp={handleMouseButton(false)}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={handleWheel}
    />
  ) : (
    <RdpDisconnectedState
      certificateFingerprint={certificateFingerprint}
      errorCode={errorCode}
      isConnecting={isConnecting}
      message={message}
      needsPassword={needsPassword}
      password={password}
      onForgetCertificate={() => void forgetCertificateAndReconnect()}
      onPasswordChange={setPassword}
      onPasswordSubmit={() => void connect()}
      onTrustCertificate={trustCertificateAndConnect}
    />
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      onPointerDownCapture={(event) => {
        if (!showCanvas || isInteractiveTarget(event.target)) {
          return;
        }

        focusCanvas();
      }}
    >
      <RdpPanelHeader
        certificateFingerprint={certificateFingerprint}
        desktopSize={desktopSize}
        displayMenuRef={displayMenuRef}
        displayMode={displayMode}
        imageQuality={imageQuality}
        endpoint={endpoint}
        isDisplayMenuOpen={isDisplayMenuOpen}
        isConnecting={isConnecting}
        networkStats={networkStats}
        panelWidth={viewportSize?.width}
        resolution={resolution}
        session={session}
        showCanvas={showCanvas}
        status={status}
        onConnect={() => void connect()}
        onDisconnect={() => void disconnect()}
        onDisplayMenuToggle={() => setIsDisplayMenuOpen((value) => !value)}
        onDisplayModeChange={(mode) => {
          setDisplayMode(mode);
          setIsDisplayMenuOpen(false);
        }}
        onImageQualityChange={(quality) => {
          setImageQuality(quality);
          setIsDisplayMenuOpen(false);
        }}
        onResolutionChange={changeResolution}
        onSendWindowsMenu={() => void sendRemoteWindowsMenu()}
      />

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

function createRdpCursorStyle(event: RdpCursorEvent) {
  if (event.kind === 'hidden') {
    return 'none';
  }

  if (event.kind === 'default') {
    return 'default';
  }

  if (!event.data || !event.width || !event.height) {
    return 'default';
  }

  try {
    const binary = atob(event.data);
    const bytes = new Uint8ClampedArray(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    const cursorCanvas = document.createElement('canvas');
    cursorCanvas.width = event.width;
    cursorCanvas.height = event.height;
    cursorCanvas.getContext('2d')?.putImageData(new ImageData(bytes, event.width, event.height), 0, 0);

    const hotspotX = Math.min(Math.max(event.hotspotX ?? 0, 0), event.width - 1);
    const hotspotY = Math.min(Math.max(event.hotspotY ?? 0, 0), event.height - 1);

    return `url("${cursorCanvas.toDataURL('image/png')}") ${hotspotX} ${hotspotY}, auto`;
  } catch {
    return 'default';
  }
}
