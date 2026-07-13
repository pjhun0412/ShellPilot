import { Plus, Search, Terminal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { PanelIcon } from '@/features/panels/PanelIcon';
import { panelCatalog } from '@/features/panels/panelCatalog';
import { getLocalTerminalProfile } from '@/features/terminal/localTerminalProfiles';
import { loadPreferences, subscribePreferences } from '@/features/settings/appPreferences';
import { loadSessionUiState, saveSessionUiState } from '@/features/sessions/sessionStorage';
import { useSessionRegistry } from '@/features/sessions/useSessionRegistry';
import { t } from '@/i18n';
import type { SessionGroup, SessionItem, WorkspacePanel } from '@/types/workspace';
import { CreateSessionDialog, type CreateSessionResult } from './CreateSessionDialog';
import { SessionTree } from './SessionTree';

type SessionFilter = 'all' | 'ssh' | 'file' | 'rdp' | 'vnc' | 'favorites';

const sessionFilters: Array<{ id: SessionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ssh', label: 'SSH' },
  { id: 'file', label: 'Files' },
  { id: 'rdp', label: 'RDP' },
  { id: 'vnc', label: 'VNC' },
  { id: 'favorites', label: 'Favorites' },
];

export function SessionsView({ onAddPanel }: { onAddPanel: (panel: WorkspacePanel) => void }) {
  const [activeFilter, setActiveFilter] = useState<SessionFilter>('all');
  const [query, setQuery] = useState('');
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(loadSessionUiState().collapsedGroupIds),
  );
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDialogGroupId, setCreateDialogGroupId] = useState<string | undefined>();
  const [editingSession, setEditingSession] = useState<SessionItem | undefined>();
  const [preferences, setPreferences] = useState(() => loadPreferences());
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
  const [treeMenu, setTreeMenu] = useState<{ x: number; y: number }>();
  const {
    createFolder,
    deleteFolder,
    deleteSession,
    duplicateSession,
    groups,
    moveGroup,
    moveSession,
    renameFolder,
    saveSession,
    selectedSessionId,
    setSelectedSessionId,
  } = useSessionRegistry({
    onCreateSession: (session) => {
      setSelectedGroupId(undefined);
      setSelectedSessionId(session.id);
    },
  });
  const filteredGroups = useMemo(
    () => filterSessionGroups(groups, activeFilter, query),
    [activeFilter, groups, query],
  );
  const defaultLocalTerminalProfile = getLocalTerminalProfile(preferences.terminal.localTerminalProfileId);

  useEffect(() => subscribePreferences(setPreferences), []);

  useEffect(() => {
    if (!treeMenu) {
      return;
    }

    const closeMenu = () => setTreeMenu(undefined);
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeMenuOnEscape);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [treeMenu]);

  useEffect(() => {
    const groupIds = new Set(groups.map((group) => group.id));
    const nextCollapsedGroupIds = [...collapsedGroupIds].filter((groupId) => groupIds.has(groupId));

    saveSessionUiState({
      collapsedGroupIds: nextCollapsedGroupIds,
    });

    if (nextCollapsedGroupIds.length !== collapsedGroupIds.size) {
      setCollapsedGroupIds(new Set(nextCollapsedGroupIds));
    }
  }, [collapsedGroupIds, groups]);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);

      if (next.has(groupId)) {
        next.delete(groupId);
        return next;
      }

      next.add(groupId);
      return next;
    });
  };
  const openCreateDialog = (groupId?: string) => {
    setEditingSession(undefined);
    setCreateDialogGroupId(groupId);
    setSelectedGroupId(groupId);
    setIsCreateDialogOpen(true);
  };
  const openEditDialog = (session: SessionItem) => {
    setEditingSession(session);
    setCreateDialogGroupId(session.groupId);
    setIsCreateDialogOpen(true);
  };
  const setCreateDialogOpen = (nextOpen: boolean) => {
    setIsCreateDialogOpen(nextOpen);

    if (!nextOpen) {
      setCreateDialogGroupId(undefined);
      setEditingSession(undefined);
    }
  };
  const submitSession = (result: CreateSessionResult) => saveSession(result, editingSession);
  const openSession = (session: SessionItem) => {
    setSelectedGroupId(undefined);
    setSelectedSessionId(session.id);
    openPanelForSession(session);
  };
  const openSftpSession = (session: SessionItem) => {
    if (session.kind !== 'ssh' && session.kind !== 'sftp') {
      return;
    }

    setSelectedGroupId(undefined);
    setSelectedSessionId(session.id);
    onAddPanel({
      id: `sftp-${session.id}`,
      session,
      title: `SFTP - ${session.name}`,
      type: 'sftp',
    });
  };
  const selectSession = (sessionId: string) => {
    setSelectedGroupId(undefined);
    setSelectedSessionId(sessionId);
  };
  const openPanelForSession = (session: SessionItem) => {
    const panel = getPanelForSession(session);

    if (panel) {
      onAddPanel(panel);
    }
  };
  const openTreeContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as Element).closest('[data-session-tree-item="true"]')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setTreeMenu({ x: event.clientX, y: event.clientY });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden" onContextMenu={openTreeContextMenu}>
      <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2">
        <label className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="h-9 w-full rounded-md border bg-background/70 pl-9 pr-3 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={t('session.search')}
            placeholder={t('session.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <Button
          type="button"
          size="icon"
          aria-label="Create session"
          title="Create session"
          onClick={() => openCreateDialog()}
        >
          <Plus />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1">
        {sessionFilters.map((filter) => (
          <button
            className={[
              'rounded border px-2.5 py-0.5 text-[11px] font-semibold transition-colors',
              activeFilter === filter.id
                ? 'border-teal-400 bg-teal-500 text-slate-950 shadow-[0_0_0_1px_hsl(var(--primary)/0.22)]'
                : 'border-slate-800 bg-slate-950/45 text-slate-400 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-100',
            ].join(' ')}
            type="button"
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <button
        className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950/45 px-3 py-2 text-left text-xs font-semibold text-slate-200 transition-colors hover:border-slate-700 hover:bg-slate-900"
        type="button"
        onClick={() => {
          onAddPanel({
            id: `local-terminal-${crypto.randomUUID()}`,
            localPtyTarget: defaultLocalTerminalProfile.target,
            title: defaultLocalTerminalProfile.title,
            type: 'terminal',
          });
        }}
      >
        <Terminal className="size-4 text-primary" />
        <span className="min-w-0 flex-1">Open Local Terminal</span>
        <span className="truncate text-[11px] text-slate-500">{defaultLocalTerminalProfile.label}</span>
      </button>

      <SessionTree
        collapsedGroupIds={collapsedGroupIds}
        groups={filteredGroups}
        selectedGroupId={selectedGroupId}
        selectedSessionId={selectedSessionId}
        onCreateFolder={createFolder}
        onCreateSession={openCreateDialog}
        onDeleteFolder={(group) => void deleteFolder(group)}
        onDeleteSession={deleteSession}
        onDuplicateSession={duplicateSession}
        onEditSession={openEditDialog}
        onMoveGroup={moveGroup}
        onMoveSession={moveSession}
        onOpenSession={openSession}
        onOpenSftpSession={openSftpSession}
        onRenameFolder={renameFolder}
        onSelectGroup={setSelectedGroupId}
        onSelectSession={selectSession}
        onTreeContextMenu={openTreeContextMenu}
        onToggleGroup={toggleGroup}
      />
      {treeMenu && (
        <SessionTreeBlankMenu
          x={treeMenu.x}
          y={treeMenu.y}
          onCreateFolder={() => {
            createFolder();
            setTreeMenu(undefined);
          }}
          onCreateSession={() => {
            openCreateDialog();
            setTreeMenu(undefined);
          }}
        />
      )}

      <CreateSessionDialog
        existingGroups={groups}
        initialGroupId={createDialogGroupId}
        initialSession={editingSession}
        open={isCreateDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateSession={submitSession}
      />
    </div>
  );
}

function SessionTreeBlankMenu({
  onCreateFolder,
  onCreateSession,
  x,
  y,
}: {
  onCreateFolder: () => void;
  onCreateSession: () => void;
  x: number;
  y: number;
}) {
  return (
    <div
      className="fixed z-50 min-w-44 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-xl"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="px-2 py-1.5 text-[11px] font-semibold text-muted-foreground">Sessions</div>
      <SessionTreeMenuButton onClick={onCreateSession}>
        New Session
        <span className="ml-auto text-[10px] tracking-widest text-muted-foreground">Ctrl+N</span>
      </SessionTreeMenuButton>
      <SessionTreeMenuButton onClick={onCreateFolder}>New Folder</SessionTreeMenuButton>
      <div className="-mx-1 my-1 h-px bg-border" />
      <SessionTreeMenuButton disabled onClick={() => undefined}>Import Sessions</SessionTreeMenuButton>
      <SessionTreeMenuButton disabled onClick={() => undefined}>Export Sessions</SessionTreeMenuButton>
    </div>
  );
}

function SessionTreeMenuButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function SidebarPanelList({
  items,
  onAddPanel,
}: {
  items: Array<{ label: string; panel: WorkspacePanel }>;
  onAddPanel: (panel: WorkspacePanel) => void;
}) {
  return (
    <div className="grid content-start gap-2">
      {items.map((item) => (
        <button
          className="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          type="button"
          key={item.label}
          onClick={() => onAddPanel(item.panel)}
        >
          <PanelIcon type={item.panel.type} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function SidebarStaticList({ items }: { items: string[] }) {
  return (
    <div className="grid content-start gap-2">
      {items.map((item) => (
        <button
          className="rounded-md border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          type="button"
          key={item}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function getPanelForSession(session: SessionItem): WorkspacePanel | undefined {
  if (session.kind === 'ssh') {
    return {
      id: session.id,
      session,
      title: `SSH - ${session.name}`,
      type: 'terminal',
    };
  }

  if (session.kind === 'rdp') {
    return {
      id: session.id,
      session,
      title: `RDP - ${session.name}`,
      type: 'rdp',
    };
  }

  if (session.kind === 'vnc') {
    return {
      id: session.id,
      session,
      title: `VNC - ${session.name}`,
      type: 'vnc',
    };
  }

  if (session.kind === 'sftp') {
    return {
      id: session.id,
      session,
      title: `SFTP - ${session.name}`,
      type: 'sftp',
    };
  }

  return undefined;
}

function filterSessionGroups(
  groups: SessionGroup[],
  filter: SessionFilter,
  query: string,
): SessionGroup[] {
  const normalizedQuery = query.trim().toLowerCase();
  const shouldKeepEmptyGroups = filter === 'all' && normalizedQuery.length === 0;

  return groups
    .map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => {
        const matchesFilter = matchesSessionFilter(session, filter);
        const matchesQuery =
          normalizedQuery.length === 0 ||
          [session.name, session.host, session.kind, ...(session.tags ?? [])]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(normalizedQuery));

        return matchesFilter && matchesQuery;
      }),
    }))
    .filter((group) => shouldKeepEmptyGroups || group.sessions.length > 0);
}

function matchesSessionFilter(session: SessionItem, filter: SessionFilter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'favorites') {
    return Boolean(session.favorite);
  }

  if (filter === 'file') {
    return session.kind === 'sftp' || session.kind === 'ftp';
  }

  return session.kind === filter;
}
