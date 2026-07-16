import { useEffect, useState, type MutableRefObject } from 'react';

import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import { loadPreferences, subscribePreferences } from '@/features/settings/appPreferences';
import { closeSftpSession, keepaliveSftpSession } from './sftpBridge';
import type { SftpConnectionState } from './sftpPanelUtils';

export function useSftpKeepalive({
  clearRemoteBrowserState,
  connectionState,
  hasOpenedSessionRef,
  panelId,
  setConnectionState,
  setError,
  setIsLoading,
}: {
  clearRemoteBrowserState: () => void;
  connectionState: SftpConnectionState;
  hasOpenedSessionRef: MutableRefObject<boolean>;
  panelId: string;
  setConnectionState: (state: SftpConnectionState) => void;
  setError: (message: string) => void;
  setIsLoading: (isLoading: boolean) => void;
}) {
  const [sftpKeepaliveIntervalSeconds, setSftpKeepaliveIntervalSeconds] = useState(
    () => loadPreferences().connection.keepaliveIntervalSeconds,
  );

  useEffect(() => {
    return subscribePreferences((preferences) => {
      setSftpKeepaliveIntervalSeconds(preferences.connection.keepaliveIntervalSeconds);
    });
  }, []);

  useEffect(() => {
    if (connectionState !== 'connected') {
      return undefined;
    }

    let inFlight = false;
    let disposed = false;
    const intervalMs = Math.max(15, sftpKeepaliveIntervalSeconds) * 1000;

    const timerId = window.setInterval(() => {
      if (inFlight || disposed) {
        return;
      }

      inFlight = true;
      void keepaliveSftpSession(panelId)
        .catch((error) => {
          if (disposed) {
            return;
          }

          const message = error instanceof Error ? error.message : String(error);

          hasOpenedSessionRef.current = false;
          clearRemoteBrowserState();
          setConnectionState('failed');
          setIsLoading(false);
          setError(`SFTP keepalive failed: ${message}`);
          publishConnectionStatus({ panelId, status: 'failed' });
          void closeSftpSession(panelId);
        })
        .finally(() => {
          inFlight = false;
        });
    }, intervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timerId);
    };
  }, [
    clearRemoteBrowserState,
    connectionState,
    hasOpenedSessionRef,
    panelId,
    setConnectionState,
    setError,
    setIsLoading,
    sftpKeepaliveIntervalSeconds,
  ]);
}
