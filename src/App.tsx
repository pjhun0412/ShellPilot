import { Actions, DockLocation, Model, type TabNode } from 'flexlayout-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ActivityBar } from '@/components/navigation/ActivityBar';
import { SidebarShell } from '@/components/navigation/SidebarShell';
import { AppDialogProvider } from '@/components/ui/app-dialog';
import { MenuBar } from '@/components/shell/MenuBar';
import { panelCatalog } from '@/features/panels/panelCatalog';
import {
  requestSftpSidebarNavigation,
} from '@/features/sftp/sftpSidebarState';
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
import type { ActivityId, WorkspacePanel, WorkspaceTabItem } from '@/types/workspace';

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
  const previousActivePanelIdRef = useRef<string>();

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
    const saveTimer = window.setTimeout(() => {
      saveWorkspaceLayout(modelRef.current.toJson());
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
      saveWorkspaceLayout(modelRef.current.toJson());
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
          config: { autoConnect: true, panelType: panel.type, session: panel.session },
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
  const openSftpForSession = (session: NonNullable<WorkspacePanel['session']>) => {
    if (session.kind !== 'ssh') {
      return;
    }

    addPanel({
      id: `sftp-${session.id}`,
      session,
      title: `SFTP - ${session.name}`,
      type: 'sftp',
    });
    setActiveActivity('files');
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

    modelRef.current.doAction(Actions.selectTab(panelId));
    setLastAddedPanelId(panelId);
    setLayoutVersion((version) => version + 1);
  };
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
    if (!tab.session) {
      return;
    }

    const tabId = `${tab.type}-${tab.session.id}-${Date.now()}`;
    const activeTabset = modelRef.current.getActiveTabset() ?? modelRef.current.getFirstTabSet();

    modelRef.current.doAction(
      Actions.addTab(
        {
          type: 'tab',
          id: tabId,
          name: tab.title,
          enableClose: true,
          component: 'panel',
          config: { autoConnect: true, panelType: tab.type, session: tab.session },
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
    <main className="workspace-bg grid h-screen grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <MenuBar onOpenSettings={openSettings} />

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
