import { Layout, Model, type BorderNode, type TabNode, type TabSetNode } from 'flexlayout-react';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import {
  subscribeConnectionStatus,
  type ConnectionStatus,
} from '@/features/connections/connectionStatus';
import { notifyTerminalReconnect } from '@/features/terminal/terminalLifecycle';
import { createPanelFactory } from './panelFactory';
import { readSessionConfig, WorkspaceTabMenu, type WorkspaceTabMenuState } from './WorkspaceTabMenu';
import { createWorkspaceActionHandler, getSelectedPanelId } from './workspaceLayoutActions';

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
  const [, setWorkspaceVersion] = useState(0);
  const [tabMenu, setTabMenu] = useState<WorkspaceTabMenuState>();
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
  const {
    closeOtherTabs,
    closeTabsToRight,
    duplicateTab,
    handleLayoutAction,
    requestTabClose,
  } = useMemo(
    () =>
      createWorkspaceActionHandler({
        activePanelId,
        closingPanelIds,
        effectiveActivePanelId,
        model,
        onModelChange,
        onWorkspaceMutation: () => setWorkspaceVersion((version) => version + 1),
        setActivePanelId,
      }),
    [activePanelId, closingPanelIds, effectiveActivePanelId, model, onModelChange],
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

  useEffect(() => {
    if (!tabMenu) {
      return;
    }

    const closeMenu = () => setTabMenu(undefined);
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', closeMenuOnEscape);

    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [tabMenu]);

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
  return (
    <section className="grid min-w-0 grid-rows-[minmax(0,1fr)] bg-background">
      <div className="min-h-0 min-w-0 p-3">
        <div className="workspace-frame relative h-full overflow-hidden rounded-lg border shadow-workspace">
          <Layout
            model={model}
            factory={factory}
            onAction={handleLayoutAction}
            onAuxMouseClick={closeTabOnMiddleClick}
            onContextMenu={(node, event) => {
              if (node.getType() !== 'tab') {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              setTabMenu({
                node: node as TabNode,
                session: readSessionConfig((node as TabNode).getConfig()?.session),
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onModelChange={onModelChange}
            onRenderDragRect={renderDragPreview}
            onRenderTab={renderTab}
            tabDragSpeed={0.12}
          />
          {tabMenu && (
            <WorkspaceTabMenu
              menu={tabMenu}
              onClone={() => {
                duplicateTab(tabMenu.node);
                setTabMenu(undefined);
              }}
              onClose={() => {
                requestTabClose(tabMenu.node.getId());
                setTabMenu(undefined);
              }}
              onCloseOthers={() => {
                closeOtherTabs(tabMenu.node.getId());
                setTabMenu(undefined);
              }}
              onCloseRight={() => {
                closeTabsToRight(tabMenu.node);
                setTabMenu(undefined);
              }}
              onReconnect={() => {
                notifyTerminalReconnect(tabMenu.node.getId());
                setTabMenu(undefined);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
