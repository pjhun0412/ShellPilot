import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import type { SessionItem } from '@/types/workspace';
import {
  closeSftpSession,
  listSftpDirectory,
  openSftpSession,
  type SftpEntry,
} from './sftpBridge';
import {
  isSftpSessionClosedError,
  type SftpConnectionState,
} from './sftpPanelUtils';
import { getErrorMessage, getSftpSessionConnectionKey } from './sftpLifecycleUtils';
import { useSftpAutoConnectLifecycle } from './useSftpAutoConnectLifecycle';
import { useSftpKeepalive } from './useSftpKeepalive';
import { useSftpSidebarLifecycleEvents } from './useSftpSidebarLifecycleEvents';

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
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const isRemoteReady = connectionState === 'connected';
  const sessionConnectionKey = useMemo(
    () => getSftpSessionConnectionKey(session),
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

  const setPublishedConnectionState = useCallback((state: SftpConnectionState) => {
    setConnectionState(state);
    publishConnectionStatus({ panelId, status: state });
  }, [panelId]);

  const markSessionConnected = useCallback(() => {
    hasOpenedSessionRef.current = true;
    setPublishedConnectionState('connected');
  }, [setPublishedConnectionState]);

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
      const message = getErrorMessage(error);

      if (isSftpSessionClosedError(message)) {
        try {
          const generation = lifecycleGenerationRef.current + 1;
          lifecycleGenerationRef.current = generation;

          setPublishedConnectionState('connecting');

          await openQueuedSftpSession();

          if (!isMountedRef.current || lifecycleGenerationRef.current !== generation) {
            await closeSftpSession(panelId);
            return false;
          }

          markSessionConnected();

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
          const reconnectMessage = getErrorMessage(reconnectError);

          if (!isCurrentDirectoryRequest(requestId)) {
            return false;
          }

          setPublishedConnectionState('failed');
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
  }, [
    applyDirectoryResult,
    isCurrentDirectoryRequest,
    markSessionConnected,
    openQueuedSftpSession,
    panelId,
    path,
    setPublishedConnectionState,
  ]);

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

    setPublishedConnectionState('connecting');
    setIsLoading(true);
    setError(undefined);

    try {
      await openQueuedSftpSession();

      if (!isMountedRef.current || lifecycleGenerationRef.current !== generation) {
        await closeSftpSession(panelId);
        return;
      }

      markSessionConnected();
      await loadDirectory(initialRemotePath, { recordHistory: false });
    } catch (error) {
      if (!isMountedRef.current || lifecycleGenerationRef.current !== generation) {
        return;
      }

      setPublishedConnectionState('failed');
      setError(getErrorMessage(error));
      setIsLoading(false);
    }
  }, [
    initialRemotePath,
    loadDirectory,
    markSessionConnected,
    openQueuedSftpSession,
    panelId,
    setPublishedConnectionState,
  ]);

  const runBrowserAction = useCallback(async (action: () => Promise<void>) => {
    setIsLoading(true);
    setError(undefined);

    try {
      await action();
      await loadDirectory();
    } catch (error) {
      setError(getErrorMessage(error));
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

  useSftpKeepalive({
    clearRemoteBrowserState,
    connectionState,
    hasOpenedSessionRef,
    panelId,
    setConnectionState,
    setError,
    setIsLoading,
  });

  const handleSidebarDisconnect = useCallback(() => {
    lifecycleGenerationRef.current += 1;
    hasOpenedSessionRef.current = false;
    clearRemoteBrowserState();
    setPublishedConnectionState('closed');
    setIsLoading(false);
    setError(undefined);
    void closeSftpSession(panelId);
  }, [clearRemoteBrowserState, panelId, setPublishedConnectionState]);

  useSftpSidebarLifecycleEvents({
    connectionState,
    connectSftp,
    loadDirectory,
    onDisconnect: handleSidebarDisconnect,
    panelId,
    sessionConnectionKey,
  });

  useSftpAutoConnectLifecycle({
    autoConnect,
    directoryRequestIdRef,
    hasOpenedSessionRef,
    initialRemotePath,
    isMountedRef,
    lifecycleGenerationRef,
    loadDirectory,
    markSessionConnected,
    openQueuedSftpSession,
    panelId,
    sessionConnectionKey,
    setError,
    setIsLoading,
    setPublishedConnectionState,
  });

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
