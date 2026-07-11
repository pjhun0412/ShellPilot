import { Bot, ChevronDown, ChevronRight, Folder, Monitor, Settings, Terminal, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { requestRdpDisconnect, requestRdpReconnect } from '@/features/rdp/rdpPanelLifecycle';
import { subscribeConnectionStatus } from '@/features/connections/connectionStatus';
import { requestSftpSidebarDisconnect, requestSftpSidebarReconnect, subscribeSftpSidebarPanelStates, type SftpSidebarPanelState } from '@/features/sftp/sftpSidebarState';
import { notifyTerminalDisconnect, notifyTerminalReconnect } from '@/features/terminal/terminalLifecycle';
import type { WorkspacePanel, WorkspacePanelType, WorkspaceTabItem } from '@/types/workspace';
import { ConnectionStatusDot, formatConnectionStatusLabel, formatRemotePath, getRemotePathTitle, getWorkspaceTabPrimaryDetail, getWorkspaceTabTitle, groupWorkspaceTabs, loadStringSetPreference, openTabsCollapsedGroupsStorageKey, saveStringSetPreference, type WorkspaceTabGroup, type WorkspaceTabVisualStatus } from './SidebarPanelUtils';
export function WorkspaceTabsSidebar({
  activePanelId,
  onAddPanel,
  onClonePanel,
  onClosePanel,
  onSelectPanel,
  workspaceTabs,
}: {
  activePanelId?: string;
  onAddPanel: (panel: WorkspacePanel) => void;
  onClonePanel: (tab: WorkspaceTabItem, path?: string) => void;
  onClosePanel: (panelId: string) => void;
  onSelectPanel: (panelId: string) => void;
  workspaceTabs: WorkspaceTabItem[];
}) {
  const [panelStates, setPanelStates] = useState<Record<string, SftpSidebarPanelState>>({});
  const [connectionStates, setConnectionStates] = useState<Record<string, WorkspaceTabVisualStatus>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() =>
    loadStringSetPreference(openTabsCollapsedGroupsStorageKey),
  );
  const groupedTabs = useMemo(
    () => groupWorkspaceTabs(workspaceTabs, panelStates, connectionStates),
    [connectionStates, panelStates, workspaceTabs],
  );

  useEffect(() => subscribeSftpSidebarPanelStates(setPanelStates), []);
  useEffect(
    () =>
      subscribeConnectionStatus((detail) => {
        setConnectionStates((current) => ({
          ...current,
          [detail.panelId]: detail.status,
        }));
      }),
    [],
  );

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      saveStringSetPreference(openTabsCollapsedGroupsStorageKey, next);
      return next;
    });
  };
  const reconnectTab = (tab: WorkspaceTabItem) => {
    if (tab.type === 'terminal' && tab.session) {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'queued' }));
      notifyTerminalReconnect(tab.id);
      return;
    }

    if (tab.type === 'sftp') {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'queued' }));
      requestSftpSidebarReconnect(tab.id);
      return;
    }

    if (tab.type === 'rdp') {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'queued' }));
      requestRdpReconnect(tab.id);
    }
  };
  const disconnectTab = (tab: WorkspaceTabItem) => {
    if (tab.type === 'terminal' && tab.session) {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'closed' }));
      notifyTerminalDisconnect(tab.id);
      return;
    }

    if (tab.type === 'sftp') {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'closed' }));
      requestSftpSidebarDisconnect(tab.id);
      return;
    }

    if (tab.type === 'rdp') {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'closed' }));
      requestRdpDisconnect(tab.id);
    }
  };
  const cloneTab = (tab: WorkspaceTabItem) => {
    onClonePanel(tab, panelStates[tab.id]?.path);
  };
  const closeOtherTabs = (tabId: string) => {
    for (const tab of workspaceTabs) {
      if (tab.id !== tabId) {
        onClosePanel(tab.id);
      }
    }
  };
  const closeGroup = (group: WorkspaceTabGroup) => {
    for (const item of group.tabs) {
      onClosePanel(item.tab.id);
    }
  };
  const reconnectGroup = (group: WorkspaceTabGroup) => {
    for (const item of group.tabs) {
      if (item.status !== 'queued' && item.status !== 'connecting') {
        reconnectTab(item.tab);
      }
    }
  };
  const disconnectGroup = (group: WorkspaceTabGroup) => {
    for (const item of group.tabs) {
      if (item.status === 'connected' || item.status === 'connecting' || item.status === 'queued') {
        disconnectTab(item.tab);
      }
    }
  };
  const openCounterpart = (tab: WorkspaceTabItem) => {
    if (!tab.session) {
      return;
    }

    onAddPanel({
      id: tab.type === 'sftp' ? `terminal-${tab.session.id}` : `sftp-${tab.session.id}`,
      session: tab.session,
      title: tab.type === 'sftp' ? tab.session.name : `SFTP - ${tab.session.name}`,
      type: tab.type === 'sftp' ? 'terminal' : 'sftp',
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Tabs</h2>
        <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
          {workspaceTabs.length}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <OverlayScrollArea>
          <div className="grid gap-1 pr-2">
            {workspaceTabs.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-slate-500">
                Open workspace tabs will appear here.
              </div>
            ) : (
              groupedTabs.map((group) => {
                const isCollapsed = collapsedGroups.has(group.id);

                return (
                  <div className="grid gap-0.5" key={group.id}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          className="mt-1 grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] font-semibold text-slate-500 hover:bg-accent/60 hover:text-slate-300"
                          type="button"
                          onClick={() => toggleGroup(group.id)}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="size-3 text-slate-500" />
                          ) : (
                            <ChevronDown className="size-3 text-slate-500" />
                          )}
                          <Monitor className="size-3.5 text-slate-500" />
                          <span className="truncate">{group.label}</span>
                          <span className="rounded border border-border/70 px-1 font-mono text-[10px] text-slate-500">
                            {group.tabs.length}
                          </span>
                          <ConnectionStatusDot status={group.status} />
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuLabel>{group.label}</ContextMenuLabel>
                        <ContextMenuItem onSelect={() => reconnectGroup(group)}>
                          Reconnect Group
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => disconnectGroup(group)}>
                          Disconnect Group
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => closeGroup(group)}
                        >
                          Close Group
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                    {!isCollapsed && (
                      <div className="ml-2 grid gap-0.5 border-l border-border/50 pl-2">
                        {group.tabs.map((item) => (
                          <WorkspaceTabButton
                            active={item.tab.id === activePanelId}
                            canOpenCounterpart={Boolean(item.tab.session && (item.tab.type === 'terminal' || item.tab.type === 'sftp'))}
                            displayTitle={item.displayTitle}
                            key={item.tab.id}
                            onClone={() => cloneTab(item.tab)}
                            onClose={() => onClosePanel(item.tab.id)}
                            onCloseOthers={() => closeOtherTabs(item.tab.id)}
                            onDisconnect={() => disconnectTab(item.tab)}
                            onClick={() => onSelectPanel(item.tab.id)}
                            onOpenCounterpart={() => openCounterpart(item.tab)}
                            onReconnect={() => reconnectTab(item.tab)}
                            panelState={panelStates[item.tab.id]}
                            status={item.status}
                            tab={item.tab}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </OverlayScrollArea>
      </div>
    </section>
  );
}

function WorkspaceTabButton({
  active,
  canOpenCounterpart,
  displayTitle,
  onClone,
  onClick,
  onClose,
  onCloseOthers,
  onDisconnect,
  onOpenCounterpart,
  onReconnect,
  panelState,
  status,
  tab,
}: {
  active: boolean;
  canOpenCounterpart: boolean;
  displayTitle?: string;
  onClone: () => void;
  onClick: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onDisconnect: () => void;
  onOpenCounterpart: () => void;
  onReconnect: () => void;
  panelState?: SftpSidebarPanelState;
  status?: WorkspaceTabVisualStatus;
  tab: WorkspaceTabItem;
}) {
  const title = displayTitle ?? getWorkspaceTabTitle(tab, panelState);
  const primaryDetail = getWorkspaceTabPrimaryDetail(tab, panelState);
  const counterpartLabel = tab.type === 'sftp' ? 'Open SSH Terminal' : 'Open SFTP Explorer';
  const isSessionConnectionTab =
    (tab.type === 'terminal' && Boolean(tab.session)) ||
    tab.type === 'sftp' ||
    tab.type === 'rdp';
  const canReconnect = isSessionConnectionTab && status !== 'queued' && status !== 'connecting';
  const canDisconnect =
    isSessionConnectionTab &&
    (status === 'connected' || status === 'connecting' || status === 'queued');

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={[
            'group grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded px-2 py-1.5',
            active ? 'bg-primary/10 text-slate-50' : 'text-slate-300 hover:bg-accent',
          ].join(' ')}
        >
          <button
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-left"
            type="button"
            onClick={onClick}
          >
            <WorkspaceTabIcon type={tab.type} />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-xs font-semibold">{title}</span>
              {primaryDetail && (
                <span className="truncate font-mono text-[10px] text-slate-400/90">
                  {primaryDetail}
                </span>
              )}
            </span>
          </button>
          <ConnectionStatusDot status={status} />
          <button
            className="grid size-5 place-items-center rounded text-slate-500 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            type="button"
            title="Close tab"
            aria-label="Close tab"
            onClick={(event) => {
              event.stopPropagation();
              onClose();
            }}
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{title}</ContextMenuLabel>
        <ContextMenuItem disabled={!canReconnect} onSelect={onReconnect}>
          {status === 'queued' ? 'Reconnect Queued' : 'Reconnect'}
        </ContextMenuItem>
        <ContextMenuItem disabled={!canDisconnect} onSelect={onDisconnect}>
          Disconnect
        </ContextMenuItem>
        <ContextMenuItem disabled={!tab.session} onSelect={onClone}>
          Clone Tab
        </ContextMenuItem>
        <ContextMenuItem disabled={!canOpenCounterpart} onSelect={onOpenCounterpart}>
          {counterpartLabel}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCloseOthers}>Close Others</ContextMenuItem>
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onClose}>
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function WorkspaceTabIcon({ type }: { type: WorkspacePanelType }) {
  const className = 'mt-0.5 size-3.5 text-primary';

  if (type === 'terminal') {
    return <Terminal className={className} />;
  }

  if (type === 'rdp') {
    return <Monitor className={className} />;
  }

  if (type === 'settings') {
    return <Settings className={className} />;
  }

  if (type === 'ai') {
    return <Bot className={className} />;
  }

  return <Folder className={className} />;
}
