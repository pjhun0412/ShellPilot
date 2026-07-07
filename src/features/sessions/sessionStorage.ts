import { invoke } from '@tauri-apps/api/core';

import type { SessionGroup, SessionItem } from '@/types/workspace';

const SESSION_STORAGE_KEY = 'shellpilot.sessions.v1';
const SESSION_UI_STORAGE_KEY = 'shellpilot.sessions.ui.v1';
const SESSION_PATCH_EVENT_NAME = 'shellpilot:sessions:patch';

export const UNGROUPED_GROUP_ID = 'ungrouped';
export const UNGROUPED_GROUP_NAME = 'Ungrouped';

interface StoredSessionRegistry {
  version: 1;
  groups: SessionGroup[];
}

interface StoredSessionUiState {
  collapsedGroupIds: string[];
  version: 1;
}

export interface SessionPatchDetail {
  patch: Partial<Pick<SessionItem, 'credentialRef' | 'username'>>;
  sessionId: string;
}

export function requestSessionPatch(detail: SessionPatchDetail) {
  window.dispatchEvent(new CustomEvent<SessionPatchDetail>(SESSION_PATCH_EVENT_NAME, { detail }));
}

export function subscribeSessionPatch(listener: (detail: SessionPatchDetail) => void) {
  const handler = (event: Event) => {
    listener((event as CustomEvent<SessionPatchDetail>).detail);
  };

  window.addEventListener(SESSION_PATCH_EVENT_NAME, handler);
  return () => window.removeEventListener(SESSION_PATCH_EVENT_NAME, handler);
}

export function loadSessionGroups(): SessionGroup[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const registry = JSON.parse(raw) as Partial<StoredSessionRegistry>;

    if (registry.version !== 1 || !Array.isArray(registry.groups)) {
      return [];
    }

    return registry.groups;
  } catch {
    return [];
  }
}

export function saveSessionGroups(groups: SessionGroup[]) {
  if (typeof window === 'undefined') {
    return;
  }

  const registry: StoredSessionRegistry = {
    version: 1,
    groups,
  };

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(registry));
}

export function loadSessionUiState() {
  if (typeof window === 'undefined') {
    return {
      collapsedGroupIds: [],
    };
  }

  try {
    const raw = window.localStorage.getItem(SESSION_UI_STORAGE_KEY);

    if (!raw) {
      return {
        collapsedGroupIds: [],
      };
    }

    const state = JSON.parse(raw) as Partial<StoredSessionUiState>;

    if (state.version !== 1 || !Array.isArray(state.collapsedGroupIds)) {
      return {
        collapsedGroupIds: [],
      };
    }

    return {
      collapsedGroupIds: state.collapsedGroupIds.filter((id): id is string => typeof id === 'string'),
    };
  } catch {
    return {
      collapsedGroupIds: [],
    };
  }
}

export function saveSessionUiState(state: { collapsedGroupIds: string[] }) {
  if (typeof window === 'undefined') {
    return;
  }

  const storedState: StoredSessionUiState = {
    collapsedGroupIds: state.collapsedGroupIds,
    version: 1,
  };

  window.localStorage.setItem(SESSION_UI_STORAGE_KEY, JSON.stringify(storedState));
}

export async function loadSessionGroupsFromBackend(): Promise<SessionGroup[]> {
  const registry = await invoke<Partial<StoredSessionRegistry>>('load_session_registry');

  if (registry.version !== 1 || !Array.isArray(registry.groups)) {
    return [];
  }

  return registry.groups;
}

export async function saveSessionGroupsToBackend(groups: SessionGroup[]) {
  const registry: StoredSessionRegistry = {
    version: 1,
    groups,
  };

  await invoke('save_session_registry', { registry });
}

export async function loadSessionGroupsWithMigration(fallbackGroups: SessionGroup[]) {
  const backendGroups = await loadSessionGroupsFromBackend();

  if (backendGroups.length > 0) {
    return backendGroups;
  }

  if (fallbackGroups.length > 0) {
    await saveSessionGroupsToBackend(fallbackGroups);
  }

  return fallbackGroups;
}

export async function persistSessionGroups(groups: SessionGroup[]) {
  await saveSessionGroupsToBackend(groups);
  saveSessionGroups(groups);
}

export function createSessionGroup(name: string): SessionGroup {
  const trimmedName = name.trim() || 'New Folder';

  return {
    id: createGroupId(trimmedName),
    name: trimmedName,
    sessions: [],
  };
}

export function appendSessionToRegistry({
  groups,
  newGroupName,
  session,
}: {
  groups: SessionGroup[];
  newGroupName?: string;
  session: SessionItem;
}): SessionGroup[] {
  const targetGroupId = resolveGroupId(session, newGroupName);
  const targetGroupName = newGroupName?.trim() || UNGROUPED_GROUP_NAME;
  const normalizedSession = {
    ...session,
    groupId: targetGroupId === UNGROUPED_GROUP_ID ? undefined : targetGroupId,
  };
  let didAppend = false;

  const nextGroups = groups.map((group) => {
    if (group.id !== targetGroupId) {
      return group;
    }

    didAppend = true;
    return {
      ...group,
      sessions: [...group.sessions, normalizedSession],
    };
  });

  if (didAppend) {
    return nextGroups;
  }

  return [
    ...nextGroups,
    {
      id: targetGroupId,
      name: targetGroupName,
      sessions: [normalizedSession],
    },
  ];
}

function resolveGroupId(session: SessionItem, newGroupName?: string) {
  if (newGroupName?.trim()) {
    return createGroupId(newGroupName);
  }

  return session.groupId || UNGROUPED_GROUP_ID;
}

function createGroupId(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${slug || 'folder'}-${crypto.randomUUID()}`;
}
