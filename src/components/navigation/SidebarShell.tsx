import {
  Bot,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Folder,
  Monitor,
  PanelLeftClose,
  Settings,
  Terminal,
  UploadCloud,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import {
  subscribeConnectionStatus,
  type ConnectionStatus,
} from '@/features/connections/connectionStatus';
import { panelCatalog } from '@/features/panels/panelCatalog';
import {
  requestSftpSidebarDisconnect,
  requestSftpSidebarReconnect,
  requestSftpSidebarNavigation,
  subscribeSftpSidebarPanelStates,
  type SftpSidebarExplorer,
  type SftpSidebarPanelState,
} from '@/features/sftp/sftpSidebarState';
import { notifyTerminalClosing, notifyTerminalReconnect } from '@/features/terminal/terminalLifecycle';
import {
  SessionsView,
  SidebarPanelList,
  SidebarStaticList,
} from '@/features/sessions/components/SessionsView';
import { t } from '@/i18n';
import type { ActivityId, WorkspacePanel, WorkspacePanelType, WorkspaceTabItem } from '@/types/workspace';
import { getActivityDescription, getActivityTitle } from './activities';

export function SidebarShell({
  activeActivity,
  activePanelId,
  isCollapsed,
  onClosePanel,
  onAddPanel,
  onClonePanel,
  onSelectPanel,
  sftpExplorers,
  workspaceTabs,
  onToggle,
}: {
  activeActivity: ActivityId;
  activePanelId?: string;
  isCollapsed: boolean;
  onClosePanel: (panelId: string) => void;
  onAddPanel: (panel: WorkspacePanel) => void;
  onClonePanel: (tab: WorkspaceTabItem, path?: string) => void;
  onSelectPanel: (panelId: string) => void;
  sftpExplorers: SftpSidebarExplorer[];
  workspaceTabs: WorkspaceTabItem[];
  onToggle: () => void;
}) {
  if (isCollapsed) {
    return null;
  }

  return (
    <aside className="flex min-w-0 flex-col gap-4 border-r bg-card p-4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-slate-50">{getActivityTitle(activeActivity)}</h1>
          <p className="truncate text-xs font-medium text-slate-400">
            {getActivityDescription(activeActivity)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t('sidebar.collapse')}
          onClick={onToggle}
        >
          <PanelLeftClose />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarContent
          activeActivity={activeActivity}
          activePanelId={activePanelId}
          onClosePanel={onClosePanel}
          onAddPanel={onAddPanel}
          onClonePanel={onClonePanel}
          onSelectPanel={onSelectPanel}
          sftpExplorers={sftpExplorers}
          workspaceTabs={workspaceTabs}
        />
      </div>
    </aside>
  );
}

function SidebarContent({
  activeActivity,
  activePanelId,
  onClosePanel,
  onAddPanel,
  onClonePanel,
  onSelectPanel,
  sftpExplorers,
  workspaceTabs,
}: {
  activeActivity: ActivityId;
  activePanelId?: string;
  onClosePanel: (panelId: string) => void;
  onAddPanel: (panel: WorkspacePanel) => void;
  onClonePanel: (tab: WorkspaceTabItem, path?: string) => void;
  onSelectPanel: (panelId: string) => void;
  sftpExplorers: SftpSidebarExplorer[];
  workspaceTabs: WorkspaceTabItem[];
}) {
  if (activeActivity === 'sessions') {
    return <SessionsView onAddPanel={onAddPanel} />;
  }

  if (activeActivity === 'files') {
    return (
      <SftpSidebar
        activePanelId={activePanelId}
        explorers={sftpExplorers}
        onClonePanel={onClonePanel}
        onClosePanel={onClosePanel}
        onSelectPanel={onSelectPanel}
      />
    );
  }

  if (activeActivity === 'tabs') {
    return (
      <WorkspaceTabsSidebar
        activePanelId={activePanelId}
        onAddPanel={onAddPanel}
        onClonePanel={onClonePanel}
        onClosePanel={onClosePanel}
        onSelectPanel={onSelectPanel}
        workspaceTabs={workspaceTabs}
      />
    );
  }

  if (activeActivity === 'ai') {
    return (
      <SidebarPanelList
        items={[
          { label: 'AI Assistant', panel: panelCatalog[1] },
          { label: 'Command Diagnosis', panel: panelCatalog[1] },
          { label: 'Provider Settings', panel: panelCatalog[1] },
        ]}
        onAddPanel={onAddPanel}
      />
    );
  }

  if (activeActivity === 'logs') {
    return <SidebarStaticList items={['Terminal History', 'Transfer Logs', 'AI Conversations']} />;
  }

  return <SidebarStaticList items={['General', 'Credentials', 'AI Providers']} />;
}

function SftpSidebar({
  activePanelId,
  explorers,
  onClonePanel,
  onClosePanel,
  onSelectPanel,
}: {
  activePanelId?: string;
  explorers: SftpSidebarExplorer[];
  onClonePanel: (tab: WorkspaceTabItem, path?: string) => void;
  onClosePanel: (panelId: string) => void;
  onSelectPanel: (panelId: string) => void;
}) {
  const [panelStates, setPanelStates] = useState<Record<string, SftpSidebarPanelState>>({});
  const [bookmarks, setBookmarks] = useState<SftpBookmark[]>(() => loadSftpBookmarks());
  const [showAllExplorers, setShowAllExplorers] = useState(() =>
    loadBooleanPreference(sftpShowAllExplorersStorageKey, false),
  );
  const groupedExplorers = useMemo(
    () => groupSftpExplorers(explorers, panelStates),
    [explorers, panelStates],
  );
  const visibleExplorers = showAllExplorers ? groupedExplorers : groupedExplorers.slice(0, 4);
  const activeExplorer = useMemo(
    () => explorers.find((explorer) => panelStates[explorer.panelId]?.status === 'connected') ?? explorers[0],
    [explorers, panelStates],
  );
  const transferSummary = useMemo(
    () =>
      explorers.reduce(
        (summary, explorer) => {
          const next = panelStates[explorer.panelId]?.transferSummary;

          if (!next) {
            return summary;
          }

          return {
            canceled: summary.canceled + next.canceled,
            completed: summary.completed + next.completed,
            failed: summary.failed + next.failed,
            running: summary.running + next.running,
            total: summary.total + next.total,
          };
        },
        { canceled: 0, completed: 0, failed: 0, running: 0, total: 0 },
      ),
    [explorers, panelStates],
  );

  useEffect(() => subscribeSftpSidebarPanelStates(setPanelStates), []);

  const saveBookmarks = (nextBookmarks: SftpBookmark[]) => {
    setBookmarks(nextBookmarks);
    window.localStorage.setItem(sftpBookmarksStorageKey, JSON.stringify(nextBookmarks));
  };

  const addExplorerBookmark = (explorer: SftpSidebarExplorer) => {
    const path = panelStates[explorer.panelId]?.path;

    if (!path) {
      return;
    }

    const bookmark: SftpBookmark = {
      host: explorer.host,
      id: `${explorer.panelId}:${path}:${Date.now()}`,
      path,
      title: explorer.session?.name ?? panelStates[explorer.panelId]?.title ?? explorer.title,
      username: explorer.username,
    };
    const exists = bookmarks.some(
      (item) => item.path === bookmark.path && item.host === bookmark.host && item.username === bookmark.username,
    );

    if (exists) {
      return;
    }

    saveBookmarks([bookmark, ...bookmarks].slice(0, 24));
  };
  const addCurrentPathBookmark = () => {
    if (activeExplorer) {
      addExplorerBookmark(activeExplorer);
    }
  };
  const cloneExplorer = (explorer: SftpSidebarExplorer) => {
    if (!explorer.session) {
      return;
    }

    onClonePanel(
      {
        id: explorer.panelId,
        session: explorer.session,
        title: explorer.title,
        type: 'sftp',
      },
      panelStates[explorer.panelId]?.path,
    );
  };
  const copyRemotePath = (path?: string) => {
    if (path) {
      void navigator.clipboard?.writeText(path);
    }
  };

  const openBookmark = (bookmark: SftpBookmark) => {
    const target =
      explorers.find(
        (explorer) =>
          explorer.host === bookmark.host &&
          (!bookmark.username || explorer.username === bookmark.username),
      ) ?? activeExplorer;

    if (!target) {
      return;
    }

    onSelectPanel(target.panelId);
    requestSftpSidebarNavigation(target.panelId, bookmark.path);
  };

  const removeBookmark = (bookmarkId: string) => {
    saveBookmarks(bookmarks.filter((bookmark) => bookmark.id !== bookmarkId));
  };
  const toggleShowAllExplorers = () => {
    setShowAllExplorers((current) => {
      const next = !current;

      saveBooleanPreference(sftpShowAllExplorersStorageKey, next);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Explorers</h2>
          <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            {groupedExplorers.length}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <OverlayScrollArea>
            <div className="grid gap-1 pr-2">
              {groupedExplorers.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-slate-500">
                  Open SFTP from an SSH tab or session.
                </div>
              ) : (
                <>
                  {visibleExplorers.map((explorer) => (
                    <SftpExplorerButton
                      active={explorer.primary.panelId === activePanelId}
                      explorer={explorer.primary}
                      key={explorer.panelId}
                      count={explorer.count}
                      onAddBookmark={() => addExplorerBookmark(explorer.primary)}
                      onClone={() => cloneExplorer(explorer.primary)}
                      onClose={() => onClosePanel(explorer.primary.panelId)}
                      onClick={() => onSelectPanel(explorer.primary.panelId)}
                      onCopyPath={() => copyRemotePath(explorer.state?.path)}
                      onReconnect={() => requestSftpSidebarReconnect(explorer.primary.panelId)}
                      state={explorer.state}
                    />
                  ))}
                  {groupedExplorers.length > 4 && (
                    <button
                      className="rounded-md border border-border/70 px-3 py-1.5 text-left text-xs text-slate-400 hover:border-primary/40 hover:bg-accent hover:text-slate-200"
                      type="button"
                      onClick={toggleShowAllExplorers}
                    >
                      {showAllExplorers ? 'Show fewer explorers' : `Show ${groupedExplorers.length - 4} more explorers`}
                    </button>
                  )}
                </>
              )}
            </div>
          </OverlayScrollArea>
        </div>
      </section>

      <button
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border/80 bg-background/35 px-3 py-2 text-left hover:border-primary/40 hover:bg-accent"
        type="button"
        onClick={() => onSelectPanel('sftp-transfer-queue')}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <UploadCloud className="size-4 text-primary" />
            Transfer Queue
          </div>
          <span
            className={[
              'rounded border px-1.5 py-0.5 font-mono text-[10px]',
              transferSummary.failed > 0
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-border/80 text-slate-400',
            ].join(' ')}
          >
            {formatTransferSummary(transferSummary)}
          </span>
        </div>
      </button>

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remote Bookmarks</h2>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            title="Add current path"
            aria-label="Add current path"
            disabled={!activeExplorer || !panelStates[activeExplorer.panelId]?.path}
            onClick={addCurrentPathBookmark}
          >
            <BookmarkPlus className="size-4" />
            Current
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <OverlayScrollArea>
            <div className="grid gap-1 pr-2">
              {bookmarks.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-slate-500">
                  Add a remote path from an open SFTP explorer.
                </div>
              ) : (
                bookmarks.map((bookmark) => (
                  <ContextMenu key={bookmark.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded px-2 py-1.5 hover:bg-accent"
                      >
                        <button
                          className="grid min-w-0 gap-0.5 text-left text-xs"
                          type="button"
                          title="Double-click to open this remote path"
                          onDoubleClick={() => openBookmark(bookmark)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              openBookmark(bookmark);
                            }
                          }}
                        >
                          <span className="truncate text-xs font-semibold text-slate-200">
                            {getRemotePathTitle(bookmark.path)}
                          </span>
                          <span className="truncate font-mono text-[10px] text-slate-400/90">
                            {formatSftpExplorerTarget(bookmark)}
                          </span>
                          <span className="truncate font-mono text-[10px] text-slate-500/80">
                            {formatRemotePath(bookmark.path)}
                          </span>
                        </button>
                        <button
                          className="grid size-5 place-items-center rounded text-slate-500 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          type="button"
                          title="Remove bookmark"
                          aria-label="Remove bookmark"
                          onClick={() => removeBookmark(bookmark.id)}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuLabel>{getRemotePathTitle(bookmark.path)}</ContextMenuLabel>
                      <ContextMenuItem onSelect={() => openBookmark(bookmark)}>Open</ContextMenuItem>
                      <ContextMenuItem onSelect={() => copyRemotePath(bookmark.path)}>Copy Path</ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => removeBookmark(bookmark.id)}
                      >
                        Remove Bookmark
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                ))
              )}
            </div>
          </OverlayScrollArea>
        </div>
      </section>
    </div>
  );
}

