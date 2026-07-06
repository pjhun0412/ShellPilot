import { invoke } from '@tauri-apps/api/core';
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
import { publishConnectionStatus } from '@/features/connections/connectionStatus';
import { resolvePasswordCredentialRef, saveSshSessionPassword } from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';
import { subscribeTerminalClosing } from './terminalLifecycle';

interface SshTerminalEvent {
  data?: string;
  message?: string;
  panelId: string;
  status: 'closed' | 'connected' | 'data' | 'failed' | 'info';
}

export function SshTerminal({
  panelId,
  session,
}: {
  panelId: string;
  session: SessionItem;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon>();
  const pendingPasswordRef = useRef<string>();
  const shouldRememberPasswordRef = useRef(true);
  const terminalRef = useRef<Terminal>();
  const [manualPassword, setManualPassword] = useState('');
  const [shouldRememberPassword, setShouldRememberPassword] = useState(true);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'failed'>('connecting');

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'Cascadia Mono, Consolas, monospace',
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
        foreground: '#d6deeb',
        green: '#34d399',
        magenta: '#a78bfa',
        red: '#fb7185',
        white: '#d1d5db',
        yellow: '#fbbf24',
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    fitTerminal(panelId, terminal, fitAddon);
    terminal.writeln(`Connecting to ${session.username ? `${session.username}@` : ''}${session.host}:${session.port ?? 22}...`);
    publishConnectionStatus({ panelId, status: 'connecting' });

    const dataDisposable = terminal.onData((data) => {
      void invoke('ssh_write', { data, panelId });
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
        void pasteClipboard(panelId);
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
            void invoke('ssh_write', { data: text, panelId });
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
      void invoke('ssh_close', { panelId });
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
        setStatus('connected');
        publishConnectionStatus({ panelId, status: 'connected' });
        terminal.clear();
        terminal.focus();
        if (pendingPasswordRef.current && shouldRememberPasswordRef.current) {
          void saveSshSessionPassword(session, pendingPasswordRef.current).finally(() => {
            pendingPasswordRef.current = undefined;
          });
        } else {
          pendingPasswordRef.current = undefined;
        }
        void resizeRemotePty(panelId, terminal);
        fitTerminal(panelId, terminal, fitAddon);
        return;
      }

      if (event.payload.status === 'info') {
        return;
      }

      if (event.payload.status === 'data' && event.payload.data) {
        terminal.write(event.payload.data);
        return;
      }

      if (event.payload.status === 'failed') {
        setStatus('failed');
        publishConnectionStatus({ panelId, status: 'failed' });
        terminal.writeln(`\r\n${event.payload.message ?? 'SSH session failed'}`);
        return;
      }

      if (event.payload.status === 'closed') {
        publishConnectionStatus({ panelId, status: 'idle' });
        terminal.writeln('\r\n[closed]');
      }
      });

      if (isDisposed) {
        return;
      }

      await openShell(panelId, session);
    };

    void startShellAfterListenerReady().catch((error: unknown) => {
      if (!isDisposed) {
        setStatus('failed');
        publishConnectionStatus({ panelId, status: 'failed' });
        terminal.writeln(`\r\n${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return () => {
      isDisposed = true;
      void invoke('ssh_close', { panelId });
      dataDisposable.dispose();
      selectionDisposable.dispose();
      resizeObserver.disconnect();
      window.removeEventListener('keydown', shortcutHandler, true);
      unsubscribeClosing();
      unlisten?.();
      terminal.dispose();
      publishConnectionStatus({ panelId, status: 'idle' });
    };
  }, [panelId, session]);

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
    publishConnectionStatus({ panelId, status: 'connecting' });
    terminal?.clear();
    terminal?.writeln(`Reconnecting to ${session.username ? `${session.username}@` : ''}${session.host}:${session.port ?? 22}...`);
    await invoke('ssh_close', { panelId }).catch(() => undefined);
    await openShell(panelId, session).catch((error: unknown) => {
      setStatus('failed');
      publishConnectionStatus({ panelId, status: 'failed' });
      terminal?.writeln(`\r\n${error instanceof Error ? error.message : String(error)}`);
    });
    terminal?.focus();
  };

  const closeSession = async () => {
    terminalRef.current?.writeln('\r\n[closing ssh session...]');
    await invoke('ssh_close', { panelId }).catch(() => undefined);
    setStatus('failed');
    publishConnectionStatus({ panelId, status: 'idle' });
  };

  const connectWithPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!manualPassword) {
      return;
    }

    setStatus('connecting');
    pendingPasswordRef.current = manualPassword;
    terminalRef.current?.writeln('\r\nRetrying with typed password...');
    await openShell(panelId, session, manualPassword).catch((error: unknown) => {
      setStatus('failed');
      terminalRef.current?.writeln(`\r\n${error instanceof Error ? error.message : String(error)}`);
    });
    setManualPassword('');
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
            void pasteClipboard(panelId);
          }}
        >
          <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />
          {status === 'failed' && (
            <form
              className="absolute left-4 top-4 grid w-[min(28rem,calc(100%-2rem))] gap-2 rounded-md border bg-card/95 p-3 text-xs shadow-lg"
              onSubmit={connectWithPassword}
            >
              <span className="text-muted-foreground">Password was not available. Enter it to retry.</span>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  className="session-input h-8"
                  type="password"
                  autoComplete="current-password"
                  placeholder="SSH password"
                  value={manualPassword}
                  onChange={(event) => setManualPassword(event.target.value)}
                />
                <button
                  className="rounded-md bg-primary px-3 text-primary-foreground disabled:opacity-50"
                  type="submit"
                  disabled={!manualPassword}
                >
                  Connect
                </button>
              </div>
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
                Remember password securely
              </label>
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
        <ContextMenuItem onSelect={() => void pasteClipboard(panelId)}>
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
          Close Session
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function fitTerminal(panelId: string, terminal: Terminal, fitAddon: FitAddon) {
  window.requestAnimationFrame(() => {
    try {
      fitAddon.fit();
      void resizeRemotePty(panelId, terminal);
    } catch {
      // FlexLayout can briefly report zero-size panels while dragging splitters.
    }
  });
}

async function openShell(panelId: string, session: SessionItem, password?: string) {
  await invoke('ssh_open_shell', {
    target: {
      credentialId: password ? null : resolvePasswordCredentialRef(session).id,
      host: session.host,
      panelId,
      password: password ?? null,
      port: session.port ?? 22,
      username: session.username ?? '',
    },
  });
}

async function resizeRemotePty(panelId: string, terminal: Terminal) {
  if (!terminal.cols || !terminal.rows) {
    return;
  }

  await invoke('ssh_resize', {
    cols: terminal.cols,
    panelId,
    rows: terminal.rows,
  }).catch(() => undefined);
}

async function pasteClipboard(panelId: string) {
  const text = await navigator.clipboard.readText().catch(() => '');

  if (!text) {
    return;
  }

  await invoke('ssh_write', { data: text, panelId }).catch(() => undefined);
}
