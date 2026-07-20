import { Actions, DockLocation, Model, type TabNode } from 'flexlayout-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ActivityBar } from '@/components/navigation/ActivityBar';
import { SidebarShell } from '@/components/navigation/SidebarShell';
import { AppDialogProvider } from '@/components/ui/app-dialog';
import { MenuBar } from '@/components/shell/MenuBar';
import { initializeWindowStatePersistence } from '@/features/settings/windowState';
import { panelCatalog } from '@/features/panels/panelCatalog';
import {
  requestSftpSidebarNavigation,
} from '@/features/sftp/sftpSidebarState';
import { subscribeSftpTransferQueueOpen } from '@/features/sftp/sftpTransferQueueState';
import { openElevatedLocalTerminal } from '@/features/terminal/localPtyBridge';
import { checkForShellPilotUpdate } from '@/features/updates/shellPilotUpdater';
import { Workspace } from '@/features/workspace/Workspace';
import {
  createBoundAiBinding,
  createBoundAiPanelId,
  createBoundAiTitle,
} from '@/features/workspace/boundAiWorkspace';
import { getSelectedPanelId } from '@/features/workspace/workspaceLayoutActions';
import { loadSavedLayout, saveWorkspaceLayout } from '@/features/workspace/workspaceLayout';
import {
  focusWorkspaceTab,
  getBottomBorderId,
  getCascadeCloseTabIds,
  getSelectedBottomBorderTab,
} from '@/features/workspace/workspaceNodeUtils';
import { collectSftpExplorers, collectWorkspaceTabs } from '@/features/workspace/workspaceTabCollection';
import type {
  ActivityId,
  OpenSftpOptions,
  WorkspaceLocalPtyTarget,
  WorkspacePanel,
  WorkspaceTabItem,
} from '@/types/workspace';

