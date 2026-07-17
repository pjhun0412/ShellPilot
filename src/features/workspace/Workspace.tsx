import { Actions, Layout, Model, type TabNode } from 'flexlayout-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  subscribeConnectionStatus,
  type ConnectionStatus,
} from '@/features/connections/connectionStatus';
import { subscribeNotesMetaChanged } from '@/features/notes/notesNavigation';
import {
  requestSftpSidebarDisconnect,
  requestSftpSidebarReconnect,
  subscribeSftpSidebarDisconnect,
} from '@/features/sftp/sftpSidebarState';
import { subscribeSessionPatch } from '@/features/sessions/sessionStorage';
import { requestRdpDisconnect, requestRdpReconnect } from '@/features/rdp/rdpPanelLifecycle';
import { requestVncDisconnect, requestVncReconnect } from '@/features/vnc/vncPanelLifecycle';
import type { WorkspacePanelType, WorkspaceTabItem } from '@/types/workspace';
import {
  notifyTerminalDisconnect,
  notifyTerminalReconnect,
  subscribeTerminalDisconnect,
} from '@/features/terminal/terminalLifecycle';
import { querySshCurrentDirectory } from '@/features/terminal/sshTerminalBridge';
import { focusRegisteredTerminal } from '@/features/terminal/terminalRegistry';
import { createPanelFactory } from './panelFactory';
import { readSessionConfig, WorkspaceTabMenu, type WorkspaceTabMenuState } from './WorkspaceTabMenu';
import { createWorkspaceActionHandler, getSelectedPanelId } from './workspaceLayoutActions';
import { createShortPanelId, focusWorkspaceTab, getBoundAiTabIds } from './workspaceNodeUtils';
import { isCloseTabShortcut, shouldIgnoreWorkspaceShortcut } from './workspaceShortcuts';
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
  const [activeContextPanelId, setActiveContextPanelId] = useState<string | undefined>();
  const effectiveActivePanelId = getSelectedPanelId(model) ?? activePanelId;
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, ConnectionStatus>>({});
  const activatePanel = useCallback(
    (panelId: string) => {
      if (effectiveActivePanelId === panelId) {
        return;
      }

      focusWorkspaceTab(model, panelId);
      setActivePanelId(panelId);
      onModelChange(model);
      setWorkspaceVersion((version) => version + 1);
    },
    [effectiveActivePanelId, model, onModelChange],
  );
  const factory = useMemo(
    () =>
      createPanelFactory({
        activePanelId: effectiveActivePanelId,
        onActivatePanel: activatePanel,
        onOpenSftp,
      }),
    [activatePanel, effectiveActivePanelId, onOpenSftp],
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
    return subscribeSessionPatch(({ patch, sessionId }) => {
      let didUpdate = false;

      model.visitNodes((node) => {
        if (node.getType() !== 'tab') {
          return;
        }

        const tab = node as TabNode;
        const config = tab.getConfig() as {
          panelType?: WorkspacePanelType;
          session?: unknown;
        };

        if (
          config.panelType !== 'terminal' &&
          config.panelType !== 'sftp' &&
          config.panelType !== 'rdp' &&
          config.panelType !== 'vnc'
        ) {
          return;
        }

        const session = readSessionConfig(config.session);

        if (session?.id !== sessionId) {
          return;
        }

        model.doAction(
          Actions.updateNodeAttributes(tab.getId(), {
            config: {
              ...config,
              session: {
                ...session,
                ...patch,
                updatedAt: Date.now(),
              },
            },
          } as never),
        );
        if (typeof patch.name === 'string' && patch.name.trim()) {
          model.doAction(Actions.renameTab(tab.getId(), createSessionPanelTitle(config.panelType, patch.name.trim())));
        }
        didUpdate = true;
      });

      if (didUpdate) {
        onModelChange(model);
        setWorkspaceVersion((version) => version + 1);
      }
    });
  }, [model, onModelChange]);

  useEffect(() => {
    return subscribeNotesMetaChanged((notes) => {
      let didUpdate = false;

      model.visitNodes((node) => {
        if (node.getType() !== 'tab') {
          return;
        }

        const tab = node as TabNode;
        const config = tab.getConfig() as {
          noteId?: string;
          panelType?: WorkspacePanelType;
        };

        if (config.panelType !== 'note' || !config.noteId) {
          return;
        }

        const note = notes.find((candidate) => candidate.id === config.noteId);

        if (!note) {
          return;
        }

        model.doAction(
          Actions.updateNodeAttributes(tab.getId(), {
            config: {
              ...config,
              noteId: note.id,
            },
          } as never),
        );
        model.doAction(Actions.renameTab(tab.getId(), `${note.title}.md`));
        didUpdate = true;
      });

      if (didUpdate) {
        onModelChange(model);
        setWorkspaceVersion((version) => version + 1);
      }
    });
  }, [model, onModelChange]);

  useEffect(() => {
    if (lastAddedPanelId) {
      setActivePanelId(lastAddedPanelId);
    }
  }, [lastAddedPanelId]);

  useEffect(() => {
    if (model.toJson().global?.tabSetEnableTabScrollbar === true) {
      return;
    }

    model.doAction(Actions.updateModelAttributes({ tabSetEnableTabScrollbar: true }));
    onModelChange(model);
    setWorkspaceVersion((version) => version + 1);
  }, [model, onModelChange]);

  useEffect(() => {
    const closeActiveTab = (event: KeyboardEvent) => {
      if (!isCloseTabShortcut(event) || shouldIgnoreWorkspaceShortcut(event)) {
        return;
      }

      const panelId = getSelectedPanelId(model) ?? effectiveActivePanelId;

      if (!panelId || model.getNodeById(panelId)?.getType() !== 'tab') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      requestTabClose(panelId);
    };

    window.addEventListener('keydown', closeActiveTab, true);

    return () => window.removeEventListener('keydown', closeActiveTab, true);
  }, [effectiveActivePanelId, model, requestTabClose]);

  useEffect(() => {
    const closeBoundAiTabs = (sourcePanelId: string) => {
      const boundAiTabIds = getBoundAiTabIds(model, sourcePanelId);

      if (boundAiTabIds.length === 0) {
        return;
      }

      boundAiTabIds.forEach((tabId) => {
        if (model.getNodeById(tabId)?.getType() === 'tab') {
          model.doAction(Actions.deleteTab(tabId));
        }
      });
      onModelChange(model);
      setWorkspaceVersion((version) => version + 1);
    };
    const unsubscribeTerminalDisconnect = subscribeTerminalDisconnect(closeBoundAiTabs);
    const unsubscribeSftpDisconnect = subscribeSftpSidebarDisconnect(({ panelId }) => {
      closeBoundAiTabs(panelId);
    });

    return () => {
      unsubscribeTerminalDisconnect();
      unsubscribeSftpDisconnect();
    };
  }, [model, onModelChange]);

  useEffect(() => {
    const selectedContextPanelId = getSelectedContextPanelId(model, effectiveActivePanelId);

    if (selectedContextPanelId) {
      setActiveContextPanelId(selectedContextPanelId);
    }
  }, [effectiveActivePanelId, model, workspaceVersion]);

  useEffect(() => {
    if (!effectiveActivePanelId) {
      return;
    }

    focusRegisteredTerminal(effectiveActivePanelId);
  }, [effectiveActivePanelId]);

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
        activeContextPanelId,
        activePanelId: effectiveActivePanelId,
        connectionStatuses,
        tabIdentities: collectWorkspaceTabIdentities(model),
      }),
    [activeContextPanelId, connectionStatuses, effectiveActivePanelId, model, workspaceVersion],
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
                const config = tabMenu.node.getConfig() as {
                  panelType?: WorkspaceTabItem['type'];
                };

                if (config.panelType === 'sftp') {
                  requestSftpSidebarDisconnect(tabMenu.node.getId());
                } else if (config.panelType === 'rdp') {
                  requestRdpDisconnect(tabMenu.node.getId());
                } else if (config.panelType === 'vnc') {
                  requestVncDisconnect(tabMenu.node.getId());
                } else {
                  notifyTerminalDisconnect(tabMenu.node.getId());
                }
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
                const panelId = tabMenu.node.getId();
                void querySshCurrentDirectory(panelId).then((initialPath) => {
                  onOpenSftp?.(session, { initialPath, revealInSidebar: false });
                });
                setTabMenu(undefined);
              }}
              onReconnect={() => {
                const config = tabMenu.node.getConfig() as {
                  panelType?: WorkspaceTabItem['type'];
                };

                if (config.panelType === 'sftp') {
                  requestSftpSidebarReconnect(tabMenu.node.getId());
                } else if (config.panelType === 'rdp') {
                  requestRdpReconnect(tabMenu.node.getId());
                } else if (config.panelType === 'vnc') {
                  requestVncReconnect(tabMenu.node.getId());
                } else {
                  notifyTerminalReconnect(tabMenu.node.getId());
                }
                setTabMenu(undefined);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function getSelectedContextPanelId(model: Model, selectedPanelId: string | undefined) {
  if (!selectedPanelId) {
    return undefined;
  }

  const selectedNode = model.getNodeById(selectedPanelId);

  if (selectedNode?.getType() !== 'tab') {
    return undefined;
  }

  const config = (selectedNode as TabNode).getConfig() as { panelType?: WorkspacePanelType };

  return config.panelType === 'terminal' || config.panelType === 'sftp'
    ? selectedNode.getId()
    : undefined;
}

function createSessionPanelTitle(panelType: WorkspacePanelType | undefined, sessionName: string) {
  if (panelType === 'sftp') {
    return `SFTP - ${sessionName}`;
  }

  if (panelType === 'rdp') {
    return `RDP - ${sessionName}`;
  }

  if (panelType === 'vnc') {
    return `VNC - ${sessionName}`;
  }

  return `SSH - ${sessionName}`;
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
