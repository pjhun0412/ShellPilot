import type { IJsonModel } from 'flexlayout-react';

import { loadSessionGroups } from '@/features/sessions/sessionStorage';
import type { SessionItem } from '@/types/workspace';

export const layoutStorageKey = 'shellpilot.layout.v2';

export const initialLayout: IJsonModel = {
  global: {
    enableEdgeDock: true,
    enableEdgeDockIndicators: true,
    tabEnableClose: true,
    tabEnableDrag: true,
    tabEnableRename: false,
    tabSetEnableDivide: true,
    tabSetEnableDrag: true,
    tabSetEnableMaximize: true,
    tabSetEnableDrop: true,
    borderSize: 180,
  },
  borders: [
    {
      type: 'border',
      location: 'bottom',
      size: 190,
      selected: 0,
      children: [
        {
          type: 'tab',
          id: 'sftp-transfer-queue',
          name: 'Transfer Queue',
          enableClose: false,
          component: 'panel',
          config: { panelType: 'sftp-transfer-queue' },
        },
        {
          type: 'tab',
          id: 'ai-assistant',
          name: 'AI Assistant',
          enableClose: false,
          component: 'panel',
          config: { panelType: 'ai' },
        },
      ],
    },
  ],
  layout: {
    type: 'row',
    weight: 100,
    children: [
      {
        type: 'tabset',
        weight: 100,
        active: true,
        selected: -1,
        children: [],
      },
    ],
  },
};

export function loadSavedLayout(): IJsonModel {
  const savedLayout = localStorage.getItem(layoutStorageKey);
  const sessionsById = createSessionIndex();

  if (!savedLayout) {
    return restoreWorkspaceLayout(initialLayout, sessionsById);
  }

  try {
    return restoreWorkspaceLayout(JSON.parse(savedLayout) as IJsonModel, sessionsById);
  } catch {
    localStorage.removeItem(layoutStorageKey);
    return restoreWorkspaceLayout(initialLayout, sessionsById);
  }
}

export function saveWorkspaceLayout(layout: IJsonModel) {
  localStorage.setItem(layoutStorageKey, JSON.stringify(prepareWorkspaceLayoutForStorage(layout)));
}

function restoreWorkspaceLayout(layout: IJsonModel, sessionsById: Map<string, SessionItem>): IJsonModel {
  return normalizeWorkspaceLayout(hydrateWorkspaceNode(layout, sessionsById) as IJsonModel);
}

function normalizeWorkspaceLayout(layout: IJsonModel): IJsonModel {
  const normalizedLayout = forceClosableTabs(layout) as IJsonModel;

  return {
    ...normalizedLayout,
    borders: ensureBottomBorderTabs(
      normalizedLayout.borders?.filter((border) => {
        return !border.children?.some((child) => child.id === 'logs' || child.config?.panelType === 'logs');
      }) ?? [],
    ),
    global: {
      ...normalizedLayout.global,
      enableEdgeDock: true,
      enableEdgeDockIndicators: true,
      tabEnableClose: true,
      tabEnableDrag: true,
      tabSetEnableDivide: true,
      tabSetEnableDrag: true,
      tabSetEnableDrop: true,
      borderSize: 180,
    },
  };
}

function ensureBottomBorderTabs(borders: NonNullable<IJsonModel['borders']>) {
  const bottomTabs = [
    {
      type: 'tab' as const,
      id: 'sftp-transfer-queue',
      name: 'Transfer Queue',
      enableClose: false,
      component: 'panel',
      config: { panelType: 'sftp-transfer-queue' },
    },
    {
      type: 'tab' as const,
      id: 'ai-assistant',
      name: 'AI Assistant',
      enableClose: false,
      component: 'panel',
      config: { panelType: 'ai' },
    },
  ];
  const missingTabs = bottomTabs.filter(
    (tab) =>
      !borders.some((border) =>
        border.children?.some((child) => child.id === tab.id || child.config?.panelType === tab.config.panelType),
      ),
  );

  if (missingTabs.length === 0) {
    return borders;
  }

  const bottomBorderIndex = borders.findIndex((border) => border.location === 'bottom');

  if (bottomBorderIndex >= 0) {
    return borders.map((border, index) => {
      if (index !== bottomBorderIndex) {
        return border;
      }

      return {
        ...border,
        children: [...(border.children ?? []), ...missingTabs],
        selected: border.selected ?? 0,
        size: border.size ?? 190,
      };
    });
  }

  return [
    ...borders,
    {
      type: 'border' as const,
      location: 'bottom' as const,
      size: 190,
      selected: 0,
      children: missingTabs,
    },
  ];
}

function forceClosableTabs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(forceClosableTabs);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const node = value as Record<string, unknown>;
  const nextNode: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(node)) {
    nextNode[key] = forceClosableTabs(childValue);
  }

  if (node.type === 'tab') {
    const config = node.config as Record<string, unknown> | undefined;
    const isPinnedBorderTab =
      node.id === 'sftp-transfer-queue' ||
      node.id === 'ai-assistant' ||
      config?.panelType === 'sftp-transfer-queue';

    nextNode.enableClose = !isPinnedBorderTab;
  }

  return nextNode;
}

function prepareWorkspaceLayoutForStorage(layout: IJsonModel) {
  return sanitizeWorkspaceNode(layout);
}

function sanitizeWorkspaceNode(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeWorkspaceNode);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const node = value as Record<string, unknown>;
  const nextNode: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(node)) {
    nextNode[key] = sanitizeWorkspaceNode(childValue);
  }

  if (node.type === 'tab' && node.config && typeof node.config === 'object') {
    const config = node.config as Record<string, unknown>;
    const session = config.session as Partial<SessionItem> | undefined;
    const sessionId = typeof config.sessionId === 'string' ? config.sessionId : session?.id;

    if (sessionId) {
      const { session: _session, ...serializableConfig } = config;

      nextNode.config = {
        ...serializableConfig,
        autoConnect: false,
        sessionId,
      };
    }
  }

  return nextNode;
}

function hydrateWorkspaceNode(value: unknown, sessionsById: Map<string, SessionItem>): unknown {
  if (Array.isArray(value)) {
    return value
      .map((item) => hydrateWorkspaceNode(item, sessionsById))
      .filter(Boolean);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const node = value as Record<string, unknown>;
  const nextNode: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(node)) {
    nextNode[key] = hydrateWorkspaceNode(childValue, sessionsById);
  }

  if (node.type === 'tab' && node.config && typeof node.config === 'object') {
    const config = node.config as Record<string, unknown>;
    const sessionId = typeof config.sessionId === 'string' ? config.sessionId : undefined;

    if (sessionId) {
      const session = sessionsById.get(sessionId);

      if (!session) {
        return undefined;
      }

      nextNode.config = {
        ...config,
        autoConnect: false,
        session,
      };
    }
  }

  return nextNode;
}

function createSessionIndex() {
  const sessionsById = new Map<string, SessionItem>();

  for (const group of loadSessionGroups()) {
    for (const session of group.sessions) {
      sessionsById.set(session.id, session);
    }
  }

  return sessionsById;
}