function SftpExplorerButton({
  active,
  count,
  explorer,
  onAddBookmark,
  onClone,
  onClick,
  onClose,
  onCopyPath,
  onReconnect,
  state,
}: {
  active: boolean;
  count: number;
  explorer: SftpSidebarExplorer;
  onAddBookmark: () => void;
  onClone: () => void;
  onClick: () => void;
  onClose: () => void;
  onCopyPath: () => void;
  onReconnect: () => void;
  state?: SftpSidebarPanelState;
}) {
  const path = state?.path ?? 'Home';

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={[
            'group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded px-2 py-1.5',
            active ? 'bg-primary/10 text-slate-50' : 'text-slate-300 hover:bg-accent',
          ].join(' ')}
        >
          <button
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-left"
            type="button"
            onClick={onClick}
          >
            <Folder className="mt-0.5 size-3.5 text-primary" />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-xs font-semibold">{getRemotePathTitle(path)}</span>
              <span className="truncate font-mono text-[10px] text-slate-400/90">
                {formatSftpExplorerTarget(explorer)}
              </span>
              <span className="truncate font-mono text-[10px] text-slate-500/80">
                {formatRemotePath(path)}
              </span>
            </span>
          </button>
          <span className="flex items-center gap-1">
            {count > 1 && (
              <span className="rounded border border-border/60 px-1 font-mono text-[10px] text-slate-500">
                {count}
              </span>
            )}
            <span
              className={[
                'size-2 rounded-full',
                state?.status === 'connected'
                  ? 'bg-emerald-400'
                  : state?.status === 'connecting'
                    ? 'bg-sky-400'
                    : state?.status === 'failed'
                      ? 'bg-destructive'
                      : 'bg-slate-600',
              ].join(' ')}
              title={state?.status ?? 'restored'}
            />
            <button
              className="grid size-5 place-items-center rounded text-slate-500 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              type="button"
              title="Close SFTP tab"
              aria-label="Close SFTP tab"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{getRemotePathTitle(path)}</ContextMenuLabel>
        <ContextMenuItem onSelect={onClick}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={onReconnect}>Reconnect</ContextMenuItem>
        <ContextMenuItem disabled={!explorer.session} onSelect={onClone}>
          Clone Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!state?.path} onSelect={onAddBookmark}>
          Add Bookmark
        </ContextMenuItem>
        <ContextMenuItem disabled={!state?.path} onSelect={onCopyPath}>
          Copy Path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onClose}>
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function WorkspaceTabsSidebar({
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
    if (tab.type === 'terminal') {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'queued' }));
      notifyTerminalReconnect(tab.id);
      return;
    }

    if (tab.type === 'sftp') {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'queued' }));
      requestSftpSidebarReconnect(tab.id);
    }
  };
  const disconnectTab = (tab: WorkspaceTabItem) => {
    if (tab.type === 'terminal') {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'closed' }));
      notifyTerminalClosing(tab.id);
      return;
    }

    if (tab.type === 'sftp') {
      setConnectionStates((current) => ({ ...current, [tab.id]: 'closed' }));
      requestSftpSidebarDisconnect(tab.id);
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
  const canReconnect = (tab.type === 'terminal' || tab.type === 'sftp') && status !== 'queued' && status !== 'connecting';
  const canDisconnect =
    (tab.type === 'terminal' || tab.type === 'sftp') &&
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

function ConnectionStatusDot({
  className = '',
  status,
}: {
  className?: string;
  status?: WorkspaceTabVisualStatus;
}) {
  const normalizedStatus = status ?? 'restored';

  return (
    <span
      className={[
        'size-2 rounded-full',
        normalizedStatus === 'connected'
          ? 'bg-emerald-400'
          : normalizedStatus === 'connecting'
            ? 'bg-sky-400'
            : normalizedStatus === 'queued'
              ? 'bg-amber-400'
              : normalizedStatus === 'failed'
                ? 'bg-destructive'
                : normalizedStatus === 'closed'
                  ? 'bg-slate-700'
                  : 'bg-slate-600',
        className,
      ].join(' ')}
      title={formatConnectionStatusLabel(normalizedStatus)}
    />
  );
}

interface SftpBookmark {
  host?: string;
  id: string;
  path: string;
  title: string;
  username?: string;
}

interface GroupedSftpExplorer {
  count: number;
  panelId: string;
  primary: SftpSidebarExplorer;
  state?: SftpSidebarPanelState;
}

interface WorkspaceTabGroup {
  id: string;
  label: string;
  status?: WorkspaceTabVisualStatus;
  tabs: WorkspaceTabTreeItem[];
}

interface WorkspaceTabTreeItem {
  displayTitle?: string;
  status?: WorkspaceTabVisualStatus;
  tab: WorkspaceTabItem;
}

type WorkspaceTabVisualStatus = ConnectionStatus | 'queued';

const sftpBookmarksStorageKey = 'shellpilot:sftp-bookmarks';
const sftpShowAllExplorersStorageKey = 'shellpilot:sftp-show-all-explorers';
const openTabsCollapsedGroupsStorageKey = 'shellpilot:open-tabs-collapsed-groups';

function loadSftpBookmarks(): SftpBookmark[] {
  return loadSftpPathCollection(sftpBookmarksStorageKey);
}

function loadBooleanPreference(storageKey: string, fallback: boolean) {
  try {
    const storedValue = window.localStorage.getItem(storageKey);

    if (storedValue === null) {
      return fallback;
    }

    return storedValue === 'true';
  } catch {
    return fallback;
  }
}

function saveBooleanPreference(storageKey: string, value: boolean) {
  window.localStorage.setItem(storageKey, String(value));
}

function loadStringSetPreference(storageKey: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');

    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set<string>();
  }
}

