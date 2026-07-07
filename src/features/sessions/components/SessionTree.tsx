import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { SessionButton } from '@/components/navigation/SessionButton';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import type { SessionGroup, SessionItem } from '@/types/workspace';
import {
  getGroupDragId,
  getSessionDragId,
  isGroupDropTarget,
  readDragItem,
  resolveDragOverlayLabel,
  resolveSessionDropPosition,
  type SessionTreeDragItem,
} from './sessionTreeDnd';
import { disableSessionDragGuard, enableSessionDragGuard } from './sessionTreeDragGuard';

export function SessionTree({
  collapsedGroupIds,
  groups,
  onCreateFolder,
  onCreateSession,
  onDeleteFolder,
  onDeleteSession,
  onDuplicateSession,
  onEditSession,
  onMoveGroup,
  onMoveSession,
  onOpenSession,
  onRenameFolder,
  onSelectGroup,
  onSelectSession,
  onToggleGroup,
  onTreeContextMenu,
  selectedGroupId,
  selectedSessionId,
}: {
  collapsedGroupIds: Set<string>;
  groups: SessionGroup[];
  onCreateFolder: () => void;
  onCreateSession: (groupId?: string) => void;
  onDeleteFolder: (group: SessionGroup) => void;
  onDeleteSession: (session: SessionItem) => Promise<void>;
  onDuplicateSession: (session: SessionItem) => void;
  onEditSession: (session: SessionItem) => void;
  onMoveGroup: (activeGroupId: string, overGroupId: string) => void;
  onMoveSession: (input: {
    activeSessionId: string;
    overGroupId: string;
    overSessionId?: string;
    overSessionPosition?: 'after' | 'before';
  }) => void;
  onOpenSession: (session: SessionItem) => void;
  onRenameFolder: (group: SessionGroup) => void;
  onSelectGroup: (groupId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onTreeContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  selectedGroupId?: string;
  selectedSessionId?: string;
}) {
  const groupIds = useMemo(() => groups.map((group) => getGroupDragId(group.id)), [groups]);
  const [activeDragItem, setActiveDragItem] = useState<SessionTreeDragItem | undefined>();
  const [overDragItem, setOverDragItem] = useState<SessionTreeDragItem | undefined>();
  const collisionDetection: CollisionDetection = (args) => {
    const pointerCollisions = pointerWithin(args);
    const collisions = pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
    const activeItem = readDragItem(args.active.data.current);

    if (activeItem?.type !== 'session') {
      return collisions;
    }

    const sessionCollisions = collisions.filter((collision) => {
      return readDragItem(collision.data?.droppableContainer.data.current)?.type === 'session';
    });

    return sessionCollisions.length > 0 ? sessionCollisions : collisions;
  };
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const activeOverlayLabel = resolveDragOverlayLabel(activeDragItem, groups);

  useEffect(() => {
    if (activeDragItem) {
      enableSessionDragGuard();
    }

    return () => {
      disableSessionDragGuard();
    };
  }, [activeDragItem]);


  const startDrag = (event: DragStartEvent) => {
    const dragItem = readDragItem(event.active.data.current);

    setActiveDragItem(dragItem);
    setOverDragItem(undefined);
  };
  const moveDragOver = (event: DragOverEvent) => {
    setOverDragItem(readDragItem(event.over?.data.current));
  };
  const finishDrag = (event: DragEndEvent) => {
    const activeItem = readDragItem(event.active.data.current);
    const overItem = readDragItem(event.over?.data.current);

    setActiveDragItem(undefined);
    setOverDragItem(undefined);
    disableSessionDragGuard();

    if (!activeItem || !overItem || event.active.id === event.over?.id) {
      return;
    }

    if (activeItem.type === 'group' && overItem.type === 'group') {
      onMoveGroup(activeItem.groupId, overItem.groupId);
      return;
    }

    if (activeItem.type === 'session') {
      onMoveSession({
        activeSessionId: activeItem.sessionId,
        overGroupId: overItem.groupId,
        overSessionId: overItem.type === 'session' ? overItem.sessionId : undefined,
        overSessionPosition:
          overItem.type === 'session'
            ? resolveSessionDropPosition(activeItem, overItem, groups, event.delta.y)
            : undefined,
      });
    }
  };

  return (
    <DndContext
      collisionDetection={collisionDetection}
      sensors={sensors}
      onDragEnd={finishDrag}
      onDragCancel={() => {
        setActiveDragItem(undefined);
        setOverDragItem(undefined);
        disableSessionDragGuard();
      }}
      onDragOver={moveDragOver}
      onDragStart={startDrag}
    >
      <nav
        className="app-scrollbar flex min-h-0 flex-1 flex-col overflow-auto"
        aria-label={t('session.tree')}
        onContextMenu={(event) => {
          if ((event.target as Element).closest('[data-session-tree-item="true"]')) {
            return;
          }

          onTreeContextMenu(event);
        }}
        onPointerCancelCapture={disableSessionDragGuard}
        onPointerDownCapture={enableSessionDragGuard}
        onPointerUpCapture={disableSessionDragGuard}
      >
        <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
          {groups.map((group) => (
            <SortableGroupSection
              activeDragItem={activeDragItem}
              group={group}
              isCollapsed={collapsedGroupIds.has(group.id)}
              isDropTarget={isGroupDropTarget({
                activeDragItem,
                groupId: group.id,
                overDragItem,
              })}
              isSelected={selectedGroupId === group.id}
              key={group.id}
              selectedSessionId={selectedSessionId}
              onCreateFolder={onCreateFolder}
              onCreateSession={() => onCreateSession(group.id)}
              onDeleteFolder={() => onDeleteFolder(group)}
              onDeleteSession={onDeleteSession}
              onDuplicateSession={onDuplicateSession}
              onEditSession={onEditSession}
              onOpenSession={onOpenSession}
              onRenameFolder={onRenameFolder}
              onSelectGroup={onSelectGroup}
              onSelectSession={onSelectSession}
              onToggleGroup={onToggleGroup}
              overDragItem={overDragItem}
            />
          ))}
        </SortableContext>
        {groups.length === 0 && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No sessions found.
          </div>
        )}
      </nav>
      <DragOverlay>
        {activeOverlayLabel && (
          <div className="rounded border border-primary/40 bg-card px-2 py-1 text-xs text-foreground shadow-lg">
            {activeOverlayLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SortableGroupSection({
  activeDragItem,
  group,
  isCollapsed,
  isDropTarget,
  isSelected,
  onCreateFolder,
  onCreateSession,
  onDeleteFolder,
  onDeleteSession,
  onDuplicateSession,
  onEditSession,
  onOpenSession,
  onRenameFolder,
  onSelectGroup,
  onSelectSession,
  onToggleGroup,
  overDragItem,
  selectedSessionId,
}: {
  activeDragItem?: SessionTreeDragItem;
  group: SessionGroup;
  isCollapsed: boolean;
  isDropTarget: boolean;
  isSelected: boolean;
  onCreateFolder: () => void;
  onCreateSession: () => void;
  onDeleteFolder: () => void;
  onDeleteSession: (session: SessionItem) => Promise<void>;
  onDuplicateSession: (session: SessionItem) => void;
  onEditSession: (session: SessionItem) => void;
  onOpenSession: (session: SessionItem) => void;
  onRenameFolder: (group: SessionGroup) => void;
  onSelectGroup: (groupId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onToggleGroup: (groupId: string) => void;
  overDragItem?: SessionTreeDragItem;
  selectedSessionId?: string;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    data: { groupId: group.id, type: 'group' } satisfies SessionTreeDragItem,
    id: getGroupDragId(group.id),
  });
  const sessionIds = useMemo(() => group.sessions.map((session) => getSessionDragId(session.id)), [group.sessions]);
  const style = {
    opacity: isDragging ? 0.55 : undefined,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <section className="min-w-0" ref={setNodeRef} style={style}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            data-session-tree-item="true"
            className={cn(
              'group flex h-6 w-full items-center gap-1 rounded px-1 text-left text-sm font-semibold uppercase text-slate-200 transition-colors hover:bg-slate-800/75 hover:text-slate-50',
              isSelected && 'bg-slate-800/90 text-slate-50 shadow-[inset_2px_0_0_hsl(var(--primary))]',
              isDropTarget && 'bg-teal-500/12 text-teal-100 ring-1 ring-inset ring-teal-400/45',
              isDragging && 'bg-accent text-slate-50',
            )}
            type="button"
            aria-expanded={!isCollapsed}
            onClick={() => onSelectGroup(group.id)}
            onDoubleClick={() => onToggleGroup(group.id)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return;
              }

              event.preventDefault();
              onToggleGroup(group.id);
            }}
            {...attributes}
            {...listeners}
          >
            <span
              className="grid size-4 shrink-0 place-items-center rounded hover:bg-accent-foreground/10"
              role="presentation"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleGroup(group.id);
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
            </span>
            {isCollapsed ? <Folder className="size-3.5" /> : <FolderOpen className="size-3.5" />}
            <span className="truncate">{group.name}</span>
            <span
              className={cn(
                'ml-auto min-w-5 text-right font-mono text-xs font-bold tabular-nums text-slate-300 group-hover:text-white',
                isSelected && 'text-teal-200',
              )}
            >
              {group.sessions.length}
            </span>
          </button>
        </ContextMenuTrigger>
        <GroupContextMenuContent
          group={group}
          onCreateFolder={onCreateFolder}
          onCreateSession={onCreateSession}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={() => onRenameFolder(group)}
        />
      </ContextMenu>
      {!isCollapsed && (
        <div
          className={cn(
            'ml-4 grid border-l border-border/70 pl-1 transition-colors',
            isDropTarget && 'border-teal-400/70',
          )}
        >
          <SortableContext items={sessionIds} strategy={verticalListSortingStrategy}>
            {group.sessions.map((session) => (
              <SortableSessionRow
                groupId={group.id}
                isDropTarget={
                  overDragItem?.type === 'session' &&
                  overDragItem.sessionId === session.id &&
                  activeDragItem?.type === 'session' &&
                  activeDragItem.sessionId !== session.id
                }
                isSelected={selectedSessionId === session.id}
                key={session.id}
                session={session}
                onDeleteSession={() => void onDeleteSession(session)}
                onDuplicateSession={() => onDuplicateSession(session)}
                onEditSession={() => onEditSession(session)}
                onOpenSession={() => onOpenSession(session)}
                onSelectSession={() => onSelectSession(session.id)}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </section>
  );
}

function SortableSessionRow({
  groupId,
  isDropTarget,
  isSelected,
  onDeleteSession,
  onDuplicateSession,
  onEditSession,
  onOpenSession,
  onSelectSession,
  session,
}: {
  groupId: string;
  isDropTarget: boolean;
  isSelected: boolean;
  onDeleteSession: () => void;
  onDuplicateSession: () => void;
  onEditSession: () => void;
  onOpenSession: () => void;
  onSelectSession: () => void;
  session: SessionItem;
}) {
  const {
    attributes,
    isDragging,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    data: { groupId, sessionId: session.id, type: 'session' } satisfies SessionTreeDragItem,
    id: getSessionDragId(session.id),
  });
  const style = {
    opacity: isDragging ? 0.45 : undefined,
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      data-session-tree-item="true"
      className={cn(
        'rounded transition-colors',
        isDropTarget && 'bg-teal-500/10 ring-1 ring-inset ring-teal-400/40',
      )}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <SessionContextMenu
        session={session}
        onDeleteSession={onDeleteSession}
        onDuplicateSession={onDuplicateSession}
        onEditSession={onEditSession}
        onOpenSession={onOpenSession}
      >
        <SessionButton
          className={cn(isDragging && 'bg-accent')}
          isSelected={isSelected}
          session={session}
          onClick={onSelectSession}
          onDoubleClick={onOpenSession}
        />
      </SessionContextMenu>
    </div>
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
  const copyHost = () => {
    if (session.host) {
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
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>{session.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={onOpenSession}>Connect</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!session.host} onSelect={copyHost}>Copy Host</ContextMenuItem>
        <ContextMenuItem disabled={!createSshCommand(session)} onSelect={copySshCommand}>
          Copy SSH Command
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onEditSession}>Edit Session</ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicateSession}>Duplicate</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onDeleteSession}>
          Delete Session
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function createSshCommand(session: SessionItem) {
  if (session.kind !== 'ssh' || !session.host) {
    return undefined;
  }

  const username = session.username ? `${session.username}@` : '';
  const port = session.port && session.port !== 22 ? ` -p ${session.port}` : '';

  return `ssh ${username}${session.host}${port}`;
}
