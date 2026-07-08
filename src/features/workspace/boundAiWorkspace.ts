import type { Model, TabNode } from 'flexlayout-react';

import type { AiPanelBinding, WorkspaceTabItem } from '@/types/workspace';

import { readSessionConfig } from './WorkspaceTabMenu';
import { createShortPanelId } from './workspaceNodeUtils';

export function createBoundAiPanelId(sourceTabId: string) {
  return `ai-bound-${sourceTabId}`;
}

export function createBoundAiBinding({
  model,
  tab,
}: {
  model: Model;
  tab: WorkspaceTabItem;
}): AiPanelBinding {
  return {
    boundPanelId: tab.id,
    boundPanelOrdinal: getSessionTabOrdinal(model, tab),
    boundPanelShortId: createShortPanelId(tab.id),
    boundPanelTitle: tab.title,
    boundPanelType: tab.type,
    contextLabel: tab.type === 'sftp'
      ? 'Current remote path and selection context'
      : 'Current terminal session context',
    sessionHost: tab.session?.host,
    sessionName: tab.session?.name,
    sessionUsername: tab.session?.username,
  };
}

export function createBoundAiTitle(tab: WorkspaceTabItem, binding: AiPanelBinding) {
  const sessionLabel = tab.session?.name || tab.session?.host || tab.title;
  const kindLabel = tab.type === 'sftp' ? 'SFTP' : 'SSH';
  const ordinal = binding.boundPanelOrdinal ?? 1;
  const shortId = binding.boundPanelShortId ?? createShortPanelId(tab.id);

  return `AI · ${sessionLabel} · ${kindLabel} #${ordinal} (${shortId})`;
}

function getSessionTabOrdinal(model: Model, targetTab: WorkspaceTabItem) {
  let ordinal = 0;
  let matchedOrdinal = 0;

  model.visitNodes((node) => {
    if (node.getType() !== 'tab') {
      return;
    }

    const tab = node as TabNode;
    const config = tab.getConfig() as { panelType?: string; session?: unknown };

    if (config.panelType !== targetTab.type) {
      return;
    }

    const session = readSessionConfig(config.session);
    const isSameSession = session?.id && targetTab.session?.id
      ? session.id === targetTab.session.id
      : session?.host === targetTab.session?.host && session?.username === targetTab.session?.username;

    if (!isSameSession) {
      return;
    }

    ordinal += 1;

    if (tab.getId() === targetTab.id) {
      matchedOrdinal = ordinal;
    }
  });

  return Math.max(matchedOrdinal || ordinal, 1);
}