function saveStringSetPreference(storageKey: string, value: Set<string>) {
  window.localStorage.setItem(storageKey, JSON.stringify(Array.from(value)));
}

function loadSftpPathCollection(storageKey: string): SftpBookmark[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSftpBookmark);
  } catch {
    return [];
  }
}

function isSftpBookmark(value: unknown): value is SftpBookmark {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'path' in value &&
      'title' in value &&
      typeof (value as SftpBookmark).id === 'string' &&
      typeof (value as SftpBookmark).path === 'string' &&
      typeof (value as SftpBookmark).title === 'string',
  );
}

function formatSftpExplorerTarget(target: Pick<SftpBookmark, 'host' | 'title' | 'username'>) {
  return formatRemoteTargetLabel({
    host: target.host,
    title: target.title,
    username: target.username,
  });
}

function getWorkspaceTabTitle(tab: WorkspaceTabItem, panelState?: SftpSidebarPanelState) {
  if (tab.type === 'sftp') {
    return getRemotePathTitle(panelState?.path ?? tab.title);
  }

  if (tab.type === 'terminal' && tab.session) {
    return tab.session.name;
  }

  return tab.title;
}

function getWorkspaceTabPrimaryDetail(tab: WorkspaceTabItem, panelState?: SftpSidebarPanelState) {
  if (tab.type === 'sftp') {
    return formatRemotePath(panelState?.path ?? '');
  }

  if (tab.type === 'terminal') {
    return tab.session?.kind && tab.session.kind !== 'ssh' ? tab.session.kind : '';
  }

  return '';
}

