import type { Model, TabNode } from 'flexlayout-react';

import type { SftpSidebarExplorer } from '@/features/sftp/sftpSidebarState';
import type { WorkspacePanelType, WorkspaceTabItem } from '@/types/workspace';

import { readSessionConfig } from './WorkspaceTabMenu';

export function collectWorkspaceTabs(model: Model): WorkspaceTabItem[] {
  const tabs: WorkspaceTabItem[] = [];

  model.visitNodes((node) => {
    if (node.getType() !== 'tab') {
      return;
    }

    const tab = node as TabNode;
    const config = tab.getConfig() as { aiBinding?: WorkspaceTabItem['aiBinding']; panelType?: string; session?: unknown };

    if (!isWorkspacePanelType(config.panelType)) {
      return;
    }

    const session = readSessionConfig(config.session);

    tabs.push({
      aiBinding: config.aiBinding,
      id: tab.getId(),
      session,
      title: tab.getName(),
      type: config.panelType,
    });
  });

  return tabs;
}

export function collectSftpExplorers(model: Model): SftpSidebarExplorer[] {
  const explorers: SftpSidebarExplorer[] = [];

  model.visitNodes((node) => {
    if (node.getType() !== 'tab') {
      return;
    }

    const tab = node as TabNode;
    const config = tab.getConfig() as { panelType?: string; session?: unknown };

    if (config.panelType !== 'sftp') {
      return;
    }

    const session = readSessionConfig(config.session);

    explorers.push({
      host: session?.host,
      panelId: tab.getId(),
      session,
      title: tab.getName(),
      username: session?.username,
    });
  });

  return explorers;
}

function isWorkspacePanelType(value: unknown): value is WorkspacePanelType {
  return value === 'terminal' || value === 'sftp' || value === 'ai' || value === 'rdp' || value === 'settings';
}
