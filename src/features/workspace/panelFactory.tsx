import { TabNode } from 'flexlayout-react';

import { PanelBody } from '@/features/panels/PanelBody';
import { panelCatalog } from '@/features/panels/panelCatalog';
import { SftpTransferQueuePanel } from '@/features/sftp/SftpTransferQueuePanel';
import type { OpenSftpHandler, WorkspacePanel, WorkspacePanelType } from '@/types/workspace';

export function createPanelFactory({
  activePanelId,
  onActivatePanel,
  onOpenSftp,
}: {
  activePanelId?: string;
  onActivatePanel: (panelId: string) => void;
  onOpenSftp?: OpenSftpHandler;
}) {
  return function panelFactory(node: TabNode) {
    const panelId = node.getId();
    const isActive = activePanelId === panelId;
    const activatePanel = () => onActivatePanel(panelId);
    const config = readPanelConfig(node);
    const panelType = config.panelType ?? resolvePanelType(panelId);

    if (panelType === 'sftp-transfer-queue') {
      return <SftpTransferQueuePanel />;
    }

    const panel = createWorkspacePanelFromNode(node, panelType, config);

    return <PanelBody isActive={isActive} onActivate={activatePanel} panel={panel} onOpenSftp={onOpenSftp} />;
  };
}

export function panelFactory(node: TabNode) {
  const config = readPanelConfig(node);
  const panelType = config.panelType ?? resolvePanelType(node.getId());

  if (panelType === 'sftp-transfer-queue') {
    return <SftpTransferQueuePanel />;
  }

  const panel = createWorkspacePanelFromNode(node, panelType, config);

  return <PanelBody panel={panel} />;
}

type PanelNodeConfig = {
  aiBinding?: WorkspacePanel['aiBinding'];
  autoConnect?: boolean;
  initialPath?: WorkspacePanel['initialPath'];
  localPtyTarget?: WorkspacePanel['localPtyTarget'];
  panelType?: WorkspacePanelType | 'sftp-transfer-queue';
  session?: WorkspacePanel['session'];
};

function readPanelConfig(node: TabNode): PanelNodeConfig {
  return node.getConfig() as PanelNodeConfig;
}

function createWorkspacePanelFromNode(
  node: TabNode,
  panelType: WorkspacePanelType,
  config: PanelNodeConfig,
): WorkspacePanel {
  return (
    panelCatalog.find((item) => item.id === node.getId()) ??
    ({
      aiBinding: config.aiBinding,
      id: node.getId(),
      autoConnect: config.autoConnect,
      initialPath: config.initialPath,
      localPtyTarget: config.localPtyTarget,
      session: config.session,
      title: node.getName(),
      type: panelType,
    } satisfies WorkspacePanel)
  );
}

function resolvePanelType(id: string): WorkspacePanelType {
  return panelCatalog.find((panel) => panel.id === id)?.type ?? 'terminal';
}
