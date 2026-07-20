import { useEffect, useMemo, useRef, useState } from 'react';

import { appAlert, appConfirm, appPrompt } from '@/components/ui/app-dialog';
import { deleteStoredCredential, savePendingCredentialSecret } from '@/features/sessions/credentialStore';
import {
  appendSessionToRegistry,
  createSessionGroup,
  loadSessionGroups,
  loadSessionGroupsWithMigration,
  persistSessionGroups,
  requestSessionPatch,
  subscribeSessionPatch,
  UNGROUPED_GROUP_ID,
} from '@/features/sessions/sessionStorage';
import type { CredentialRef, SessionGroup, SessionItem } from '@/types/workspace';
import type { CreateSessionResult } from './components/CreateSessionDialog';

export function useSessionRegistry({
  onCreateSession,
}: {
  onCreateSession: (session: SessionItem) => void;
}) {
  const initialGroups = useMemo(() => loadSessionGroups(), []);
  const [groups, setGroups] = useState<SessionGroup[]>(initialGroups);
  const [isRegistryLoaded, setIsRegistryLoaded] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const groupsRef = useRef(initialGroups);
  const hasLocalRegistryMutationRef = useRef(false);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    let isMounted = true;

    void loadSessionGroupsWithMigration(initialGroups)
      .then((loadedGroups) => {
        if (!isMounted) {
          return;
        }

        if (!hasLocalRegistryMutationRef.current) {
          groupsRef.current = loadedGroups;
          setGroups(loadedGroups);
        }
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
      void appAlert({
        title: 'Failed to Save Sessions',
        message: `Failed to save sessions.\n\n${error instanceof Error ? error.message : String(error)}`,
      });
    });
  }, [groups, isRegistryLoaded]);

  useEffect(() => {
    return subscribeSessionPatch(({ onApplied, patch, sessionId }) => {
      let didUpdate = false;
      const nextGroups = groupsRef.current.map((group) => ({
        ...group,
        sessions: group.sessions.map((session) => {
          if (session.id !== sessionId) {
            return session;
          }

          didUpdate = true;
          return {
            ...session,
            ...patch,
            updatedAt: Date.now(),
          };
        }),
      }));

      if (didUpdate) {
        hasLocalRegistryMutationRef.current = true;
        groupsRef.current = nextGroups;
        setGroups(nextGroups);
      }

      onApplied?.(didUpdate);
    });
  }, []);

  const createFolder = () => {
    const nextIndex = groups.length + 1;
    setGroups((current) => [...current, createSessionGroup(`New Folder ${nextIndex}`)]);
  };

  const saveSession = async (result: CreateSessionResult, editingSession?: SessionItem) => {
    // Set this before any await below. A background load kicked off at mount
    // (loadSessionGroupsWithMigration) can resolve while we're still awaiting
    // the credential save, and would otherwise overwrite the in-progress edit
    // with pre-edit data once it lands.
    hasLocalRegistryMutationRef.current = true;

    if (result.secret) {
      const didSaveCredential = await queueCredentialForBackend(result.secret);

      if (!didSaveCredential) {
        return;
      }
    }

    if (editingSession) {
      const nextGroups = updateSessionInRegistry({
        groups: groupsRef.current,
        newGroupName: result.groupName,
        previousSessionId: editingSession.id,
        session: result.session,
      });

      groupsRef.current = nextGroups;
      setGroups(nextGroups);
      await persistSessionGroups(nextGroups);
      await cleanupOrphanedCredentialRefs({
        credentialRefs: [editingSession.credentialRef],
        remainingGroups: nextGroups,
      });
      requestSessionPatch({
        sessionId: editingSession.id,
        patch: createSessionPatch(result.session),
      });
      return;
    }

    const nextGroups = appendSessionToRegistry({
      groups: groupsRef.current,
      newGroupName: result.groupName,
      session: result.session,
    });

    groupsRef.current = nextGroups;
    setGroups(nextGroups);
    setSelectedSessionId(result.session.id);
    onCreateSession(result.session);
  };

  const renameFolder = async (group: SessionGroup) => {
    const nextName = (
      await appPrompt({
        defaultValue: group.name,
        message: 'Enter a new folder name.',
        title: 'Rename Folder',
      })
    )?.trim();

    if (!nextName || nextName === group.name) {
      return;
    }

    setGroups((current) =>
      current.map((item) => (item.id === group.id ? { ...item, name: nextName } : item)),
    );
  };

  const deleteFolder = async (group: SessionGroup) => {
    const hasSessions = group.sessions.length > 0;
    const message = hasSessions
      ? `Delete "${group.name}" and ${group.sessions.length} session(s)?`
      : `Delete "${group.name}"?`;

    if (
      !(await appConfirm({
        confirmLabel: 'Delete',
        message,
        title: 'Delete Folder',
        tone: 'danger',
      }))
    ) {
      return;
    }

    const nextGroups = groups.filter((item) => item.id !== group.id);

    setGroups(nextGroups);
    await cleanupOrphanedCredentialRefs({
      credentialRefs: group.sessions.map((session) => session.credentialRef),
      remainingGroups: nextGroups,
    });
  };

  const deleteSession = async (session: SessionItem) => {
    if (
      !(await appConfirm({
        confirmLabel: 'Delete',
        message: `Delete "${session.name}"?`,
        title: 'Delete Session',
        tone: 'danger',
      }))
    ) {
      return;
    }

    if (selectedSessionId === session.id) {
      setSelectedSessionId(undefined);
    }

    const nextGroups = groups.map((group) => ({
      ...group,
      sessions: group.sessions.filter((item) => item.id !== session.id),
    }));

    setGroups(nextGroups);
    await cleanupOrphanedCredentialRefs({
      credentialRefs: [session.credentialRef],
      remainingGroups: nextGroups,
    });
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
              credentialRef: undefined,
              id: duplicatedSessionId,
              name: `${session.name} Copy`,
              status: 'unknown',
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
        };
      }),
    );
  };

  const moveGroup = (activeGroupId: string, overGroupId: string) => {
    if (activeGroupId === overGroupId) {
      return;
    }

    setGroups((current) => {
      const activeIndex = current.findIndex((group) => group.id === activeGroupId);
      const overIndex = current.findIndex((group) => group.id === overGroupId);

      if (activeIndex < 0 || overIndex < 0) {
        return current;
      }

      return moveArrayItem(current, activeIndex, overIndex);
    });
  };

  const moveSession = ({
    activeSessionId,
    overGroupId,
    overSessionPosition = 'before',
    overSessionId,
  }: {
    activeSessionId: string;
    overGroupId: string;
    overSessionPosition?: 'after' | 'before';
    overSessionId?: string;
  }) => {
    setGroups((current) => {
      const activeLocation = findSessionLocation(current, activeSessionId);

      if (!activeLocation) {
        return current;
      }

      const activeSession = current[activeLocation.groupIndex]?.sessions[activeLocation.sessionIndex];

      if (!activeSession) {
        return current;
      }

      const targetGroupIndex = current.findIndex((group) => group.id === overGroupId);

      if (targetGroupIndex < 0) {
        return current;
      }

      const nextGroups = current.map((group) => ({
        ...group,
        sessions: group.sessions.filter((session) => session.id !== activeSessionId),
      }));
      const targetSessions = [...nextGroups[targetGroupIndex].sessions];
      const overSessionIndex = overSessionId
        ? targetSessions.findIndex((session) => session.id === overSessionId)
        : -1;
      const insertIndex =
        overSessionIndex >= 0
          ? overSessionIndex + (overSessionPosition === 'after' ? 1 : 0)
          : targetSessions.length;
      const normalizedSession = {
        ...activeSession,
        groupId: overGroupId === UNGROUPED_GROUP_ID ? undefined : overGroupId,
        updatedAt: Date.now(),
      };

      targetSessions.splice(insertIndex, 0, normalizedSession);
      nextGroups[targetGroupIndex] = {
        ...nextGroups[targetGroupIndex],
        sessions: targetSessions,
      };

      return nextGroups;
    });
  };

  return {
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
  };
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
    await appAlert({
      title: 'Credential Save Failed',
      message: `Failed to save password in secure storage. The session was not saved.\n\n${message}`,
    });
    return false;
  }
}

