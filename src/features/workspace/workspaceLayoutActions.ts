import { Actions, DockLocation, type Action, type Model, type TabNode } from 'flexlayout-react';

import { notifyTerminalClosing } from '@/features/terminal/terminalLifecycle';
import {
  getBoundAiTabIds,
  getNextActivePanelIdAfterClose,
  getSelectedPanelId,
  getTabIds,
  isTerminalPanelTab,
} from './workspaceNodeUtils';
export { getSelectedPanelId };

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

    const boundAiTabIds = getBoundAiTabIds(model, panelId);
    const closingTabIds = new Set([panelId, ...boundAiTabIds]);
    const nextActivePanelId = getNextActivePanelIdAfterClose({
      closingPanelId: panelId,
      closingPanelIds: closingTabIds,
      currentActivePanelId: effectiveActivePanelId,
      model,
    });
    const closeTab = () => {
      model.doAction(Actions.deleteTab(panelId));
      boundAiTabIds.forEach((tabId) => {
        if (model.getNodeById(tabId)?.getType() === 'tab') {
          model.doAction(Actions.deleteTab(tabId));
        }
      });
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

    if (isTerminalPanelTab(closingNode as TabNode)) {
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
