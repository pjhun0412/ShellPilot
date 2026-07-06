import { ChevronDown, ChevronRight, Folder, FolderOpen, PanelLeftClose, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { PanelIcon } from '@/features/panels/PanelIcon';
import { panelCatalog } from '@/features/panels/panelCatalog';
import { CreateSessionDialog, type CreateSessionResult } from '@/features/sessions/components/CreateSessionDialog';
import { savePendingCredentialSecret } from '@/features/sessions/credentialStore';
import {
  appendSessionToRegistry,
  createSessionGroup,
  loadSessionGroups,
  loadSessionGroupsWithMigration,
  persistSessionGroups,
} from '@/features/sessions/sessionStorage';
import { t } from '@/i18n';
import type { ActivityId, SessionGroup, SessionItem, SessionKind, WorkspacePanel } from '@/types/workspace';
import { getActivityDescription, getActivityTitle } from './activities';
import { SessionButton } from './SessionButton';

export function Sidebar({
  activeActivity,
  isCollapsed,
  onAddPanel,
  onToggle,
}: {
  activeActivity: ActivityId;
  isCollapsed: boolean;
  onAddPanel: (panel: WorkspacePanel) => void;
  onToggle: () => void;
}) {
  if (isCollapsed) {
    return null;
  }

  return (
    <aside className="flex min-w-0 flex-col gap-4 border-r bg-card/90 p-4 backdrop-blur-xl">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold">{getActivityTitle(activeActivity)}</h1>
          <p className="truncate text-xs text-muted-foreground">
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

      <SidebarContent activeActivity={activeActivity} onAddPanel={onAddPanel} />
    </aside>
  );
}

function SidebarContent({
  activeActivity,
  onAddPanel,
}: {
  activeActivity: ActivityId;
  onAddPanel: (panel: WorkspacePanel) => void;
}) {
  if (activeActivity === 'sessions') {
    return <SessionsView onAddPanel={onAddPanel} />;
  }

  if (activeActivity === 'files') {
    return (
      <SidebarPanelList
        items={[
          { label: 'Open SFTP Explorer', panel: panelCatalog[2] },
          { label: 'Transfer Queue', panel: panelCatalog[2] },
          { label: 'Remote Bookmarks', panel: panelCatalog[2] },
        ]}
        onAddPanel={onAddPanel}
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

type SessionFilter = 'all' | 'ssh' | 'rdp' | 'local' | 'favorites';

const sessionFilters: Array<{ id: SessionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ssh', label: 'SSH' },
  { id: 'rdp', label: 'RDP' },
  { id: 'local', label: 'Local' },
  { id: 'favorites', label: 'Favorites' },
];

function SessionsView({ onAddPanel }: { onAddPanel: (panel: WorkspacePanel) => void }) {
  const initialGroups = useMemo(() => loadSessionGroups(), []);
  const [activeFilter, setActiveFilter] = useState<SessionFilter>('all');
  const [query, setQuery] = useState('');
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDialogGroupId, setCreateDialogGroupId] = useState<string | undefined>();
  const [editingSession, setEditingSession] = useState<SessionItem | undefined>();
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [groups, setGroups] = useState<SessionGroup[]>(initialGroups);
  const [isRegistryLoaded, setIsRegistryLoaded] = useState(false);
  const filteredGroups = useMemo(
    () => filterSessionGroups(groups, activeFilter, query),
    [activeFilter, groups, query],
  );

  useEffect(() => {
    let isMounted = true;

    void loadSessionGroupsWithMigration(initialGroups)
      .then((loadedGroups) => {
        if (!isMounted) {
          return;
        }

        setGroups(loadedGroups);
        setIsRegistryLoaded(true);
      })
      .catch((error: unknown) => {
        console.error('Failed to load session registry', error);
        if (isMounted) {
          setIsRegistryLoaded(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [initialGroups]);

  useEffect(() => {
    if (!isRegistryLoaded) {
      return;
    }

    void persistSessionGroups(groups).catch((error: unknown) => {
      console.error('Failed to persist session registry', error);
      window.alert(`Failed to save sessions.\n\n${error instanceof Error ? error.message : String(error)}`);
    });
  }, [groups, isRegistryLoaded]);

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
  const createFolder = () => {
    const nextIndex = groups.length + 1;
    setGroups((current) => [...current, createSessionGroup(`New Folder ${nextIndex}`)]);
  };
  const openCreateDialog = (groupId?: string) => {
    setEditingSession(undefined);
    setCreateDialogGroupId(groupId);
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
  const saveSession = async (result: CreateSessionResult) => {
    if (result.secret) {
      const didSaveCredential = await queueCredentialForBackend(result.secret);

      if (!didSaveCredential) {
        return;
      }
    }

    if (editingSession) {
      setGroups((current) =>
        updateSessionInRegistry({
          groups: current,
          newGroupName: result.groupName,
          previousSessionId: editingSession.id,
          session: result.session,
        }),
      );
      return;
    }

    setGroups((current) => {
      const nextGroups = appendSessionToRegistry({
        groups: current,
        newGroupName: result.groupName,
        session: result.session,
      });

      openSession(result.session);
      return nextGroups;
    });
  };
  const renameFolder = (group: SessionGroup) => {
    const nextName = window.prompt('Rename folder', group.name)?.trim();

    if (!nextName || nextName === group.name) {
      return;
    }

    setGroups((current) =>
      current.map((item) => (item.id === group.id ? { ...item, name: nextName } : item)),
    );
  };
  const deleteFolder = (group: SessionGroup) => {
    const hasSessions = group.sessions.length > 0;
    const message = hasSessions
      ? `Delete "${group.name}" and ${group.sessions.length} session(s)?`
      : `Delete "${group.name}"?`;

    if (!window.confirm(message)) {
      return;
    }

    setGroups((current) => current.filter((item) => item.id !== group.id));
  };
  const deleteSession = (session: SessionItem) => {
    if (!window.confirm(`Delete "${session.name}"?`)) {
      return;
    }

    if (selectedSessionId === session.id) {
      setSelectedSessionId(undefined);
    }

    setGroups((current) =>
      current.map((group) => ({
        ...group,
        sessions: group.sessions.filter((item) => item.id !== session.id),
      })),
    );
  };
  const duplicateSession = (session: SessionItem) => {
    const timestamp = Date.now();
    const duplicatedSessionId = `${session.kind}-${crypto.randomUUID()}`;

    setGroups((current) =>
      current.map((group) => {
        if (!group.sessions.some((item) => item.id === session.id)) {
          return group;
        }

        return {
          ...group,
          sessions: [
            ...group.sessions,
            {
              ...session,
              id: duplicatedSessionId,
              name: `${session.name} Copy`,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        };
      }),
    );
  };
  const openSession = (session: SessionItem) => {
    setSelectedSessionId(session.id);
    const panel = getPanelForSession(session);

    if (panel) {
      onAddPanel(panel);
    }
  };

  return (
    <>
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
              'rounded border px-1.5 py-0.5 text-[10px] transition-colors',
              activeFilter === filter.id
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            ].join(' ')}
            type="button"
            key={filter.id}
            onClick={() => setActiveFilter(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <nav className="flex min-h-0 flex-col overflow-auto" aria-label={t('session.tree')}>
            {filteredGroups.map((group) => {
              const isCollapsed = collapsedGroupIds.has(group.id);

              return (
                <section className="min-w-0" key={group.id}>
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <button
                        className="flex h-6 w-full items-center gap-1 rounded px-1 text-left text-[11px] font-semibold uppercase text-muted-foreground hover:bg-accent hover:text-foreground"
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                      >
                        {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                        {isCollapsed ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />}
                        <span className="truncate">{group.name}</span>
                        <span className="ml-auto text-[10px] font-normal">{group.sessions.length}</span>
                      </button>
                    </ContextMenuTrigger>
                    <GroupContextMenuContent
                      group={group}
                      onCreateFolder={createFolder}
                      onCreateSession={() => openCreateDialog(group.id)}
                      onDeleteFolder={() => deleteFolder(group)}
                      onRenameFolder={() => renameFolder(group)}
                    />
                  </ContextMenu>
                  {!isCollapsed && (
                    <div className="ml-4 grid border-l border-border/70 pl-1">
                      {group.sessions.map((session) => (
                        <SessionContextMenu
                          key={session.id}
                          session={session}
                          onDeleteSession={() => deleteSession(session)}
                          onDuplicateSession={() => duplicateSession(session)}
                          onEditSession={() => openEditDialog(session)}
                          onOpenSession={() => openSession(session)}
                        >
                          <SessionButton
                            isSelected={selectedSessionId === session.id}
                            session={session}
                            onClick={() => setSelectedSessionId(session.id)}
                            onDoubleClick={() => openSession(session)}
                          />
                        </SessionContextMenu>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
            {filteredGroups.length === 0 && (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No sessions found.
              </div>
            )}
          </nav>
        </ContextMenuTrigger>
        <TreeContextMenuContent
          onCreateFolder={createFolder}
          onCreateSession={() => openCreateDialog()}
        />
      </ContextMenu>

      <CreateSessionDialog
        existingGroups={groups}
        initialGroupId={createDialogGroupId}
        initialSession={editingSession}
        open={isCreateDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateSession={saveSession}
      />
    </>
  );
}

async function queueCredentialForBackend(secret: CreateSessionResult['secret']) {
  if (!secret) {
    return true;
  }

  try {
    await savePendingCredentialSecret(secret);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error('Failed to save credential', error);
    window.alert(`Failed to save password in secure storage. The session was not saved.\n\n${message}`);
    return false;
  }
}

function TreeContextMenuContent({
  onCreateFolder,
  onCreateSession,
}: {
  onCreateFolder: () => void;
  onCreateSession: () => void;
}) {
  return (
    <ContextMenuContent>
      <ContextMenuLabel>Sessions</ContextMenuLabel>
      <ContextMenuItem onSelect={onCreateSession}>
        New Session
        <ContextMenuShortcut>Ctrl+N</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onCreateFolder}>New Folder</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem>Import Sessions</ContextMenuItem>
      <ContextMenuItem>Export Sessions</ContextMenuItem>
    </ContextMenuContent>
  );
}

function GroupContextMenuContent({
  group,
  onCreateFolder,
  onCreateSession,
  onDeleteFolder,
  onRenameFolder,
}: {
  group: SessionGroup;
  onCreateFolder: () => void;
  onCreateSession: () => void;
  onDeleteFolder: () => void;
  onRenameFolder: () => void;
}) {
  return (
    <ContextMenuContent>
      <ContextMenuLabel>{group.name}</ContextMenuLabel>
      <ContextMenuItem onSelect={onCreateSession}>New Session in Folder</ContextMenuItem>
      <ContextMenuItem onSelect={onCreateFolder}>New Folder</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onRenameFolder}>Rename Folder</ContextMenuItem>
      <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onDeleteFolder}>
        Delete Folder
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function SessionContextMenu({
  children,
  onDeleteSession,
  onDuplicateSession,
  onEditSession,
  onOpenSession,
  session,
}: {
  children: ReactNode;
  onDeleteSession: () => void;
  onDuplicateSession: () => void;
  onEditSession: () => void;
  onOpenSession: () => void;
  session: SessionItem;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{session.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={onOpenSession}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={onOpenSession}>Open in Split</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onEditSession}>Edit Session</ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicateSession}>Duplicate</ContextMenuItem>
        <ContextMenuItem>Export</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onDeleteSession}>
          Delete Session
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function updateSessionInRegistry({
  groups,
  newGroupName,
  previousSessionId,
  session,
}: {
  groups: SessionGroup[];
  newGroupName?: string;
  previousSessionId: string;
  session: SessionItem;
}) {
  const groupsWithoutSession = groups.map((group) => ({
    ...group,
    sessions: group.sessions.filter((item) => item.id !== previousSessionId),
  }));

  return appendSessionToRegistry({
    groups: groupsWithoutSession,
    newGroupName,
    session,
  });
}

function getPanelForSession(session: SessionItem): WorkspacePanel | undefined {
  if (session.kind === 'ssh' || session.kind === 'local' || session.kind === 'docker' || session.kind === 'wsl') {
    return {
      id: session.id,
      session,
      title: `${getSessionKindLabel(session.kind)} - ${session.name}`,
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

function getSessionKindLabel(kind: SessionKind) {
  if (kind === 'wsl') {
    return 'WSL';
  }

  return kind.toUpperCase();
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

  if (filter === 'local') {
    return isLocalSessionKind(session.kind);
  }

  return session.kind === filter;
}

function isLocalSessionKind(kind: SessionKind) {
  return kind === 'local' || kind === 'docker' || kind === 'wsl';
}

function SidebarPanelList({
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

function SidebarStaticList({ items }: { items: string[] }) {
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
