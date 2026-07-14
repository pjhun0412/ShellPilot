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
  initialPath,
  onClearBrowserUi,
  panelId,
  resetSelection,
  session,
}: {
  autoConnect: boolean;
  initialPath?: string;
  onClearBrowserUi: () => void;
  panelId: string;
  resetSelection: () => void;
  session: SessionItem;
}) {
  const initialRemotePath = initialPath?.trim() || '.';
  const directoryRequestIdRef = useRef(0);
  const hasOpenedSessionRef = useRef(false);
  const isMountedRef = useRef(true);
  const lifecycleGenerationRef = useRef(0);
  const openQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionRef = useRef(session);
  const currentPathRef = useRef(initialRemotePath);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [connectionState, setConnectionState] = useState<SftpConnectionState>(
    autoConnect ? 'connecting' : 'restored',
  );
  const [error, setError] = useState<string>();
  const [homePath, setHomePath] = useState('.');
  const [isLoading, setIsLoading] = useState(autoConnect);
  const [path, setPath] = useState(initialRemotePath);
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

  const isCurrentDirectoryRequest = useCallback((requestId: number) =>
    isMountedRef.current && directoryRequestIdRef.current === requestId,
  []);

  const openQueuedSftpSession = useCallback(async () => {
    const previousOpen = openQueueRef.current.catch(() => undefined);
    const nextOpen = previousOpen.then(() => openSftpSession(panelId, sessionRef.current));

    openQueueRef.current = nextOpen.catch(() => undefined);
    await nextOpen;
  }, [panelId]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      directoryRequestIdRef.current += 1;
      lifecycleGenerationRef.current += 1;
    };
  }, []);

  const loadDirectory = useCallback(async (
    nextPath = path,
    options: { onError?: (message: string) => void; recordHistory?: boolean } = {},
  ) => {
    const requestId = directoryRequestIdRef.current + 1;
    directoryRequestIdRef.current = requestId;
    const previousPath = path;
    setIsLoading(true);
    setError(undefined);

    try {
      const result = await listSftpDirectory(panelId, nextPath);

      if (!isCurrentDirectoryRequest(requestId)) {
        return false;
      }

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
          const generation = lifecycleGenerationRef.current + 1;
          lifecycleGenerationRef.current = generation;

          setConnectionState('connecting');
          publishConnectionStatus({ panelId, status: 'connecting' });

          await openQueuedSftpSession();

          if (!isMountedRef.current || lifecycleGenerationRef.current !== generation) {
            await closeSftpSession(panelId);
            return false;
          }

          hasOpenedSessionRef.current = true;
          setConnectionState('connected');
          publishConnectionStatus({ panelId, status: 'connected' });

          const result = await listSftpDirectory(panelId, nextPath);

          if (!isCurrentDirectoryRequest(requestId) || lifecycleGenerationRef.current !== generation) {
            return false;
          }

          applyDirectoryResult(result, nextPath);

          if ((options.recordHistory ?? true) && result.path !== previousPath) {
            setBackStack((stack) => [...stack, previousPath]);
            setForwardStack([]);
          }

          return true;
        } catch (reconnectError) {
          const reconnectMessage =
            reconnectError instanceof Error ? reconnectError.message : String(reconnectError);

          if (!isCurrentDirectoryRequest(requestId)) {
            return false;
          }

          setConnectionState('failed');
          publishConnectionStatus({ panelId, status: 'failed' });
          setError(`SFTP session closed. Reconnect failed: ${reconnectMessage}`);
          options.onError?.(reconnectMessage);
          return false;
        }
      }

      if (!isCurrentDirectoryRequest(requestId)) {
        return false;
      }

      setError(message);
      options.onError?.(message);
      return false;
    } finally {
      if (isCurrentDirectoryRequest(requestId)) {
        setIsLoading(false);
      }
    }
  }, [applyDirectoryResult, isCurrentDirectoryRequest, openQueuedSftpSession, panelId, path]);

  const clearRemoteBrowserState = useCallback(() => {
    setEntries([]);
    resetSelection();
    setBackStack([]);
    setForwardStack([]);
    onClearBrowserUi();
  }, [onClearBrowserUi, resetSelection]);

  const connectSftp = useCallback(async () => {
    const generation = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = generation;

    setConnectionState('connecting');
    setIsLoading(true);
    setError(undefined);
    publishConnectionStatus({ panelId, status: 'connecting' });

    try {
      await openQueuedSftpSession();

      if (!isMountedRef.current || lifecycleGenerationRef.current !== generation) {
        await closeSftpSession(panelId);
        return;
      }

      hasOpenedSessionRef.current = true;
      setConnectionState('connected');
      publishConnectionStatus({ panelId, status: 'connected' });
      await loadDirectory(initialRemotePath, { recordHistory: false });
    } catch (error) {
      if (!isMountedRef.current || lifecycleGenerationRef.current !== generation) {
        return;
      }

      setConnectionState('failed');
      publishConnectionStatus({ panelId, status: 'failed' });
      setError(error instanceof Error ? error.message : String(error));
      setIsLoading(false);
    }
  }, [initialRemotePath, loadDirectory, openQueuedSftpSession, panelId]);

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
    sessionRef.current = session;
  }, [session]);

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

      lifecycleGenerationRef.current += 1;
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
    const generation = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = generation;

    const open = async () => {
      if (!autoConnect) {
        if (disposed || lifecycleGenerationRef.current !== generation) {
          return;
        }

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
        await openQueuedSftpSession();

        if (disposed || !isMountedRef.current || lifecycleGenerationRef.current !== generation) {
          await closeSftpSession(panelId);
          return;
        }

        hasOpenedSessionRef.current = true;
        setConnectionState('connected');
        publishConnectionStatus({ panelId, status: 'connected' });
        if (!disposed) {
          await loadDirectory(initialRemotePath, { recordHistory: false });
        }
      } catch (error) {
        if (disposed || !isMountedRef.current || lifecycleGenerationRef.current !== generation) {
          return;
        }

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
      directoryRequestIdRef.current += 1;
      lifecycleGenerationRef.current += 1;
      publishConnectionStatus({ panelId, status: 'closed' });
      removeSftpSidebarPanelState(panelId);
      if (hasOpenedSessionRef.current) {
        hasOpenedSessionRef.current = false;
        void closeSftpSession(panelId);
      }
    };
  }, [autoConnect, initialRemotePath, openQueuedSftpSession, panelId, sessionConnectionKey]);

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
