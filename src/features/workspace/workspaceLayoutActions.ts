import { Actions, DockLocation, type Action, type Model, type TabNode } from 'flexlayout-react';

import { notifyTerminalClosing } from '@/features/terminal/terminalLifecycle';

export function getSelectedPanelId(model: Model) {
  const selectedNode = model.getActiveTabset()?.getSelectedNode();

  if (selectedNode?.getType() !== 'tab') {
    return undefined;
  }

  return selectedNode.getId();
}

export function createWorkspaceActionHandler({
  activePanelId,
  closingPanelIds,
  effectiveActivePanelId,
  model,
  onModelChange,
  onWorkspaceMutation,
  setActivePanelId,
}: {
  activePanelId?: string;
  closingPanelIds: Set<string>;
  effectiveActivePanelId?: string;
  model: Model;
  onModelChange: (model: Model) => void;
  onWorkspaceMutation: () => void;
  setActivePanelId: (panelId: string | undefined) => void;
}) {
  const requestTabClose = (panelId: string) => {
    const closingNode = model.getNodeById(panelId);

    if (!closingNode || closingNode.getType() !== 'tab') {
      closingPanelIds.delete(panelId);
      return;
    }

    const nextActivePanelId = getNextActivePanelIdAfterClose(model, panelId, effectiveActivePanelId);
    const closeTab = () => {
      model.doAction(Actions.deleteTab(panelId));
      if (nextActivePanelId) {
        model.doAction(Actions.selectTab(nextActivePanelId));
      }
      setActivePanelId(nextActivePanelId);
      onModelChange(model);
      onWorkspaceMutation();
    };

    if (closingPanelIds.has(panelId)) {
      closeTab();
      return;
    }

    closingPanelIds.add(panelId);

    if (isTerminalTab(closingNode as TabNode)) {
      notifyTerminalClosing(panelId);
      window.setTimeout(closeTab, 180);
      return;
    }

    closeTab();
  };
  const duplicateTab = (tabNode: TabNode) => {
    const tabJson = tabNode.toJson();
    const duplicatedTabId = `${tabNode.getId()}-${Date.now()}`;

    model.doAction(
      Actions.addTab(
        {
          ...tabJson,
          id: duplicatedTabId,
          name: tabNode.getName(),
        },
        tabNode.getParent()?.getId() ?? model.getActiveTabset()?.getId() ?? model.getFirstTabSet().getId(),
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    model.doAction(Actions.selectTab(duplicatedTabId));
    setActivePanelId(duplicatedTabId);
    onModelChange(model);
    onWorkspaceMutation();
    window.requestAnimationFrame(() => {
      model.doAction(Actions.selectTab(duplicatedTabId));
      setActivePanelId(duplicatedTabId);
      onModelChange(model);
      onWorkspaceMutation();
    });
  };
  const closeOtherTabs = (panelId: string) => {
    getTabIds(model)
      .filter((tabId) => tabId !== panelId)
      .forEach(requestTabClose);
  };
  const closeTabsToRight = (tabNode: TabNode) => {
    const siblingTabs = tabNode
      .getParent()
      ?.getChildren()
      .filter((node): node is TabNode => node.getType() === 'tab') ?? [];
    const tabIndex = siblingTabs.findIndex((node) => node.getId() === tabNode.getId());

    if (tabIndex < 0) {
      return;
    }

    siblingTabs.slice(tabIndex + 1).forEach((node) => requestTabClose(node.getId()));
  };

  const handleLayoutAction = (action: Action) => {
    if (action.type === Actions.MOVE_NODE && typeof action.data.fromNode === 'string') {
      const movedNode = model.getNodeById(action.data.fromNode);

      action.data.select = true;

      if (movedNode?.getType() === 'tab') {
        setActivePanelId(action.data.fromNode);
      }
    }

    if (action.type === Actions.SELECT_TAB && typeof action.data.tabNode === 'string') {
      setActivePanelId(action.data.tabNode);
    }

    if (action.type === Actions.ADD_TAB && typeof action.data.json?.id === 'string' && action.data.select) {
      setActivePanelId(action.data.json.id);
    }

    if (action.type === Actions.DELETE_TAB && typeof action.data.node === 'string') {
      if (closingPanelIds.has(action.data.node)) {
        closingPanelIds.delete(action.data.node);

        if (action.data.node === activePanelId) {
          setActivePanelId(undefined);
        }

        return action;
      }

      requestTabClose(action.data.node);
      return undefined;
    }

    return action;
  };

  return {
    closeOtherTabs,
    closeTabsToRight,
    duplicateTab,
    handleLayoutAction,
    requestTabClose,
  };
}

function isTerminalTab(tabNode: TabNode) {
  const config = tabNode.getConfig() as { panelType?: string; session?: unknown };

  return config.panelType === 'terminal' || Boolean(config.session);
}

function getTabIds(model: Model) {
  const tabIds: string[] = [];

  model.visitNodes((node) => {
    if (node.getType() === 'tab') {
      tabIds.push(node.getId());
    }
  });

  return tabIds;
}

function getNextActivePanelIdAfterClose(
  model: Model,
  closingPanelId: string,
  currentActivePanelId: string | undefined,
) {
  if (currentActivePanelId && currentActivePanelId !== closingPanelId) {
    return currentActivePanelId;
  }

  const closingNode = model.getNodeById(closingPanelId);
  const siblingNodes = closingNode?.getParent()?.getChildren() ?? [];
  const closingIndex = siblingNodes.findIndex((node) => node.getId() === closingPanelId);

  if (closingIndex < 0) {
    return undefined;
  }

  const previousNode = siblingNodes[closingIndex - 1];
  const nextNode = siblingNodes[closingIndex + 1];

  if (previousNode?.getType() === 'tab') {
    return previousNode.getId();
  }

  if (nextNode?.getType() === 'tab') {
    return nextNode.getId();
  }

  return undefined;
}