function getWorkspaceTabGroupKey(tab: WorkspaceTabItem, panelState?: SftpSidebarPanelState) {
  const username = panelState?.username ?? tab.session?.username ?? '';
  const host = panelState?.host ?? tab.session?.host;

  if (host) {
    return {
      id: `server:${username}@${host}`,
      label: formatRemoteTargetLabel({
        host,
        title: panelState?.title ?? tab.session?.name,
        username,
      }),
    };
  }

  return {
    id: `workspace:${tab.type}`,
    label: getWorkspaceTabTypeLabel(tab.type),
  };
}

function groupWorkspaceTabs(
  tabs: WorkspaceTabItem[],
  panelStates: Record<string, SftpSidebarPanelState>,
  connectionStates: Record<string, WorkspaceTabVisualStatus>,
): WorkspaceTabGroup[] {
  const groups = new Map<string, WorkspaceTabGroup>();
  const terminalCountsByGroup = new Map<string, number>();

  for (const tab of tabs) {
    const groupKey = getWorkspaceTabGroupKey(tab, panelStates[tab.id]);
    const status = getWorkspaceTabStatus(tab, panelStates[tab.id], connectionStates[tab.id]);
    const displayTitle = getWorkspaceTabTreeDisplayTitle(
      tab,
      groupKey.id,
      terminalCountsByGroup,
    );
    const currentGroup = groups.get(groupKey.id);
    const groupItem = { displayTitle, status, tab };

    if (currentGroup) {
      currentGroup.tabs.push(groupItem);
      currentGroup.status = summarizeConnectionStatus(currentGroup.tabs.map((item) => item.status));
      continue;
    }

    groups.set(groupKey.id, {
      id: groupKey.id,
      label: groupKey.label,
      status,
      tabs: [groupItem],
    });
  }

  return Array.from(groups.values());
}

