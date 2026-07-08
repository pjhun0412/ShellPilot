import { Actions, type Model, type TabNode } from 'flexlayout-react';

export function getSelectedPanelId(model: Model) {
  const selectedNode = model.getActiveTabset()?.getSelectedNode();

  if (selectedNode?.getType() !== 'tab') {
    return undefined;
  }

  return selectedNode.getId();
}

export function getTabIds(model: Model) {
  const tabIds: string[] = [];

  model.visitNodes((node) => {
    if (node.getType() === 'tab') {
      tabIds.push(node.getId());
    }
  });

  return tabIds;
}

export function getBoundAiTabIds(model: Model, sourcePanelId: string) {
  const tabIds: string[] = [];

  model.visitNodes((node) => {
    if (node.getType() !== 'tab') {
      return;
    }

    const tab = node as TabNode;
    const config = tab.getConfig() as {
      aiBinding?: { boundPanelId?: string };
      panelType?: string;
    };

    if (config.panelType === 'ai' && config.aiBinding?.boundPanelId === sourcePanelId) {
      tabIds.push(tab.getId());
    }
  });

  return tabIds;
}

export function getCascadeCloseTabIds(model: Model, sourcePanelId: string) {
  return [sourcePanelId, ...getBoundAiTabIds(model, sourcePanelId)];
}

export function getNextActivePanelIdAfterClose({
  closingPanelId,
  closingPanelIds,
  currentActivePanelId,
  model,
}: {
  closingPanelId: string;
  closingPanelIds: Set<string>;
  currentActivePanelId: string | undefined;
  model: Model;
}) {
  if (currentActivePanelId && !closingPanelIds.has(currentActivePanelId)) {
    return currentActivePanelId;
  }

  const closingNode = model.getNodeById(closingPanelId);
  const siblingNodes = closingNode?.getParent()?.getChildren() ?? [];
  const closingIndex = siblingNodes.findIndex((node) => node.getId() === closingPanelId);

  if (closingIndex < 0) {
    return undefined;
  }

  for (let index = closingIndex - 1; index >= 0; index -= 1) {
    const candidate = siblingNodes[index];

    if (candidate?.getType() === 'tab' && !closingPanelIds.has(candidate.getId())) {
      return candidate.getId();
    }
  }

  for (let index = closingIndex + 1; index < siblingNodes.length; index += 1) {
    const candidate = siblingNodes[index];

    if (candidate?.getType() === 'tab' && !closingPanelIds.has(candidate.getId())) {
      return candidate.getId();
    }
  }

  return undefined;
}

export function isTerminalLikeTab(tabNode: TabNode) {
  const config = tabNode.getConfig() as { panelType?: string; session?: unknown };

  return config.panelType === 'terminal' || Boolean(config.session);
}

export function getBottomBorderId(model: Model) {
  return model
    .getBorderSet()
    .getBorders()
    .find((border) => border.getLocation().getName() === 'bottom')
    ?.getId();
}

export function getSelectedBottomBorderTab(model: Model) {
  return model
    .getBorderSet()
    .getBorders()
    .find((border) => border.getLocation().getName() === 'bottom')
    ?.getSelectedNode();
}

export function focusWorkspaceTab(model: Model, tabId: string) {
  const tabNode = model.getNodeById(tabId);

  if (tabNode?.getType() !== 'tab') {
    return;
  }

  model.doAction(Actions.selectTab(tabId));

  const parentNode = tabNode.getParent();

  if (parentNode?.getType() !== 'border') {
    return;
  }

  const tabIndex = parentNode
    .getChildren()
    .findIndex((childNode) => childNode.getType() === 'tab' && childNode.getId() === tabId);

  if (tabIndex >= 0) {
    model.doAction(Actions.updateNodeAttributes(parentNode.getId(), { selected: tabIndex, show: true } as never));
  }
}

export function createShortPanelId(panelId: string) {
  const trimmed = panelId.replace(/[^a-zA-Z0-9]/g, '');

  return trimmed.slice(-5) || panelId.slice(-5);
}