async function cleanupOrphanedCredentialRefs({
  credentialRefs,
  remainingGroups,
}: {
  credentialRefs: Array<SessionItem['credentialRef']>;
  remainingGroups: SessionGroup[];
}) {
  const refsToDelete = credentialRefs
    .filter(isCredentialRef)
    .filter((credentialRef, index, refs) => {
      return (
        refs.findIndex((item) => item?.id === credentialRef.id) === index &&
        !isCredentialReferenced(remainingGroups, credentialRef.id)
      );
    });

  const failures: string[] = [];

  for (const credentialRef of refsToDelete) {
    try {
      await deleteStoredCredential(credentialRef);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      console.error('Failed to delete credential', { credentialRef, error });
      failures.push(`${credentialRef.label ?? credentialRef.id}: ${message}`);
    }
  }

  if (failures.length > 0) {
    await appAlert({
      title: 'Credential Cleanup Failed',
      message: `Session metadata was updated, but secure credential cleanup failed.\n\n${failures.join('\n')}`,
    });
  }
}

function isCredentialReferenced(groups: SessionGroup[], credentialId: string) {
  return groups.some((group) =>
    group.sessions.some((session) => session.credentialRef?.id === credentialId),
  );
}

function isCredentialRef(credentialRef: SessionItem['credentialRef']): credentialRef is CredentialRef {
  return Boolean(credentialRef);
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
  const previousLocation = findSessionLocation(groups, previousSessionId);

  if (newGroupName?.trim() || !previousLocation) {
    return appendSessionToRegistry({
      groups: groupsWithoutSession,
      newGroupName,
      session,
    });
  }

  const targetGroupId = session.groupId || UNGROUPED_GROUP_ID;
  const normalizedSession = {
    ...session,
    groupId: targetGroupId === UNGROUPED_GROUP_ID ? undefined : targetGroupId,
  };
  let didUpdate = false;

  const nextGroups = groupsWithoutSession.map((group) => {
    if (group.id !== targetGroupId) {
      return group;
    }

    didUpdate = true;
    const shouldPreserveIndex = previousLocation.groupId === targetGroupId;
    const insertIndex = shouldPreserveIndex
      ? Math.min(previousLocation.sessionIndex, group.sessions.length)
      : group.sessions.length;
    const nextSessions = [...group.sessions];

    nextSessions.splice(insertIndex, 0, normalizedSession);

    return {
      ...group,
      sessions: nextSessions,
    };
  });

  if (didUpdate) {
    return nextGroups;
  }

  return appendSessionToRegistry({
    groups: groupsWithoutSession,
    newGroupName,
    session,
  });
}

function createSessionPatch(session: SessionItem) {
  return {
    authMethod: session.authMethod,
    credentialRef: session.credentialRef,
    favorite: session.favorite,
    groupId: session.groupId,
    host: session.host,
    kind: session.kind,
    metadata: session.metadata,
    name: session.name,
    port: session.port,
    tags: session.tags,
    username: session.username,
  };
}

function findSessionLocation(groups: SessionGroup[], sessionId: string) {
  for (const [groupIndex, group] of groups.entries()) {
    const sessionIndex = group.sessions.findIndex((session) => session.id === sessionId);

    if (sessionIndex >= 0) {
      return {
        groupId: group.id,
        groupIndex,
        sessionIndex,
      };
    }
  }

  return undefined;
}

function moveArrayItem<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);

  if (!item) {
    return items;
  }

  nextItems.splice(toIndex, 0, item);
  return nextItems;
}