function getWorkspaceTabStatus(
  tab: WorkspaceTabItem,
  panelState?: SftpSidebarPanelState,
  connectionStatus?: WorkspaceTabVisualStatus,
) {
  if (connectionStatus) {
    return connectionStatus;
  }

  if (tab.type === 'sftp') {
    return panelState?.status ?? 'restored';
  }

  if (tab.type === 'terminal') {
    return 'restored';
  }

  return 'idle';
}

function summarizeConnectionStatus(statuses: Array<WorkspaceTabVisualStatus | undefined>) {
  if (statuses.includes('connected')) {
    return 'connected';
  }

  if (statuses.includes('connecting')) {
    return 'connecting';
  }

  if (statuses.includes('queued')) {
    return 'queued';
  }

  if (statuses.includes('failed')) {
    return 'failed';
  }

  if (statuses.includes('restored')) {
    return 'restored';
  }

  if (statuses.includes('closed')) {
    return 'closed';
  }

  return 'idle';
}

function getWorkspaceTabTreeDisplayTitle(
  tab: WorkspaceTabItem,
  groupId: string,
  terminalCountsByGroup: Map<string, number>,
) {
  if (tab.type !== 'terminal') {
    return undefined;
  }

  const terminalCount = (terminalCountsByGroup.get(groupId) ?? 0) + 1;

  terminalCountsByGroup.set(groupId, terminalCount);

  if (tab.session?.kind === 'ssh') {
    return terminalCount === 1 ? 'SSH Terminal' : `SSH Terminal ${terminalCount}`;
  }

  const baseTitle = getWorkspaceTabTypeLabel(tab.type);
  return terminalCount === 1 ? baseTitle : `${baseTitle} ${terminalCount}`;
}

