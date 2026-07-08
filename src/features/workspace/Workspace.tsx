import { Layout, Model, type TabNode } from 'flexlayout-react';
import { useEffect, useMemo, useState } from 'react';

import {
  subscribeConnectionStatus,
  type ConnectionStatus,
} from '@/features/connections/connectionStatus';
import type { WorkspaceTabItem } from '@/types/workspace';
import { notifyTerminalClosing, notifyTerminalReconnect } from '@/features/terminal/terminalLifecycle';
import { createPanelFactory } from './panelFactory';
import { readSessionConfig, WorkspaceTabMenu, type WorkspaceTabMenuState } from './WorkspaceTabMenu';
import { createWorkspaceActionHandler, getSelectedPanelId } from './workspaceLayoutActions';
import { createShortPanelId } from './workspaceNodeUtils';
import {
  closeFlexLayoutTabOnMiddleClick,
  closeLayoutNodeOnMiddleClick,
  createWorkspaceTabRenderer,
  renderWorkspaceDragPreview,
  type WorkspaceTabIdentity,
} from './workspaceTabs';

export function Workspace({
  lastAddedPanelId,
  model,
  onModelChange,
  onOpenAi,
  onOpenSftp,
}: {
  lastAddedPanelId?: string;
  model: Model;
  onModelChange: (model: Model) => void;
  onOpenAi?: (tab: WorkspaceTabItem) => void;
  onOpenSftp?: Parameters<typeof createPanelFactory>[0]['onOpenSftp'];
}) {
  const [activePanelId, setActivePanelId] = useState<string | undefined>();
  const [closingPanelIds] = useState(() => new Set<string>());
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const [tabMenu, setTabMenu] = useState<WorkspaceTabMenuState>();
  const effectiveActivePanelId = getSelectedPanelId(model) ?? activePanelId;
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, ConnectionStatus>>({});
  const factory = useMemo(
    () =>
      createPanelFactory({
        activePanelId: effectiveActivePanelId,
        onActivatePanel: setActivePanelId,
        onOpenSftp,
      }),
    [effectiveActivePanelId, onOpenSftp],
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

  const renderTab = useMemo(
    () =>
      createWorkspaceTabRenderer({
        activePanelId: effectiveActivePanelId,
        connectionStatuses,
        tabIdentities: collectWorkspaceTabIdentities(model),
      }),
    [connectionStatuses, effectiveActivePanelId, model, workspaceVersion],
  );
  return (
    <section className="grid min-w-0 grid-rows-[minmax(0,1fr)] bg-background">
      <div className="min-h-0 min-w-0">
        <div
          className="workspace-frame relative h-full overflow-hidden"
          onAuxClickCapture={(event) => closeFlexLayoutTabOnMiddleClick({ event, requestTabClose })}
          onMouseDownCapture={(event) => closeFlexLayoutTabOnMiddleClick({ event, requestTabClose })}
        >
          <Layout
            model={model}
            factory={factory}
            onAction={handleLayoutAction}
            onAuxMouseClick={(node, event) => closeLayoutNodeOnMiddleClick({ event, node, requestTabClose })}
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
            onRenderDragRect={renderWorkspaceDragPreview}
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
              onDisconnect={() => {
                notifyTerminalClosing(tabMenu.node.getId());
                setTabMenu(undefined);
              }}
              onOpenAi={() => {
                const config = tabMenu.node.getConfig() as {
                  panelType?: WorkspaceTabItem['type'];
                  session?: unknown;
                };

                if (!config.panelType) {
                  return;
                }

                onOpenAi?.({
                  id: tabMenu.node.getId(),
                  session: readSessionConfig(config.session),
                  title: tabMenu.node.getName(),
                  type: config.panelType,
                });
                setTabMenu(undefined);
              }}
              onOpenSftp={(session) => {
                onOpenSftp?.(session);
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

function collectWorkspaceTabIdentities(model: Model) {
  const counters = new Map<string, number>();
  const identities: Record<string, WorkspaceTabIdentity> = {};

  model.visitNodes((node) => {
    if (node.getType() !== 'tab') {
      return;
    }

    const tab = node as TabNode;
    const config = tab.getConfig() as { panelType?: string; session?: unknown };

    if (config.panelType !== 'terminal' && config.panelType !== 'sftp') {
      return;
    }

    const session = readSessionConfig(config.session);

    if (!session) {
      return;
    }

    const key = `${config.panelType}:${session.id || session.username || ''}:${session.host || session.name}`;
    const ordinal = (counters.get(key) ?? 0) + 1;
    counters.set(key, ordinal);

    identities[tab.getId()] = {
      kindLabel: config.panelType === 'sftp' ? 'SFTP' : 'SSH',
      ordinal,
      shortId: createShortPanelId(tab.getId()),
    };
  });

  return identities;
}
