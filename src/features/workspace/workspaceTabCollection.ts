import type { Model, TabNode } from 'flexlayout-react';

import type { SftpSidebarExplorer } from '@/features/sftp/sftpSidebarState';
import type { WorkspaceLocalPtyTarget, WorkspacePanelType, WorkspaceTabItem } from '@/types/workspace';

import { readSessionConfig } from './WorkspaceTabMenu';

export function collectWorkspaceTabs(model: Model): WorkspaceTabItem[] {
  const tabs: WorkspaceTabItem[] = [];

  model.visitNodes((node) => {
    if (node.getType() !== 'tab') {
      return;
    }

    const tab = node as TabNode;

    if (tab.getParent()?.getType() === 'border') {
      return;
    }

    const config = tab.getConfig() as {
      aiBinding?: WorkspaceTabItem['aiBinding'];
      localPtyTarget?: WorkspaceTabItem['localPtyTarget'];
      panelType?: string;
      session?: unknown;
    };

    if (!isWorkspacePanelType(config.panelType)) {
      return;
    }

    const session = readSessionConfig(config.session);

    tabs.push({
      aiBinding: config.aiBinding,
      id: tab.getId(),
      localPtyTarget: readLocalPtyTargetConfig(config.localPtyTarget),
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
      port: session?.port,
      session,
      title: tab.getName(),
      username: session?.username,
    });
  });

  return explorers;
}

function isWorkspacePanelType(value: unknown): value is WorkspacePanelType {
  return value === 'terminal' || value === 'sftp' || value === 'ai' || value === 'rdp' || value === 'vnc' || value === 'settings';
}

function readLocalPtyTargetConfig(value: unknown): WorkspaceTabItem['localPtyTarget'] {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const target = value as Partial<WorkspaceLocalPtyTarget>;

  if (typeof target.command !== 'string' || target.command.trim().length === 0) {
    return undefined;
  }

  return {
    args: Array.isArray(target.args)
      ? target.args.filter((arg): arg is string => typeof arg === 'string')
      : undefined,
    command: target.command,
    cwd: typeof target.cwd === 'string' ? target.cwd : undefined,
  };
}
