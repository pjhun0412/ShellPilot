import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { PanelIcon } from '@/features/panels/PanelIcon';
import { panelCatalog } from '@/features/panels/panelCatalog';
import { useSessionRegistry } from '@/features/sessions/useSessionRegistry';
import { t } from '@/i18n';
import type { SessionGroup, SessionItem, SessionKind, WorkspacePanel } from '@/types/workspace';
import { CreateSessionDialog, type CreateSessionResult } from './CreateSessionDialog';
import { SessionTree } from './SessionTree';

type SessionFilter = 'all' | 'ssh' | 'rdp' | 'local' | 'favorites';

const sessionFilters: Array<{ id: SessionFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ssh', label: 'SSH' },
  { id: 'rdp', label: 'RDP' },
  { id: 'local', label: 'Local' },
  { id: 'favorites', label: 'Favorites' },
];

export function SessionsView({ onAddPanel }: { onAddPanel: (panel: WorkspacePanel) => void }) {
  const [activeFilter, setActiveFilter] = useState<SessionFilter>('all');
  const [query, setQuery] = useState('');
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDialogGroupId, setCreateDialogGroupId] = useState<string | undefined>();
  const [editingSession, setEditingSession] = useState<SessionItem | undefined>();
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
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
      openPanelForSession(session);
    },
  });
  const filteredGroups = useMemo(
    () => filterSessionGroups(groups, activeFilter, query),
    [activeFilter, groups, query],
  );

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
        onRenameFolder={renameFolder}
        onSelectGroup={setSelectedGroupId}
        onSelectSession={selectSession}
        onToggleGroup={toggleGroup}
      />

      <CreateSessionDialog
        existingGroups={groups}
        initialGroupId={createDialogGroupId}
        initialSession={editingSession}
        open={isCreateDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateSession={submitSession}
      />
    </>
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
