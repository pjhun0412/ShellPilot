import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Clipboard, Copy, Eraser, FolderOpen, PlugZap, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import type { SessionItem } from '@/types/workspace';
import { pasteClipboardToSsh } from './sshTerminalBridge';
import { SshClosedCard, SshFailureCard, SshRestoredCard } from './SshTerminalStatusCards';
import {
  getSshEndpointLabel,
  getSshSecretLabel,
} from './sshTerminalUi';
import { useSshTerminalStatus } from './useSshTerminalStatus';
import {
  type SshCloseIntent,
  type SshHostKeyWarning,
} from './sshTerminalEventHandler';
import { copyTerminalSelection } from './sshTerminalInput';
import { useSshTerminalActions } from './useSshTerminalActions';
import { useSshTerminalLifecycle } from './useSshTerminalLifecycle';

export function SshTerminal({
  autoConnect = true,
  isActive = false,
  onOpenSftp,
  panelId,
  session,
}: {
  autoConnect?: boolean;
  isActive?: boolean;
  onOpenSftp?: (session: SessionItem) => void;
  panelId: string;
  session: SessionItem;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon>();
  const pendingPasswordRef = useRef<string>();
  const pendingUsernameRef = useRef<string>();
  const lastHostKeyWarningRef = useRef<SshHostKeyWarning>();
  const closeIntentRef = useRef<SshCloseIntent>();
  const shouldRememberPasswordRef = useRef(true);
  const shouldRememberUsernameRef = useRef(true);
  const terminalRef = useRef<Terminal>();
  const [manualPassword, setManualPassword] = useState('');
  const [manualUsername, setManualUsername] = useState('');
  const [shouldRememberPassword, setShouldRememberPassword] = useState(true);
  const [shouldRememberUsername, setShouldRememberUsername] = useState(true);
  const {
    failure,
    publishClosedStatus,
    setTerminalStatus,
    status,
  } = useSshTerminalStatus(panelId, autoConnect ? 'connecting' : 'restored');
  const endpointLabel = getSshEndpointLabel(session);
  const secretLabel = getSshSecretLabel(session);
  const {
    closeSession,
    connectWithPassword,
    reconnectSession,
    resetKnownHostAndReconnect,
    trustHostKeyAndReconnect,
  } = useSshTerminalActions({
    closeIntentRef,
    endpointLabel,
    failure,
    lastHostKeyWarningRef,
    manualPassword,
    manualUsername,
    panelId,
    pendingPasswordRef,
    pendingUsernameRef,
    secretLabel,
    session,
    setManualPassword,
    setManualUsername,
    setTerminalStatus,
    terminalRef,
  });

  useSshTerminalLifecycle({
    autoConnect,
    closeIntentRef,
    containerRef,
    endpointLabel,
    fitAddonRef,
    lastHostKeyWarningRef,
    panelId,
    pendingPasswordRef,
    pendingUsernameRef,
    publishClosedStatus,
    session,
    setTerminalStatus,
    shouldRememberPasswordRef,
    shouldRememberUsernameRef,
    terminalRef,
  });

  useEffect(() => {
    if (!isActive) {
      return;
    }

    window.requestAnimationFrame(() => {
      terminalRef.current?.focus();
    });
  }, [isActive]);

  const copySelection = () => {
    copyTerminalSelection(terminalRef.current);
  };

  const clearTerminal = () => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="shellpilot-terminal relative h-full min-h-0 overflow-hidden bg-[hsl(var(--workspace-terminal))] px-3 pt-3 pb-0"
          onAuxClick={(event) => {
            if (event.button !== 1) {
              return;
            }

            event.preventDefault();
            void pasteClipboardToSsh(panelId);
          }}
        >
          <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />
          {onOpenSftp && (
            <Button
              className="absolute right-3 top-3 h-7 px-2 text-[11px] opacity-80 shadow-lg hover:opacity-100"
              size="sm"
              title="Open SFTP"
              type="button"
              variant="secondary"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onOpenSftp(session);
              }}
            >
              <FolderOpen className="size-3.5" />
              SFTP
            </Button>
          )}
          {status === 'restored' && (
            <SshRestoredCard onReconnect={() => void reconnectSession()} />
          )}
          {status === 'closed' && (
            <SshClosedCard onReconnect={() => void reconnectSession()} />
          )}
          {status === 'failed' && failure && (
            <SshFailureCard
              failure={failure}
              manualPassword={manualPassword}
              manualUsername={manualUsername}
              secretLabel={secretLabel}
              session={session}
              shouldRememberPassword={shouldRememberPassword}
              shouldRememberUsername={shouldRememberUsername}
              onManualPasswordChange={setManualPassword}
              onManualUsernameChange={setManualUsername}
              onReconnect={() => void reconnectSession()}
              onResetKnownHost={() => void resetKnownHostAndReconnect()}
              onSubmit={connectWithPassword}
              onToggleRememberPassword={(value) => {
                shouldRememberPasswordRef.current = value;
                setShouldRememberPassword(value);
              }}
              onToggleRememberUsername={(value) => {
                shouldRememberUsernameRef.current = value;
                setShouldRememberUsername(value);
              }}
              onTrustHostKey={() => void trustHostKeyAndReconnect()}
            />
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={copySelection}>
          <Copy className="size-3.5" />
          Copy
          <ContextMenuShortcut>select</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void pasteClipboardToSsh(panelId)}>
          <Clipboard className="size-3.5" />
          Paste
          <ContextMenuShortcut>middle</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={clearTerminal}>
          <Eraser className="size-3.5" />
          Clear
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!onOpenSftp} onSelect={() => onOpenSftp?.(session)}>
          <FolderOpen className="size-3.5" />
          Open SFTP
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void reconnectSession()}>
          <RotateCcw className="size-3.5" />
          Reconnect
        </ContextMenuItem>
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => void closeSession()}>
          <PlugZap className="size-3.5" />
          Disconnect
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