function getWorkspaceTabTypeLabel(type: WorkspacePanelType) {
  if (type === 'terminal') {
    return 'Terminal';
  }

  if (type === 'sftp') {
    return 'SFTP';
  }

  if (type === 'rdp') {
    return 'RDP';
  }

  if (type === 'settings') {
    return 'Settings';
  }

  return 'AI';
}

function formatRemoteTargetLabel({
  host,
  title,
  username,
}: {
  host?: string;
  title?: string;
  username?: string;
}) {
  const endpoint = host ? `${username ? `${username}@` : ''}${host}` : '';
  const alias = normalizeRemoteAlias(title);

  if (alias && endpoint && !isConnectionAlias(alias, endpoint, host)) {
    return `${alias} (${endpoint})`;
  }

  if (endpoint) {
    return endpoint;
  }

  return alias || 'Unknown host';
}

function normalizeRemoteAlias(title?: string) {
  return title?.replace(/^SFTP\s+-\s+/i, '').trim() ?? '';
}

function isConnectionAlias(alias: string, endpoint: string, host?: string) {
  const normalizedAlias = alias.toLowerCase();

  return normalizedAlias === endpoint.toLowerCase() || normalizedAlias === host?.toLowerCase();
}

function getRemotePathTitle(path: string) {
  if (!path || path === '.' || path === 'Home') {
    return 'Home';
  }

  const normalizedPath = path.replace(/\\/g, '/').replace(/\/+$/g, '');
  const lastSegment = normalizedPath.split('/').filter(Boolean).pop();

  return lastSegment || '/';
}

