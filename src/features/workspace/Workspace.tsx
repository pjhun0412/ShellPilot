import { Actions, Layout, Model, type Action, type BorderNode, type TabNode, type TabSetNode } from 'flexlayout-react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  subscribeConnectionStatus,
  type ConnectionStatus,
} from '@/features/connections/connectionStatus';
import { notifyTerminalClosing } from '@/features/terminal/terminalLifecycle';
import { createPanelFactory } from './panelFactory';

export function Workspace({
  lastAddedPanelId,
  model,
  onModelChange,
}: {
  lastAddedPanelId?: string;
  model: Model;
  onModelChange: (model: Model) => void;
}) {
  const [activePanelId, setActivePanelId] = useState<string | undefined>();
  const [closingPanelIds] = useState(() => new Set<string>());
  const effectiveActivePanelId = activePanelId ?? getSelectedPanelId(model);
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, ConnectionStatus>>({});
  const factory = useMemo(
    () =>
      createPanelFactory({
        activePanelId: effectiveActivePanelId,
        onActivatePanel: setActivePanelId,
      }),
    [effectiveActivePanelId],
  );

  useEffect(() => {
    return subscribeConnectionStatus(({ panelId, status }) => {
      setConnectionStatuses((current) => ({
        ...current,
        [panelId]: status,
      }));
    });
  }, []);

  useEffect(() => {
    if (lastAddedPanelId) {
      setActivePanelId(lastAddedPanelId);
    }
  }, [lastAddedPanelId]);

  const closeTabOnMiddleClick = (
    node: TabNode | TabSetNode | BorderNode,
    event: React.MouseEvent<HTMLElement, MouseEvent>,
  ) => {
    if (event.button !== 1 || node.getType() !== 'tab') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    requestTabClose(node.getId());
  };
  const renderDragPreview = (content: React.ReactNode) => {
    return (
      <div className="rounded border border-primary/60 bg-card px-2 py-1 text-xs text-foreground shadow-lg">
        {content}
      </div>
    );
  };
  const renderTab = (
    node: TabNode,
    renderValues: { content: React.ReactNode; leading: React.ReactNode },
  ) => {
    const config = node.getConfig() as { session?: unknown };
    const isActive = effectiveActivePanelId === node.getId();

    renderValues.content = (
      <span className={cn('shellpilot-tab-title', isActive && 'shellpilot-tab-title--active')}>
        {node.getName()}
      </span>
    );

    if (!config.session) {
      return;
    }

    renderValues.leading = (
      <span
        className={cn(
          'size-2 rounded-full bg-muted-foreground/45',
          isActive && 'shadow-[0_0_0_2px_hsl(var(--background))]',
          connectionStatuses[node.getId()] === 'connecting' && 'animate-pulse bg-primary',
          connectionStatuses[node.getId()] === 'connected' && 'bg-[hsl(var(--workspace-success))]',
          connectionStatuses[node.getId()] === 'failed' && 'bg-destructive',
        )}
      />
    );
  };
  const handleLayoutAction = (action: Action) => {
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
  const requestTabClose = (panelId: string) => {
    if (closingPanelIds.has(panelId)) {
      return;
    }

    const nextActivePanelId = getNextActivePanelIdAfterClose(model, panelId, effectiveActivePanelId);

    closingPanelIds.add(panelId);
    notifyTerminalClosing(panelId);
    window.setTimeout(() => {
      model.doAction(Actions.deleteTab(panelId));
      if (nextActivePanelId) {
        model.doAction(Actions.selectTab(nextActivePanelId));
      }
      setActivePanelId(nextActivePanelId);
      onModelChange(model);
    }, 180);
  };

  return (
    <section className="grid min-w-0 grid-rows-[minmax(0,1fr)] bg-background/60">
      <div className="min-h-0 min-w-0 p-3">
        <div className="workspace-frame relative h-full overflow-hidden rounded-lg border bg-card shadow-workspace">
          <Layout
            model={model}
            factory={factory}
            onAction={handleLayoutAction}
            onAuxMouseClick={closeTabOnMiddleClick}
            onModelChange={onModelChange}
            onRenderDragRect={renderDragPreview}
            onRenderTab={renderTab}
          />
        </div>
      </div>
    </section>
  );
}

function getSelectedPanelId(model: Model) {
  const selectedNode = model.getActiveTabset()?.getSelectedNode();

  if (selectedNode?.getType() !== 'tab') {
    return undefined;
  }

  return selectedNode.getId();
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
