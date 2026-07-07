import type { SessionGroup } from '@/types/workspace';

export type SessionTreeDragItem =
  | { groupId: string; type: 'group' }
  | { groupId: string; sessionId: string; type: 'session' };

export function getGroupDragId(groupId: string) {
  return `group:${groupId}`;
}

export function getSessionDragId(sessionId: string) {
  return `session:${sessionId}`;
}

export function readDragItem(value: unknown): SessionTreeDragItem | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const dragItem = value as Partial<SessionTreeDragItem>;

  if (dragItem.type === 'group' && typeof dragItem.groupId === 'string') {
    return {
      groupId: dragItem.groupId,
      type: 'group',
    };
  }

  if (
    dragItem.type === 'session' &&
    typeof dragItem.groupId === 'string' &&
    typeof dragItem.sessionId === 'string'
  ) {
    return {
      groupId: dragItem.groupId,
      sessionId: dragItem.sessionId,
      type: 'session',
    };
  }

  return undefined;
}

export function resolveDragOverlayLabel(
  activeDragItem: SessionTreeDragItem | undefined,
  groups: SessionGroup[],
) {
  if (!activeDragItem) {
    return undefined;
  }

  if (activeDragItem.type === 'group') {
    return groups.find((group) => group.id === activeDragItem.groupId)?.name;
  }

  return groups
    .flatMap((group) => group.sessions)
    .find((session) => session.id === activeDragItem.sessionId)
    ?.name;
}

export function resolveSessionDropPosition(
  activeItem: Extract<SessionTreeDragItem, { type: 'session' }>,
  overItem: Extract<SessionTreeDragItem, { type: 'session' }>,
  groups: SessionGroup[],
  deltaY: number,
): 'after' | 'before' {
  const activeLocation = findSessionLocation(groups, activeItem.sessionId);
  const overLocation = findSessionLocation(groups, overItem.sessionId);

  if (activeLocation && overLocation && activeLocation.groupId === overLocation.groupId) {
    return activeLocation.sessionIndex < overLocation.sessionIndex ? 'after' : 'before';
  }

  return deltaY > 0 ? 'after' : 'before';
}

export function isGroupDropTarget({
  activeDragItem,
  groupId,
  overDragItem,
}: {
  activeDragItem?: SessionTreeDragItem;
  groupId: string;
  overDragItem?: SessionTreeDragItem;
}) {
  if (!activeDragItem || !overDragItem) {
    return false;
  }

  if (activeDragItem.type === 'group') {
    return overDragItem.type === 'group' && overDragItem.groupId === groupId && activeDragItem.groupId !== groupId;
  }

  return overDragItem.groupId === groupId && activeDragItem.groupId !== groupId;
}

function findSessionLocation(groups: SessionGroup[], sessionId: string) {
  for (const group of groups) {
    const sessionIndex = group.sessions.findIndex((session) => session.id === sessionId);

    if (sessionIndex >= 0) {
      return {
        groupId: group.id,
        sessionIndex,
      };
    }
  }

  return undefined;
}
