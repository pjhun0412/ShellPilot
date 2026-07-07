import { useCallback, useState } from 'react';

import {
  publishConnectionStatus,
  type ConnectionStatus,
} from '@/features/connections/connectionStatus';
import type { SshTerminalFailure } from './sshTerminalUi';

export type SshTerminalUiStatus = Exclude<ConnectionStatus, 'idle'>;

export function useSshTerminalStatus(panelId: string, initialStatus: SshTerminalUiStatus) {
  const [failure, setFailure] = useState<SshTerminalFailure>();
  const [status, setStatus] = useState<SshTerminalUiStatus>(initialStatus);

  const publishStatus = useCallback(
    (nextStatus: ConnectionStatus) => {
      publishConnectionStatus({ panelId, status: nextStatus });
    },
    [panelId],
  );

  const setTerminalStatus = useCallback(
    (nextStatus: SshTerminalUiStatus, nextFailure?: SshTerminalFailure) => {
      setStatus(nextStatus);
      setFailure(nextFailure);
      publishStatus(nextStatus);
    },
    [publishStatus],
  );

  const publishIdleStatus = useCallback(() => {
    publishStatus('idle');
  }, [publishStatus]);

  return {
    failure,
    publishIdleStatus,
    setFailure,
    setTerminalStatus,
    status,
  };
}
