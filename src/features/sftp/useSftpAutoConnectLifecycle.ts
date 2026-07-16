import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import { closeSftpSession } from './sftpBridge';
import { getErrorMessage } from './sftpLifecycleUtils';
import type { SftpConnectionState } from './sftpPanelUtils';
import { removeSftpSidebarPanelState } from './sftpSidebarState';

export function useSftpAutoConnectLifecycle({
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
}: {
  autoConnect: boolean;
  directoryRequestIdRef: MutableRefObject<number>;
  hasOpenedSessionRef: MutableRefObject<boolean>;
  initialRemotePath: string;
  isMountedRef: MutableRefObject<boolean>;
  lifecycleGenerationRef: MutableRefObject<number>;
  loadDirectory: (nextPath?: string, options?: { onError?: (message: string) => void; recordHistory?: boolean }) => Promise<boolean>;
  markSessionConnected: () => void;
  openQueuedSftpSession: () => Promise<void>;
  panelId: string;
  sessionConnectionKey: string;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setPublishedConnectionState: (state: SftpConnectionState) => void;
}) {
  useEffect(() => {
    let disposed = false;
    const generation = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = generation;

    const open = async () => {
      if (!autoConnect) {
        if (disposed || lifecycleGenerationRef.current !== generation) {
          return;
        }

        setPublishedConnectionState('restored');
        setIsLoading(false);
        setError(undefined);
        return;
      }

      setIsLoading(true);
      setError(undefined);
      setPublishedConnectionState('connecting');

      try {
        await openQueuedSftpSession();

        if (disposed || !isMountedRef.current || lifecycleGenerationRef.current !== generation) {
          await closeSftpSession(panelId);
          return;
        }

        markSessionConnected();
        if (!disposed) {
          await loadDirectory(initialRemotePath, { recordHistory: false });
        }
      } catch (error) {
        if (disposed || !isMountedRef.current || lifecycleGenerationRef.current !== generation) {
          return;
        }

        setPublishedConnectionState('failed');
        if (!disposed) {
          setError(getErrorMessage(error));
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
  }, [
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
  ]);
}
