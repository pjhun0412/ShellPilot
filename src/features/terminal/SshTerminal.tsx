import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Clipboard, Copy, Eraser, FolderOpen, PlugZap, RotateCcw, ScrollText, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { patchStoredSession } from '@/features/sessions/sessionStorage';
import {
  createSshCommandInDirectory,
  createSshCommandSnippet,
  createSshFavoritePath,
  notifySshSessionMetadataChanged,
  normalizeSshCommand,
  normalizeSshPath,
  readSshSessionMetadata,
  subscribeSshSessionMetadataChanged,
  writeSshSessionMetadata,
  type SshSessionMetadata,
} from '@/features/ssh/sshSessionTools';
import type { OpenSftpHandler, SessionItem } from '@/types/workspace';
import { pasteClipboardToSsh, querySshCurrentDirectory } from './sshTerminalBridge';
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
import { useActiveTerminalFocus } from './useActiveTerminalFocus';
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
  onOpenSftp?: OpenSftpHandler;
  panelId: string;
  session: SessionItem;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon>();
  const pendingPasswordRef = useRef<string>();
  const pendingUsernameRef = useRef<string>();
  const lastHostKeyWarningRef = useRef<SshHostKeyWarning>();
  const closeIntentRef = useRef<SshCloseIntent>();
  const failedAttemptRef = useRef(false);
  const shouldRememberPasswordRef = useRef(true);
  const shouldRememberUsernameRef = useRef(true);
  const terminalRef = useRef<Terminal>();
  const sshMetadataRef = useRef<SshSessionMetadata>(readSshSessionMetadata(session));
  const [manualPassword, setManualPassword] = useState('');
  const [manualUsername, setManualUsername] = useState('');
  const [contextSelection, setContextSelection] = useState('');
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
    failedAttemptRef,
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
    failedAttemptRef,
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

  useActiveTerminalFocus({ focusKey: status, isActive, terminalRef });

  useEffect(() => {
    sshMetadataRef.current = readSshSessionMetadata(session);
  }, [session.id, session.metadata]);

  useEffect(
    () =>
      subscribeSshSessionMetadataChanged(({ metadata, sessionId }) => {
        if (sessionId === session.id) {
          sshMetadataRef.current = metadata;
        }
      }),
    [session.id],
  );

  const copySelection = () => {
    copyTerminalSelection(terminalRef.current);
  };

  const clearTerminal = () => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  };

  const refreshContextSelection = () => {
    setContextSelection(normalizeSshCommand(terminalRef.current?.getSelection() ?? ''));
  };

  const saveCurrentPath = async () => {
    const path = normalizeSshPath((await querySshCurrentDirectory(panelId)) ?? '');

    if (!path) {
      return;
    }

    const metadata = sshMetadataRef.current;

    if (metadata.favoritePaths.some((item) => item.path === path)) {
      return;
    }

    const nextMetadata: SshSessionMetadata = {
      commandSnippets: metadata.commandSnippets,
      favoritePaths: [
        ...metadata.favoritePaths,
        createSshFavoritePath(path),
      ],
    };

    const didSave = await patchStoredSession({
      notifyWorkspace: false,
      sessionId: session.id,
      patch: {
        metadata: writeSshSessionMetadata(session, nextMetadata),
      },
    });

    if (didSave) {
      sshMetadataRef.current = nextMetadata;
      notifySshSessionMetadataChanged({ metadata: nextMetadata, sessionId: session.id });
    }
  };

  const saveSelectedCommand = async ({ withCurrentPath = false }: { withCurrentPath?: boolean } = {}) => {
    const selectedCommand = normalizeSshCommand(contextSelection);

    if (!selectedCommand) {
      return;
    }

    const currentPath = withCurrentPath
      ? normalizeSshPath((await querySshCurrentDirectory(panelId)) ?? '')
      : '';

    if (withCurrentPath && !currentPath) {
      return;
    }

    const command = withCurrentPath
      ? createSshCommandInDirectory(currentPath, selectedCommand)
      : selectedCommand;
    const metadata = sshMetadataRef.current;

    if (metadata.commandSnippets.some((item) => item.command === command)) {
      return;
    }

    const nextMetadata: SshSessionMetadata = {
      commandSnippets: [
        ...metadata.commandSnippets,
        createSshCommandSnippet(command, undefined, {
          basePath: currentPath,
          displayCommand: withCurrentPath ? selectedCommand : undefined,
        }),
      ],
      favoritePaths: metadata.favoritePaths,
    };

    const didSave = await patchStoredSession({
      notifyWorkspace: false,
      sessionId: session.id,
      patch: {
        metadata: writeSshSessionMetadata(session, nextMetadata),
      },
    });

    if (didSave) {
      sshMetadataRef.current = nextMetadata;
      notifySshSessionMetadataChanged({ metadata: nextMetadata, sessionId: session.id });
    }
  };

  const openSftp = async () => {
    const initialPath = await querySshCurrentDirectory(panelId);
    onOpenSftp?.(session, { initialPath, revealInSidebar: false });
  };

  return (
    <ContextMenu
      onOpenChange={(isOpen) => {
        if (isOpen) {
          refreshContextSelection();
        }
      }}
    >
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
                void openSftp();
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
        <ContextMenuItem onSelect={() => void saveCurrentPath()}>
          <Star className="size-3.5" />
          Save current path
        </ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={!contextSelection}>
            <ScrollText className="mr-2 size-3.5" />
            Save selected command
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onSelect={() => void saveSelectedCommand()}>
              Save as typed
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void saveSelectedCommand({ withCurrentPath: true })}>
              Save with current path
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!onOpenSftp} onSelect={() => void openSftp()}>
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