function formatRemotePath(path: string) {
  if (!path || path === '.') {
    return 'Home';
  }

  return path;
}

function formatTransferSummary(summary: {
  canceled: number;
  completed: number;
  failed: number;
  running: number;
  total: number;
}) {
  if (summary.failed > 0) {
    return `${summary.failed} failed`;
  }

  if (summary.running > 0) {
    return `${summary.running} running`;
  }

  if (summary.total === 0) {
    return 'idle';
  }

  if (summary.canceled > 0) {
    return `${summary.canceled} stopped`;
  }

  return `${summary.completed} done`;
}

function formatConnectionStatusLabel(status: WorkspaceTabVisualStatus) {
  if (status === 'connected') {
    return 'Connected';
  }

  if (status === 'connecting') {
    return 'Connecting';
  }

  if (status === 'queued') {
    return 'Reconnect queued';
  }

  if (status === 'failed') {
    return 'Failed';
  }

  if (status === 'closed') {
    return 'Disconnected';
  }

  if (status === 'idle') {
    return 'Idle';
  }

  return 'Restored';
}

function groupSftpExplorers(
  explorers: SftpSidebarExplorer[],
  panelStates: Record<string, SftpSidebarPanelState>,
): GroupedSftpExplorer[] {
  const grouped = new Map<string, GroupedSftpExplorer>();

  for (const explorer of explorers) {
    const state = panelStates[explorer.panelId];
    const groupKey = [
      explorer.host ?? explorer.title,
      explorer.username ?? '',
      state?.path ?? '',
    ].join('\u0000');
    const current = grouped.get(groupKey);

    if (current) {
      current.count += 1;
      if (state?.status === 'connected' && current.state?.status !== 'connected') {
        current.panelId = explorer.panelId;
        current.primary = explorer;
        current.state = state;
      }
      continue;
    }

    grouped.set(groupKey, {
      count: 1,
      panelId: explorer.panelId,
      primary: explorer,
      state,
    });
  }

  return Array.from(grouped.values());
}
