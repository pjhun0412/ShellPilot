import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Clipboard, Copy, Eraser, PlugZap, RotateCcw } from 'lucide-react';
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
import { appConfirm } from '@/components/ui/app-dialog';
import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import {
  resolveKeyCredentialRef,
  resolvePasswordCredentialRef,
  saveSshSessionKeyPassphrase,
  saveSshSessionPassword,
} from '@/features/connections/sshConnection';
import { requestSessionPatch } from '@/features/sessions/sessionStorage';
import type { SessionItem } from '@/types/workspace';
import { subscribeTerminalClosing, subscribeTerminalReconnect } from './terminalLifecycle';
import {
  closeSshShell,
  forgetSshKnownHost,
  openSshShell,
  pasteClipboardToSsh,
  resizeSshPty,
  SshShellOpenError,
  writeSshData,
  type SshTerminalEvent,
} from './sshTerminalBridge';

type SshTerminalUiStatus = 'closed' | 'connecting' | 'connected' | 'failed' | 'restored';

export function SshTerminal({
  autoConnect = true,
  panelId,
  session,
}: {
  autoConnect?: boolean;
  panelId: string;
  session: SessionItem;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon>();
  const pendingPasswordRef = useRef<string>();
  const pendingUsernameRef = useRef<string>();
  const lastHostKeyWarningRef = useRef<{
    code?: string;
    message: string;
  }>();
  const closeIntentRef = useRef<'dispose' | 'manual' | 'reconnect'>();
  const shouldRememberPasswordRef = useRef(true);
  const shouldRememberUsernameRef = useRef(true);
  const terminalRef = useRef<Terminal>();
  const [failure, setFailure] = useState<{
    authPrompt: boolean;
    code?: string;
    message: string;
    retryable: boolean;
  }>();
  const [manualPassword, setManualPassword] = useState('');
  const [manualUsername, setManualUsername] = useState('');
  const [shouldRememberPassword, setShouldRememberPassword] = useState(true);
  const [shouldRememberUsername, setShouldRememberUsername] = useState(true);
  const [status, setStatus] = useState<SshTerminalUiStatus>(autoConnect ? 'connecting' : 'restored');
  const secretLabel =
    session.authMethod === 'key'
      ? 'key passphrase'
      : session.authMethod === 'interactive'
        ? 'interactive response'
        : 'password';

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'Cascadia Mono, D2Coding, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: '#05080e',
        black: '#151922',
        blue: '#5ea1ff',
        brightBlack: '#6b7280',
        brightBlue: '#93c5fd',
        brightCyan: '#67e8f9',
        brightGreen: '#86efac',
        brightMagenta: '#c4b5fd',
        brightRed: '#fca5a5',
        brightWhite: '#f8fafc',
        brightYellow: '#fde68a',
        cyan: '#22d3ee',
        cursor: '#2dd4bf',
        foreground: '#f8fafc',
        green: '#34d399',
        magenta: '#a78bfa',
        red: '#fb7185',
        white: '#e5e7eb',
        yellow: '#fbbf24',
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    fitTerminal(panelId, terminal, fitAddon);
    if (autoConnect) {
      terminal.writeln(`Connecting to ${session.username ? `${session.username}@` : ''}${session.host}:${session.port ?? 22}...`);
      publishConnectionStatus({ panelId, status: 'connecting' });
    } else {
      terminal.writeln(`Session restored: ${session.username ? `${session.username}@` : ''}${session.host}:${session.port ?? 22}`);
      terminal.writeln('Use Reconnect to open a new SSH connection.');
      publishConnectionStatus({ panelId, status: 'restored' });
    }
    setFailure(undefined);

    const dataDisposable = terminal.onData((data) => {
      void writeSshData(panelId, data);
    });
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selectedText = terminal.getSelection();

      if (selectedText) {
        void navigator.clipboard.writeText(selectedText).catch(() => undefined);
      }
    });
    const shortcutHandler = (event: KeyboardEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        return;
      }

      if (!event.ctrlKey || !event.shiftKey || event.type !== 'keydown') {
        return;
      }

      if (event.code === 'KeyC') {
        event.preventDefault();
        event.stopPropagation();
        const selectedText = terminal.getSelection();
        if (selectedText) {
          void navigator.clipboard.writeText(selectedText).catch(() => undefined);
        }
        return;
      }

      if (event.code === 'KeyV') {
        event.preventDefault();
        event.stopPropagation();
        void pasteClipboardToSsh(panelId);
      }
    };
    window.addEventListener('keydown', shortcutHandler, true);
    terminal.attachCustomKeyEventHandler((event) => {
      if (!event.ctrlKey || !event.shiftKey || event.type !== 'keydown') {
        return true;
      }

      if (event.code === 'KeyC') {
        const selectedText = terminal.getSelection();
        if (selectedText) {
          void navigator.clipboard.writeText(selectedText).catch(() => undefined);
        }
        return false;
      }

      if (event.code === 'KeyV') {
        void navigator.clipboard.readText().then((text) => {
          if (text) {
            void writeSshData(panelId, text);
          }
        }).catch(() => undefined);
        return false;
      }

      return true;
    });
    const resizeObserver = new ResizeObserver(() => {
      fitTerminal(panelId, terminal, fitAddon);
    });
    resizeObserver.observe(containerRef.current);
    const unsubscribeClosing = subscribeTerminalClosing((closingPanelId) => {
      if (closingPanelId !== panelId) {
        return;
      }

      terminal.writeln('\r\n[closing ssh session...]');
      closeIntentRef.current = 'dispose';
      void closeSshShell(panelId);
      publishConnectionStatus({ panelId, status: 'idle' });
    });

    let isDisposed = false;
    let unlisten: UnlistenFn | undefined;
    const startShellAfterListenerReady = async () => {
      unlisten = await listen<SshTerminalEvent>('shellpilot-ssh-terminal', (event) => {
      if (event.payload.panelId !== panelId) {
        return;
      }

      if (event.payload.status === 'connected') {
        closeIntentRef.current = undefined;
        setStatus('connected');
        setFailure(undefined);
        publishConnectionStatus({ panelId, status: 'connected' });
        terminal.clear();
        terminal.focus();
        if (pendingPasswordRef.current && shouldRememberPasswordRef.current) {
          const saveSecret =
            session.authMethod === 'key' ? saveSshSessionKeyPassphrase : saveSshSessionPassword;
          const credentialRef =
            session.authMethod === 'key'
              ? resolveKeyCredentialRef(session)
              : resolvePasswordCredentialRef(session);

          void saveSecret(session, pendingPasswordRef.current)
            .then(() => {
              requestSessionPatch({
                sessionId: session.id,
                patch: { credentialRef },
              });
            })
            .finally(() => {
              pendingPasswordRef.current = undefined;
            });
        } else {
          pendingPasswordRef.current = undefined;
        }
        if (pendingUsernameRef.current && shouldRememberUsernameRef.current) {
          requestSessionPatch({
            sessionId: session.id,
            patch: {
              username: pendingUsernameRef.current,
            },
          });
        }
        pendingUsernameRef.current = undefined;
        void resizeSshPty(panelId, terminal);
        fitTerminal(panelId, terminal, fitAddon);
        return;
      }

      if (event.payload.status === 'info') {
        return;
      }

      if (event.payload.status === 'warning') {
        if (event.payload.code === 'host_key_unknown' || event.payload.code === 'host_key_mismatch') {
          lastHostKeyWarningRef.current = {
            code: event.payload.code,
            message: event.payload.message ?? 'SSH host key verification failed.',
          };
        }
        terminal.writeln(`\r\n${event.payload.message ?? 'SSH security warning'}`);
        return;
      }

      if (event.payload.status === 'data' && event.payload.data) {
        terminal.write(event.payload.data);
        return;
      }

      if (event.payload.status === 'failed') {
        closeIntentRef.current = undefined;
        const hostKeyWarning = lastHostKeyWarningRef.current;
        const message =
          hostKeyWarning &&
          (event.payload.code === 'host_key_unknown' || event.payload.code === 'host_key_mismatch')
            ? hostKeyWarning.message
            : event.payload.message ?? 'SSH session failed';

        setStatus('failed');
        setFailure({
          authPrompt: event.payload.authPrompt,
          code: hostKeyWarning?.code ?? event.payload.code,
          message,
          retryable: event.payload.retryable,
        });
        publishConnectionStatus({ panelId, status: 'failed' });
        return;
      }

      if (event.payload.status === 'closed') {
        if (closeIntentRef.current === 'reconnect' || closeIntentRef.current === 'dispose') {
          return;
        }

        closeIntentRef.current = undefined;
        setStatus('closed');
        setFailure(undefined);
        publishConnectionStatus({ panelId, status: 'closed' });
        terminal.writeln('\r\n[closed]');
      }
      });

      if (isDisposed) {
        return;
      }

      if (autoConnect) {
        await openSshShell(panelId, session);
      }
    };

    void startShellAfterListenerReady().catch((error: unknown) => {
      if (!isDisposed) {
        const failure = getSshOpenFailure(error);

        setStatus('failed');
        setFailure(failure);
        publishConnectionStatus({ panelId, status: 'failed' });
      }
    });

    return () => {
      isDisposed = true;
      closeIntentRef.current = 'dispose';
      void closeSshShell(panelId);
      dataDisposable.dispose();
      selectionDisposable.dispose();
      resizeObserver.disconnect();
      window.removeEventListener('keydown', shortcutHandler, true);
      unsubscribeClosing();
      unlisten?.();
      terminal.dispose();
      publishConnectionStatus({ panelId, status: 'idle' });
    };
  }, [autoConnect, panelId, session]);

  const copySelection = () => {
    const selectedText = terminalRef.current?.getSelection();

    if (selectedText) {
      void navigator.clipboard.writeText(selectedText).catch(() => undefined);
    }
  };

  const clearTerminal = () => {
    terminalRef.current?.clear();
    terminalRef.current?.focus();
  };

  const reconnectSession = async () => {
    const terminal = terminalRef.current;

    setStatus('connecting');
    setFailure(undefined);
    lastHostKeyWarningRef.current = undefined;
    publishConnectionStatus({ panelId, status: 'connecting' });
    terminal?.clear();
    terminal?.writeln(`Reconnecting to ${session.username ? `${session.username}@` : ''}${session.host}:${session.port ?? 22}...`);
    closeIntentRef.current = 'reconnect';
    await closeSshShell(panelId).catch(() => undefined);
    await openSshShell(panelId, session).catch((error: unknown) => {
      const failure = getSshOpenFailure(error);

      closeIntentRef.current = undefined;
      setStatus('failed');
      setFailure(failure);
      publishConnectionStatus({ panelId, status: 'failed' });
    });
    terminal?.focus();
  };

  useEffect(() => {
    return subscribeTerminalReconnect((reconnectPanelId) => {
      if (reconnectPanelId === panelId) {
        void reconnectSession();
      }
    });
  });

  const closeSession = async () => {
    terminalRef.current?.writeln('\r\n[closing ssh session...]');
    closeIntentRef.current = 'manual';
    await closeSshShell(panelId).catch(() => undefined);
    setFailure(undefined);
    setStatus('closed');
    publishConnectionStatus({ panelId, status: 'closed' });
  };

  const connectWithPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const needsUsername = shouldPromptUsername(failure?.code, session);
    const needsSecret = shouldPromptSecret(failure?.code, session);
    const username = manualUsername.trim();

    if ((needsUsername && !username) || (needsSecret && !manualPassword)) {
      return;
    }

    setStatus('connecting');
    setFailure(undefined);
    lastHostKeyWarningRef.current = undefined;
    pendingPasswordRef.current = manualPassword || undefined;
    pendingUsernameRef.current = username || undefined;
    terminalRef.current?.writeln(`\r\nRetrying with typed ${secretLabel}...`);
    await openSshShell(panelId, session, {
      password: manualPassword || undefined,
      username: username || undefined,
    }).catch((error: unknown) => {
      const failure = getSshOpenFailure(error);

      setStatus('failed');
      setFailure({
        ...failure,
        authPrompt: true,
      });
    });
    setManualPassword('');
    setManualUsername('');
  };

  const resetKnownHostAndReconnect = async () => {
    const confirmed = await appConfirm({
      confirmLabel: 'Reset Host Key',
      message:
        'Reset the stored SSH host key for this server?\n\nOnly continue if you verified the server was rebuilt or its SSH host key changed intentionally.',
      title: 'Reset SSH Host Key',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    await forgetSshKnownHost(session);
    await reconnectSession();
  };

  const trustHostKeyAndReconnect = async () => {
    setStatus('connecting');
    setFailure(undefined);
    lastHostKeyWarningRef.current = undefined;
    publishConnectionStatus({ panelId, status: 'connecting' });
    terminalRef.current?.writeln('\r\nTrusting SSH host key and reconnecting...');
    closeIntentRef.current = 'reconnect';
    await closeSshShell(panelId).catch(() => undefined);
    await openSshShell(panelId, session, { acceptNewHostKey: true }).catch((error: unknown) => {
      const failure = getSshOpenFailure(error);

      closeIntentRef.current = undefined;
      setStatus('failed');
      setFailure(failure);
      publishConnectionStatus({ panelId, status: 'failed' });
    });
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
          {status === 'restored' && (
            <div className="absolute left-1/2 top-1/2 grid w-[min(24rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg">
              <span className="font-medium text-slate-100">Session restored</span>
              <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
                Terminal output was not restored. Reconnect to open a new SSH session.
              </span>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" type="button" onClick={() => void reconnectSession()}>
                  Reconnect
                </Button>
              </div>
            </div>
          )}
          {status === 'closed' && (
            <div className="absolute left-1/2 top-1/2 grid w-[min(24rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg">
              <span className="font-medium text-slate-100">Session closed</span>
              <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
                The SSH connection is closed. Reconnect to open a new shell session.
              </span>
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" type="button" onClick={() => void reconnectSession()}>
                  Reconnect
                </Button>
              </div>
            </div>
          )}
          {status === 'failed' && failure && (
            <form
              className="absolute left-1/2 top-1/2 grid w-[min(28rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg"
              onSubmit={connectWithPassword}
            >
              <span className="font-medium text-slate-100">
                {getSshFailureTitle(failure.code)}
              </span>
              <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
                {failure.message}
              </span>
              {failure.authPrompt ? (
                <>
                  <div className="grid gap-2">
                    {shouldPromptUsername(failure.code, session) && (
                      <input
                        className="session-input h-8"
                        type="text"
                        autoComplete="username"
                        placeholder="SSH username"
                        value={manualUsername}
                        onChange={(event) => setManualUsername(event.target.value)}
                      />
                    )}
                    {shouldPromptSecret(failure.code, session) && (
                      <input
                        className="session-input h-8"
                        type="password"
                        autoComplete="current-password"
                        placeholder={
                          session.authMethod === 'key'
                            ? 'SSH key passphrase'
                            : session.authMethod === 'interactive'
                              ? 'Interactive response'
                              : 'SSH password'
                        }
                        value={manualPassword}
                        onChange={(event) => setManualPassword(event.target.value)}
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      type="submit"
                      disabled={
                        (shouldPromptUsername(failure.code, session) && !manualUsername.trim()) ||
                        (shouldPromptSecret(failure.code, session) && !manualPassword)
                      }
                    >
                      Connect
                    </Button>
                  </div>
                  {shouldPromptUsername(failure.code, session) && (
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input
                        className="accent-primary"
                        type="checkbox"
                        checked={shouldRememberUsername}
                        onChange={(event) => {
                          shouldRememberUsernameRef.current = event.target.checked;
                          setShouldRememberUsername(event.target.checked);
                        }}
                      />
                      Remember username for this session
                    </label>
                  )}
                  {shouldPromptSecret(failure.code, session) && (
                    <label className="flex items-center gap-2 text-muted-foreground">
                      <input
                        className="accent-primary"
                        type="checkbox"
                        checked={shouldRememberPassword}
                        onChange={(event) => {
                          shouldRememberPasswordRef.current = event.target.checked;
                          setShouldRememberPassword(event.target.checked);
                        }}
                      />
                      Remember {secretLabel} securely
                    </label>
                  )}
                </>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  {failure.code === 'host_key_unknown' && (
                    <Button size="sm" type="button" onClick={() => void trustHostKeyAndReconnect()}>
                      Trust & Connect
                    </Button>
                  )}
                  {failure.code === 'host_key_mismatch' && (
                    <Button size="sm" type="button" variant="secondary" onClick={() => void resetKnownHostAndReconnect()}>
                      Reset Host Key
                    </Button>
                  )}
                  <Button
                    size="sm"
                    type="button"
                    variant={failure.retryable && failure.code !== 'host_key_unknown' ? 'default' : 'secondary'}
                    onClick={() => void reconnectSession()}
                    disabled={!failure.retryable || failure.code === 'host_key_unknown'}
                  >
                    Reconnect
                  </Button>
                </div>
              )}
            </form>
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

function fitTerminal(panelId: string, terminal: Terminal, fitAddon: FitAddon) {
  window.requestAnimationFrame(() => {
    try {
      fitAddon.fit();
      void resizeSshPty(panelId, terminal);
    } catch {
      // FlexLayout can briefly report zero-size panels while dragging splitters.
    }
  });
}

function getSshOpenFailure(error: unknown) {
  if (error instanceof SshShellOpenError) {
    return {
      authPrompt: error.authPrompt,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    authPrompt: false,
    code: 'connection_failed',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function getSshFailureTitle(code?: string) {
  if (code === 'username_missing') {
    return 'SSH username required';
  }

  if (code === 'auth_missing') {
    return 'SSH credential required';
  }

  if (code === 'auth_failed') {
    return 'SSH authentication failed';
  }

  if (code === 'agent_failed') {
    return 'SSH agent unavailable';
  }

  if (code === 'host_key_mismatch') {
    return 'SSH host key blocked';
  }

  if (code === 'host_key_unknown') {
    return 'Unknown SSH host key';
  }

  if (code === 'connection_refused') {
    return 'SSH connection refused';
  }

  if (code === 'connection_timeout') {
    return 'SSH connection timeout';
  }

  if (code === 'dns_failed') {
    return 'SSH host not resolved';
  }

  if (code === 'network_unreachable') {
    return 'SSH network unreachable';
  }

  return 'SSH connection failed';
}

function shouldPromptUsername(code: string | undefined, session: SessionItem) {
  return code === 'username_missing' || !session.username?.trim();
}

function shouldPromptSecret(code: string | undefined, session: SessionItem) {
  const usesSecret =
    session.authMethod === 'password' ||
    session.authMethod === 'os-credential' ||
    session.authMethod === 'interactive' ||
    !session.authMethod;

  if (!usesSecret) {
    return code === 'auth_failed';
  }

  return (
    code === 'auth_missing' ||
    code === 'auth_failed' ||
    (code === 'username_missing' && session.credentialRef?.kind !== 'password')
  );
}