export function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(312);
  const [activeActivity, setActiveActivity] = useState<ActivityId>('sessions');
  const [lastAddedPanelId, setLastAddedPanelId] = useState<string>();
  const [layoutVersion, setLayoutVersion] = useState(0);
  const model = useMemo(() => {
    const nextModel = Model.fromJson(loadSavedLayout());
    nextModel.setSplitterSize(1);
    nextModel.setOnCreateTabSet(() => ({
      enableDivide: true,
      enableDrag: true,
      enableDrop: true,
    }));
    return nextModel;
  }, []);
  const modelRef = useRef(model);
  const didMountRef = useRef(false);
  const isHydratingLayoutRef = useRef(true);
  const layoutDirtyRef = useRef(false);
  const previousActivePanelIdRef = useRef<string>();

  useEffect(() => initializeWindowStatePersistence(), []);

  useEffect(() => {
    void checkForShellPilotUpdate({ source: 'startup' });
  }, []);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      isHydratingLayoutRef.current = false;
    }, 1000);

    return () => window.clearTimeout(hydrationTimer);
  }, []);

  const startSidebarResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      setSidebarWidth(clamp(moveEvent.clientX, 232, 440));
    };

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
  };

  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }

    if (isHydratingLayoutRef.current) {
      return;
    }

    layoutDirtyRef.current = true;

    const saveTimer = window.setTimeout(() => {
      saveWorkspaceLayout(modelRef.current.toJson());
      layoutDirtyRef.current = false;
    }, 450);

    return () => window.clearTimeout(saveTimer);
  }, [layoutVersion]);

  useEffect(() => {
    const suppressBrowserContextMenu = (event: MouseEvent) => {
      if (!event.defaultPrevented) {
        event.preventDefault();
      }
    };
    const suppressMiddleClickAutoScroll = (event: MouseEvent) => {
      if (event.button === 1 && !event.defaultPrevented) {
        event.preventDefault();
      }
    };
    const saveBeforeUnload = () => {
      if (!isHydratingLayoutRef.current && layoutDirtyRef.current) {
        saveWorkspaceLayout(modelRef.current.toJson());
      }
    };

    window.addEventListener('contextmenu', suppressBrowserContextMenu);
    window.addEventListener('mousedown', suppressMiddleClickAutoScroll);
    window.addEventListener('auxclick', suppressMiddleClickAutoScroll);
    window.addEventListener('beforeunload', saveBeforeUnload);
    return () => {
      window.removeEventListener('contextmenu', suppressBrowserContextMenu);
      window.removeEventListener('mousedown', suppressMiddleClickAutoScroll);
      window.removeEventListener('auxclick', suppressMiddleClickAutoScroll);
      window.removeEventListener('beforeunload', saveBeforeUnload);
    };
  }, []);

  const addPanel = (panel: WorkspacePanel) => {
    const existingNode = modelRef.current.getNodeById(panel.id);

    if ((panel.type === 'settings' || panel.type === 'ai') && existingNode?.getType() === 'tab') {
      modelRef.current.doAction(Actions.selectTab(panel.id));
      setLastAddedPanelId(panel.id);
      setLayoutVersion((version) => version + 1);
      return;
    }

    const activeTabset = modelRef.current.getActiveTabset() ?? modelRef.current.getFirstTabSet();
    const tabId = panel.type === 'settings' ? panel.id : `${panel.id}-${Date.now()}`;

    modelRef.current.doAction(
      Actions.addTab(
        {
          type: 'tab',
          id: tabId,
          name: panel.title,
          enableClose: true,
          component: 'panel',
          config: {
            autoConnect: true,
            initialPath: panel.initialPath,
            localPtyTarget: panel.localPtyTarget,
            panelType: panel.type,
            session: panel.session,
          },
        },
        activeTabset.getId(),
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    modelRef.current.doAction(Actions.selectTab(tabId));
    setLastAddedPanelId(tabId);
    setLayoutVersion((version) => version + 1);
  };
  const openSftpForSession = (
    session: NonNullable<WorkspacePanel['session']>,
    options: OpenSftpOptions = {},
  ) => {
    if (session.kind !== 'ssh' && session.kind !== 'sftp') {
      return;
    }

    addPanel({
      id: `sftp-${session.id}`,
      initialPath: options.initialPath,
      session,
      title: `SFTP - ${session.name}`,
      type: 'sftp',
    });
    if (options.revealInSidebar !== false) {
      setActiveActivity('files');
    }
  };
  const openLocalTerminal = ({
    target,
    title,
  }: {
    target: WorkspaceLocalPtyTarget;
    title: string;
  }) => {
    const panelId = `local-terminal-${crypto.randomUUID()}`;

    addPanel({
      id: panelId,
      localPtyTarget: target,
      title,
      type: 'terminal',
    });
  };
  const openElevatedTerminal = (shell: 'cmd' | 'powershell') => {
    void openElevatedLocalTerminal(shell).catch((error) => {
      console.error('failed to open elevated local terminal', error);
    });
  };
  const openSettings = () => {
    const settingsPanel = panelCatalog.find((panel) => panel.type === 'settings');

    if (settingsPanel) {
      addPanel(settingsPanel);
    }
  };
  const sftpExplorers = useMemo(
    () => collectSftpExplorers(modelRef.current),
    [layoutVersion],
  );
  const workspaceTabs = useMemo(
    () => collectWorkspaceTabs(modelRef.current),
    [layoutVersion],
  );
  const activePanelId = useMemo(() => getSelectedPanelId(modelRef.current), [layoutVersion]);
  const isAiAssistantVisible = useMemo(
    () => isBottomBorderViewVisible(modelRef.current, 'ai-assistant'),
    [layoutVersion],
  );
  const isTransferQueueVisible = useMemo(
    () => isBottomBorderViewVisible(modelRef.current, 'sftp-transfer-queue'),
    [layoutVersion],
  );
  useEffect(() => {
    if (previousActivePanelIdRef.current === activePanelId) {
      return;
    }

    previousActivePanelIdRef.current = activePanelId;

    syncSelectedBoundAiTab(modelRef.current, activePanelId, () => {
      setLastAddedPanelId(undefined);
      setLayoutVersion((version) => version + 1);
    });
  }, [activePanelId, layoutVersion]);
  const selectWorkspaceTab = (panelId: string) => {
    const node = modelRef.current.getNodeById(panelId);

    if (node?.getType() !== 'tab') {
      return;
    }

    focusWorkspaceTab(modelRef.current, panelId);
    setLastAddedPanelId(panelId);
    setLayoutVersion((version) => version + 1);
  };
  const toggleBottomBorderTab = (tabId: string) => {
    if (isBottomBorderViewVisible(modelRef.current, tabId)) {
      closeBottomBorderTab(modelRef.current, tabId);
      setLastAddedPanelId(undefined);
      setLayoutVersion((version) => version + 1);
      return;
    }

    showBottomBorderTab(modelRef.current, tabId);
    setLastAddedPanelId(undefined);
    setLayoutVersion((version) => version + 1);
  };
  const openBottomBorderTab = (tabId: string) => {
    showBottomBorderTab(modelRef.current, tabId);
    setLastAddedPanelId(undefined);
    setLayoutVersion((version) => version + 1);
  };
  useEffect(() => {
    return subscribeSftpTransferQueueOpen(() => {
      openBottomBorderTab('sftp-transfer-queue');
    });
  }, []);
  const closeWorkspaceTab = (panelId: string) => {
    const node = modelRef.current.getNodeById(panelId);

    if (node?.getType() !== 'tab') {
      return;
    }

    getCascadeCloseTabIds(modelRef.current, panelId).forEach((tabId) => {
      if (modelRef.current.getNodeById(tabId)?.getType() === 'tab') {
        modelRef.current.doAction(Actions.deleteTab(tabId));
      }
    });
    setLayoutVersion((version) => version + 1);
  };
  const cloneWorkspaceTab = (tab: WorkspaceTabItem, remotePath?: string) => {
    if (!tab.session && !tab.localPtyTarget) {
      return;
    }

    const tabId = `${tab.type}-${tab.session?.id ?? 'local'}-${Date.now()}`;
    const activeTabset = modelRef.current.getActiveTabset() ?? modelRef.current.getFirstTabSet();

    modelRef.current.doAction(
      Actions.addTab(
        {
          type: 'tab',
          id: tabId,
          name: tab.title,
          enableClose: true,
          component: 'panel',
          config: {
            autoConnect: true,
            initialPath: tab.initialPath,
            localPtyTarget: tab.localPtyTarget,
            panelType: tab.type,
            session: tab.session,
          },
        },
        activeTabset.getId(),
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    modelRef.current.doAction(Actions.selectTab(tabId));
    setLastAddedPanelId(tabId);
    setLayoutVersion((version) => version + 1);

    if (tab.type === 'sftp' && remotePath && remotePath !== 'Home') {
      window.setTimeout(() => requestSftpSidebarNavigation(tabId, remotePath), 250);
    }
  };
  const openAiForWorkspaceTab = (tab: WorkspaceTabItem) => {
    if (tab.type !== 'terminal' && tab.type !== 'sftp') {
      return;
    }

    const aiTabId = createBoundAiPanelId(tab.id);
    const aiBinding = createBoundAiBinding({ model: modelRef.current, tab });
    const aiLabel = createBoundAiTitle(tab, aiBinding);
    const existingNode = modelRef.current.getNodeById(aiTabId);

    if (existingNode?.getType() === 'tab') {
      modelRef.current.doAction(Actions.renameTab(aiTabId, aiLabel));
      modelRef.current.doAction(Actions.updateNodeAttributes(aiTabId, { config: { aiBinding, panelType: 'ai', session: tab.session } }));
      focusWorkspaceTab(modelRef.current, aiTabId);
      setLastAddedPanelId(aiTabId);
      setLayoutVersion((version) => version + 1);
      return;
    }

    const bottomTargetId = getBottomBorderId(modelRef.current) ?? modelRef.current.getActiveTabset()?.getId() ?? modelRef.current.getFirstTabSet().getId();

    modelRef.current.doAction(
      Actions.addTab(
        {
          type: 'tab',
          id: aiTabId,
          name: aiLabel,
          enableClose: true,
          component: 'panel',
          config: { aiBinding, panelType: 'ai', session: tab.session },
        },
        bottomTargetId,
        DockLocation.CENTER,
        -1,
        true,
      ),
    );
    focusWorkspaceTab(modelRef.current, aiTabId);
    setLastAddedPanelId(aiTabId);
    setLayoutVersion((version) => version + 1);
  };

  return (
    <main className="workspace-bg grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden supports-[height:100dvh]:h-dvh">
      <MenuBar
        isAiAssistantVisible={isAiAssistantVisible}
        isTransferQueueVisible={isTransferQueueVisible}
        onOpenElevatedLocalTerminal={openElevatedTerminal}
        onOpenLocalTerminal={openLocalTerminal}
        onOpenSettings={openSettings}
        onCheckForUpdates={() => void checkForShellPilotUpdate({ source: 'manual' })}
        onToggleAiAssistant={() => toggleBottomBorderTab('ai-assistant')}
        onToggleTransferQueue={() => toggleBottomBorderTab('sftp-transfer-queue')}
      />

      <section
        className="grid min-h-0"
        style={{
          gridTemplateColumns: isSidebarCollapsed
            ? '3rem minmax(0, 1fr)'
            : `3rem ${sidebarWidth}px 3px minmax(0, 1fr)`,
        }}
      >
        <ActivityBar
          activeActivity={activeActivity}
          isSidebarCollapsed={isSidebarCollapsed}
          onOpenSettings={openSettings}
          onSelectActivity={(activityId) => {
            setActiveActivity(activityId);
            setIsSidebarCollapsed(false);
          }}
        />
        <SidebarShell
          activeActivity={activeActivity}
          activePanelId={activePanelId}
          isCollapsed={isSidebarCollapsed}
          onClosePanel={closeWorkspaceTab}
          onAddPanel={addPanel}
          onClonePanel={cloneWorkspaceTab}
          onOpenSftp={openSftpForSession}
          onOpenTransferQueue={() => openBottomBorderTab('sftp-transfer-queue')}
          onSelectPanel={selectWorkspaceTab}
          sftpExplorers={sftpExplorers}
          workspaceTabs={workspaceTabs}
          onToggle={() => setIsSidebarCollapsed((current) => !current)}
        />
        {!isSidebarCollapsed && (
          <div
            className="group cursor-col-resize bg-transparent"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startSidebarResize}
          >
            <div className="mx-auto h-full w-px bg-border/35 transition-[background-color,width] group-hover:w-[3px] group-hover:bg-primary/70" />
          </div>
        )}

        <Workspace
          lastAddedPanelId={lastAddedPanelId}
          model={model}
          onModelChange={(nextModel) => {
            modelRef.current = nextModel;
            setLayoutVersion((version) => version + 1);
          }}
          onOpenAi={openAiForWorkspaceTab}
          onOpenSftp={openSftpForSession}
        />
      </section>
      <AppDialogProvider />
    </main>
  );
}

function getBottomBorder(model: Model) {
  return model
    .getBorderSet()
    .getBorders()
    .find((border) => border.getLocation().getName() === 'bottom');
}

function isBottomBorderViewVisible(model: Model, tabId: string) {
  const bottomBorder = getBottomBorder(model);

  return bottomBorder?.isShowing() === true && isBottomBorderViewOpen(model, tabId);
}

function isBottomBorderViewOpen(model: Model, tabId: string) {
  const bottomBorder = getBottomBorder(model);

  return Boolean(
    bottomBorder
      ?.getChildren()
      .some((childNode) => childNode.getType() === 'tab' && childNode.getId() === tabId),
  );
}

function closeBottomBorderTab(model: Model, tabId: string) {
  const bottomBorder = getBottomBorder(model);

  if (!bottomBorder) {
    return;
  }

  const nextTabId = bottomBorder
    .getChildren()
    .find((childNode) => childNode.getType() === 'tab' && childNode.getId() !== tabId)
    ?.getId();

  if (model.getNodeById(tabId)?.getType() === 'tab') {
    model.doAction(Actions.deleteTab(tabId));
  }

  if (nextTabId) {
    focusWorkspaceTab(model, nextTabId);
    return;
  }

  setBottomBorderVisible(model, false);
}

function showBottomBorderTab(model: Model, tabId: string) {
  const bottomBorder = getBottomBorder(model);

  if (bottomBorder?.isShowing() !== true) {
    closeInactiveBuiltInBottomTabs(model, tabId);
  }

  ensureBottomBorderTab(model, tabId);
  setBottomBorderVisible(model, true);
  focusWorkspaceTab(model, tabId);
}

function closeInactiveBuiltInBottomTabs(model: Model, activeTabId: string) {
  for (const tabId of ['sftp-transfer-queue', 'ai-assistant']) {
    if (tabId !== activeTabId && model.getNodeById(tabId)?.getType() === 'tab') {
      model.doAction(Actions.deleteTab(tabId));
    }
  }
}

function setBottomBorderVisible(model: Model, show: boolean) {
  const bottomBorderId = getBottomBorderId(model);

  if (bottomBorderId) {
    model.doAction(Actions.updateNodeAttributes(bottomBorderId, { show } as never));
  }
}

function ensureBottomBorderTab(model: Model, tabId: string) {
  if (model.getNodeById(tabId)?.getType() === 'tab') {
    return;
  }

  const bottomBorderId = getBottomBorderId(model);

  if (!bottomBorderId) {
    return;
  }

  const tabJson = createBottomBorderTabJson(tabId);

  if (!tabJson) {
    return;
  }

  model.doAction(Actions.addTab(tabJson, bottomBorderId, DockLocation.CENTER, -1, true));
}

function createBottomBorderTabJson(tabId: string) {
  if (tabId === 'sftp-transfer-queue') {
    return {
      type: 'tab' as const,
      id: 'sftp-transfer-queue',
      name: 'Transfer Queue',
      enableClose: false,
      component: 'panel',
      config: { panelType: 'sftp-transfer-queue' },
    };
  }

  if (tabId === 'ai-assistant') {
    return {
      type: 'tab' as const,
      id: 'ai-assistant',
      name: 'AI Assistant',
      enableClose: false,
      component: 'panel',
      config: { panelType: 'ai' },
    };
  }

  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function syncSelectedBoundAiTab(
  model: Model,
  activePanelId: string | undefined,
  onSynced: () => void,
) {
  if (!activePanelId) {
    return;
  }

  const activeNode = model.getNodeById(activePanelId);

  if (activeNode?.getType() !== 'tab') {
    return;
  }

  const activeConfig = (activeNode as TabNode).getConfig() as { panelType?: string };

  if (activeConfig.panelType !== 'terminal' && activeConfig.panelType !== 'sftp') {
    return;
  }

  const selectedBottomTab = getSelectedBottomBorderTab(model);
  const selectedBottomConfig = selectedBottomTab?.getConfig() as
    | { aiBinding?: { boundPanelId?: string }; panelType?: string }
    | undefined;

  if (selectedBottomConfig?.panelType !== 'ai' || !selectedBottomConfig.aiBinding?.boundPanelId) {
    return;
  }

  const targetAiTabId = `ai-bound-${activePanelId}`;

  if (selectedBottomTab?.getId() === targetAiTabId) {
    return;
  }

  if (model.getNodeById(targetAiTabId)?.getType() !== 'tab') {
    return;
  }

  focusWorkspaceTab(model, targetAiTabId);
  onSynced();
}
