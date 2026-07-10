import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import { loadPreferences, subscribePreferences } from '@/features/settings/appPreferences';
import type { SessionItem } from '@/types/workspace';
import {
  closeSftpSession,
  keepaliveSftpSession,
  listSftpDirectory,
  openSftpSession,
  type SftpEntry,
} from './sftpBridge';
import {
  isSftpSessionClosedError,
  type SftpConnectionState,
} from './sftpPanelUtils';
import {
  removeSftpSidebarPanelState,
  subscribeSftpSidebarDisconnect,
  subscribeSftpSidebarNavigation,
  subscribeSftpSidebarReconnect,
} from './sftpSidebarState';

export function useSftpBrowserLifecycle({
  autoConnect,
  onClearBrowserUi,
  panelId,
  resetSelection,
  session,
}: {
  autoConnect: boolean;
  onClearBrowserUi: () => void;
  panelId: string;
  resetSelection: () => void;
  session: SessionItem;
}) {
  const hasOpenedSessionRef = useRef(false);
  const currentPathRef = useRef('.');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [connectionState, setConnectionState] = useState<SftpConnectionState>(
    autoConnect ? 'connecting' : 'restored',
  );
  const [error, setError] = useState<string>();
  const [homePath, setHomePath] = useState('.');
  const [isLoading, setIsLoading] = useState(autoConnect);
  const [path, setPath] = useState('.');
  const [sftpKeepaliveIntervalSeconds, setSftpKeepaliveIntervalSeconds] = useState(
    () => loadPreferences().connection.keepaliveIntervalSeconds,
  );
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const isRemoteReady = connectionState === 'connected';
  const sessionConnectionKey = useMemo(
    () =>
      [
        session.id,
        session.host ?? '',
        session.port ?? 22,
        session.username ?? '',
        session.authMethod ?? '',
        session.credentialRef?.id ?? '',
        session.credentialRef?.kind ?? '',
        typeof session.metadata?.privateKeyPath === 'string' ? session.metadata.privateKeyPath : '',
      ].join('|'),
    [
      session.authMethod,
      session.credentialRef?.id,
      session.credentialRef?.kind,
      session.host,
      session.id,
      session.metadata?.privateKeyPath,
      session.port,
      session.username,
    ],
  );

  const applyDirectoryResult = useCallback((
    result: { entries: SftpEntry[]; path: string },
    requestedPath: string,
  ) => {
    if (requestedPath === '.') {
      setHomePath(result.path);
    }

    setPath(result.path);
    setEntries(result.entries);
    resetSelection();
  }, [resetSelection]);

  const loadDirectory = useCallback(async (
    nextPath = path,
    options: { onError?: (message: string) => void; recordHistory?: boolean } = {},
  ) => {
    const previousPath = path;
    setIsLoading(true);
    setError(undefined);

    try {
      const result = await listSftpDirectory(panelId, nextPath);

      applyDirectoryResult(result, nextPath);

      if ((options.recordHistory ?? true) && result.path !== previousPath) {
        setBackStack((stack) => [...stack, previousPath]);
        setForwardStack([]);
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isSftpSessionClosedError(message)) {
        try {
          setConnectionState('connecting');
          publishConnectionStatus({ panelId, status: 'connecting' });

          if (hasOpenedSessionRef.current) {
            await closeSftpSession(panelId);
            hasOpenedSessionRef.current = false;
          }

          await openSftpSession(panelId, session);
          hasOpenedSessionRef.current = true;
          setConnectionState('connected');
          publishConnectionStatus({ panelId, status: 'connected' });

          const result = await listSftpDirectory(panelId, nextPath);

          applyDirectoryResult(result, nextPath);

          if ((options.recordHistory ?? true) && result.path !== previousPath) {
            setBackStack((stack) => [...stack, previousPath]);
            setForwardStack([]);
          }

          return true;
        } catch (reconnectError) {
          const reconnectMessage =
            reconnectError instanceof Error ? reconnectError.message : String(reconnectError);

          setConnectionState('failed');
          publishConnectionStatus({ panelId, status: 'failed' });
          setError(`SFTP session closed. Reconnect failed: ${reconnectMessage}`);
          options.onError?.(reconnectMessage);
          return false;
        }
      }

      setError(message);
      options.onError?.(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [applyDirectoryResult, panelId, path, session]);

  const clearRemoteBrowserState = useCallback(() => {
    setEntries([]);
    resetSelection();
    setBackStack([]);
    setForwardStack([]);
    onClearBrowserUi();
  }, [onClearBrowserUi, resetSelection]);

  const connectSftp = useCallback(async () => {
    setConnectionState('connecting');
    setIsLoading(true);
    setError(undefined);
    publishConnectionStatus({ panelId, status: 'connecting' });

    try {
      if (hasOpenedSessionRef.current) {
        await closeSftpSession(panelId);
        hasOpenedSessionRef.current = false;
      }

      await openSftpSession(panelId, session);
      hasOpenedSessionRef.current = true;
      setConnectionState('connected');
      publishConnectionStatus({ panelId, status: 'connected' });
      await loadDirectory('.', { recordHistory: false });
    } catch (error) {
      setConnectionState('failed');
      publishConnectionStatus({ panelId, status: 'failed' });
      setError(error instanceof Error ? error.message : String(error));
      setIsLoading(false);
    }
  }, [loadDirectory, panelId, session]);

  const runBrowserAction = useCallback(async (action: () => Promise<void>) => {
    setIsLoading(true);
    setError(undefined);

    try {
      await action();
      await loadDirectory();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      setIsLoading(false);
    }
  }, [loadDirectory]);

  const goBack = useCallback(async () => {
    const previousPath = backStack[backStack.length - 1];

    if (!previousPath) {
      return;
    }

    const currentPath = path;
    const didLoad = await loadDirectory(previousPath, { recordHistory: false });

    if (didLoad) {
      setBackStack((stack) => stack.slice(0, -1));
      setForwardStack((stack) => [currentPath, ...stack]);
    }
  }, [backStack, loadDirectory, path]);

  const goForward = useCallback(async () => {
    const nextPath = forwardStack[0];

    if (!nextPath) {
      return;
    }

    const currentPath = path;
    const didLoad = await loadDirectory(nextPath, { recordHistory: false });

    if (didLoad) {
      setForwardStack((stack) => stack.slice(1));
      setBackStack((stack) => [...stack, currentPath]);
    }
  }, [forwardStack, loadDirectory, path]);

  const refreshCurrentDirectory = useCallback(() => {
    void loadDirectory(currentPathRef.current, { recordHistory: false });
  }, [loadDirectory]);

  useEffect(() => {
    currentPathRef.current = path;
  }, [path]);

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
  }, [clearRemoteBrowserState, connectionState, panelId, sftpKeepaliveIntervalSeconds]);

  useEffect(() => {
    return subscribeSftpSidebarNavigation(({ panelId: targetPanelId, path: targetPath }) => {
      if (targetPanelId !== panelId) {
        return;
      }

      void loadDirectory(targetPath);
    });
  }, [loadDirectory, panelId]);

  useEffect(() => {
    return subscribeSftpSidebarReconnect(({ panelId: targetPanelId }) => {
      if (targetPanelId !== panelId) {
        return false;
      }

      if (connectionState === 'connecting') {
        return true;
      }

      void connectSftp();
      return true;
    });
  }, [connectSftp, connectionState, panelId, sessionConnectionKey]);

  useEffect(() => {
    return subscribeSftpSidebarDisconnect(({ panelId: targetPanelId }) => {
      if (targetPanelId !== panelId) {
        return;
      }

      hasOpenedSessionRef.current = false;
      clearRemoteBrowserState();
      setConnectionState('closed');
      setIsLoading(false);
      setError(undefined);
      publishConnectionStatus({ panelId, status: 'closed' });
      void closeSftpSession(panelId);
    });
  }, [clearRemoteBrowserState, panelId]);

  useEffect(() => {
    let disposed = false;

    const open = async () => {
      if (!autoConnect) {
        setConnectionState('restored');
        setIsLoading(false);
        setError(undefined);
        publishConnectionStatus({ panelId, status: 'restored' });
        return;
      }

      setIsLoading(true);
      setError(undefined);
      setConnectionState('connecting');
      publishConnectionStatus({ panelId, status: 'connecting' });

      try {
        if (hasOpenedSessionRef.current) {
          await closeSftpSession(panelId);
          hasOpenedSessionRef.current = false;
        }

        await openSftpSession(panelId, session);
        hasOpenedSessionRef.current = true;
        setConnectionState('connected');
        publishConnectionStatus({ panelId, status: 'connected' });
        if (!disposed) {
          await loadDirectory('.', { recordHistory: false });
        }
      } catch (error) {
        setConnectionState('failed');
        publishConnectionStatus({ panelId, status: 'failed' });
        if (!disposed) {
          setError(error instanceof Error ? error.message : String(error));
          setIsLoading(false);
        }
      }
    };

    void open();

    return () => {
      disposed = true;
      publishConnectionStatus({ panelId, status: 'closed' });
      removeSftpSidebarPanelState(panelId);
      if (hasOpenedSessionRef.current) {
        hasOpenedSessionRef.current = false;
        void closeSftpSession(panelId);
      }
    };
  }, [autoConnect, panelId, sessionConnectionKey]);

  return {
    backStack,
    connectSftp,
    connectionState,
    entries,
    error,
    forwardStack,
    goBack,
    goForward,
    homePath,
    isLoading,
    isRemoteReady,
    loadDirectory,
    path,
    refreshCurrentDirectory,
    runBrowserAction,
    setError,
  };
}
