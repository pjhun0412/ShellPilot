import { TabNode } from 'flexlayout-react';

import { LogsPanel, PanelBody } from '@/features/panels/PanelBody';
import { panelCatalog } from '@/features/panels/panelCatalog';
import type { WorkspacePanel, WorkspacePanelType } from '@/types/workspace';

export function createPanelFactory({
  activePanelId,
  onActivatePanel,
  onOpenSftp,
}: {
  activePanelId?: string;
  onActivatePanel: (panelId: string) => void;
  onOpenSftp?: (session: NonNullable<WorkspacePanel['session']>) => void;
}) {
  return function panelFactory(node: TabNode) {
    const panelId = node.getId();
    const isActive = activePanelId === panelId;
    const activatePanel = () => onActivatePanel(panelId);
    const config = node.getConfig() as {
      autoConnect?: boolean;
      panelType?: WorkspacePanelType | 'logs';
      session?: WorkspacePanel['session'];
    };
    const panelType = config.panelType ?? resolvePanelType(panelId);

    if (panelType === 'logs') {
      return <LogsPanel isActive={isActive} onActivate={activatePanel} />;
    }

    const panel =
      panelCatalog.find((item) => item.id === panelId) ??
      ({
        id: panelId,
        autoConnect: config.autoConnect,
        session: config.session,
        title: node.getName(),
        type: panelType,
      } satisfies WorkspacePanel);

    return <PanelBody isActive={isActive} onActivate={activatePanel} panel={panel} onOpenSftp={onOpenSftp} />;
  };
}

export function panelFactory(node: TabNode) {
  const config = node.getConfig() as {
    autoConnect?: boolean;
    panelType?: WorkspacePanelType | 'logs';
    session?: WorkspacePanel['session'];
  };
  const panelType = config.panelType ?? resolvePanelType(node.getId());

  if (panelType === 'logs') {
    return <LogsPanel />;
  }

  const panel =
    panelCatalog.find((item) => item.id === node.getId()) ??
    ({
      id: node.getId(),
      autoConnect: config.autoConnect,
      session: config.session,
      title: node.getName(),
      type: panelType,
    } satisfies WorkspacePanel);

  return <PanelBody panel={panel} />;
}

function resolvePanelType(id: string): WorkspacePanelType {
  return panelCatalog.find((panel) => panel.id === id)?.type ?? 'terminal';
}
