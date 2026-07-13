import type { TabNode } from 'flexlayout-react';

import type { SessionItem } from '@/types/workspace';
import { getCloseTabShortcutLabel } from './workspaceShortcuts';

export interface WorkspaceTabMenuState {
  node: TabNode;
  session?: SessionItem;
  x: number;
  y: number;
}

export function WorkspaceTabMenu({
  menu,
  onClone,
  onClose,
  onCloseOthers,
  onCloseRight,
  onDisconnect,
  onOpenAi,
  onOpenSftp,
  onReconnect,
}: {
  menu: WorkspaceTabMenuState;
  onClone: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseRight: () => void;
  onDisconnect: () => void;
  onOpenAi?: () => void;
  onOpenSftp?: (session: SessionItem) => void;
  onReconnect: () => void;
}) {
  const { node, session, x, y } = menu;
  const isSessionTab = Boolean(session);
  const panelType = node.getConfig()?.panelType;
  const canAskAi = panelType === 'terminal' || panelType === 'sftp';
  const closeTabShortcutLabel = getCloseTabShortcutLabel();
  const copyHost = () => {
    if (session?.host) {
      void navigator.clipboard.writeText(session.host).catch(() => undefined);
    }
  };
  const copySshCommand = () => {
    const command = createSshCommand(session);

    if (command) {
      void navigator.clipboard.writeText(command).catch(() => undefined);
    }
  };

  return (
    <div
      className="fixed z-50 min-w-48 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-xl"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">{node.getName()}</div>
      <WorkspaceTabMenuButton disabled={!isSessionTab} onClick={onClone}>
        Clone Channel
      </WorkspaceTabMenuButton>
      <WorkspaceTabMenuButton disabled={!canAskAi || !onOpenAi} onClick={() => onOpenAi?.()}>
        Ask AI about this
      </WorkspaceTabMenuButton>
      <WorkspaceTabMenuButton disabled={session?.kind !== 'ssh' || !onOpenSftp} onClick={() => session && onOpenSftp?.(session)}>
        Open SFTP
      </WorkspaceTabMenuButton>
      <WorkspaceTabMenuButton disabled={!isSessionTab} onClick={onReconnect}>
        Reconnect
      </WorkspaceTabMenuButton>
      <WorkspaceTabMenuButton disabled={!isSessionTab} onClick={onDisconnect}>
        Disconnect
      </WorkspaceTabMenuButton>
      <WorkspaceTabMenuSeparator />
      <WorkspaceTabMenuButton disabled={!session?.host} onClick={copyHost}>
        Copy Host
      </WorkspaceTabMenuButton>
      <WorkspaceTabMenuButton disabled={!createSshCommand(session)} onClick={copySshCommand}>
        Copy SSH Command
      </WorkspaceTabMenuButton>
      <WorkspaceTabMenuSeparator />
      <WorkspaceTabMenuButton shortcut={closeTabShortcutLabel} onClick={onClose}>
        Close
      </WorkspaceTabMenuButton>
      <WorkspaceTabMenuButton onClick={onCloseOthers}>Close Others</WorkspaceTabMenuButton>
      <WorkspaceTabMenuButton onClick={onCloseRight}>Close Tabs to the Right</WorkspaceTabMenuButton>
    </div>
  );
}

export function readSessionConfig(value: unknown): SessionItem | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const session = value as Partial<SessionItem>;

  return typeof session.id === 'string' && typeof session.name === 'string'
    ? (session as SessionItem)
    : undefined;
}

function WorkspaceTabMenuButton({
  children,
  disabled,
  onClick,
  shortcut,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      className="flex w-full select-none items-center rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {shortcut ? <span className="ml-4 text-[10px] text-muted-foreground">{shortcut}</span> : null}
    </button>
  );
}

function WorkspaceTabMenuSeparator() {
  return <div className="-mx-1 my-1 h-px bg-border" />;
}

function createSshCommand(session: SessionItem | undefined) {
  if (!session || session.kind !== 'ssh' || !session.host) {
    return undefined;
  }

  const username = session.username ? `${session.username}@` : '';
  const port = session.port && session.port !== 22 ? ` -p ${session.port}` : '';

  return `ssh ${username}${session.host}${port}`;
}
