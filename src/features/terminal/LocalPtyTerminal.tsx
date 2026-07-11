import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Clipboard, Copy, Eraser } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { pasteClipboardToLocalPty, type LocalPtyTarget } from './localPtyBridge';
import { copyTerminalSelection } from './sshTerminalInput';
import { useLocalPtyLifecycle, type LocalPtyStatus } from './useLocalPtyLifecycle';

export function LocalPtyTerminal({
  isActive = false,
  panelId,
  target,
}: {
  isActive?: boolean;
  panelId: string;
  target: LocalPtyTarget;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon>();
  const terminalRef = useRef<Terminal>();
  const [status, setStatusState] = useState<LocalPtyStatus>('connecting');
  const [failureMessage, setFailureMessage] = useState<string>();

  const setStatus = useCallback((nextStatus: LocalPtyStatus, message?: string) => {
    setStatusState(nextStatus);
    setFailureMessage(message);
  }, []);

  useLocalPtyLifecycle({ containerRef, fitAddonRef, panelId, setStatus, target, terminalRef });

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
            void pasteClipboardToLocalPty(panelId);
          }}
        >
          <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />
          {status === 'failed' && (
            <div className="absolute inset-x-3 top-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs leading-5 text-destructive-foreground">
              {failureMessage ?? 'Failed to start process.'}
            </div>
          )}
          {status === 'closed' && (
            <div className="absolute inset-x-3 top-3 rounded-md border border-border bg-card p-3 text-xs leading-5 text-muted-foreground">
              Process exited. Close and reopen this tab to start a new session.
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={copySelection}>
          <Copy className="size-3.5" />
          Copy
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void pasteClipboardToLocalPty(panelId)}>
          <Clipboard className="size-3.5" />
          Paste
        </ContextMenuItem>
        <ContextMenuItem onSelect={clearTerminal}>
          <Eraser className="size-3.5" />
          Clear
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
