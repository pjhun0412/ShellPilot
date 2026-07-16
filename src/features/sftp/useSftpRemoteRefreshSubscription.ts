import { useEffect, useMemo } from 'react';

import type { SessionItem } from '@/types/workspace';
import { subscribeSftpRemoteRefreshRequest } from './sftpRemoteRefresh';

export function useSftpRemoteRefreshSubscription({
  isRemoteReady,
  loadDirectory,
  session,
}: {
  isRemoteReady: boolean;
  loadDirectory: () => Promise<boolean>;
  session: SessionItem;
}) {
  const remoteIdentity = useMemo(() => createSftpRemoteIdentity(session), [session]);

  useEffect(() => {
    return subscribeSftpRemoteRefreshRequest(({ remoteIdentity: targetRemoteIdentity }) => {
      if (targetRemoteIdentity === remoteIdentity && isRemoteReady) {
        void loadDirectory();
      }
    });
  }, [isRemoteReady, loadDirectory, remoteIdentity]);

  return remoteIdentity;
}

function createSftpRemoteIdentity(session: SessionItem) {
  const host = (session.host ?? '').trim().toLowerCase();
  const username = (session.username ?? '').trim().toLowerCase();
  const port = session.port ?? 22;

  if (host) {
    return `endpoint:${username}@${host}:${port}`;
  }

  return `session:${session.id}`;
}
