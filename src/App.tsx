import { Actions, DockLocation, Model, type TabNode } from 'flexlayout-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ActivityBar } from '@/components/navigation/ActivityBar';
import { SidebarShell } from '@/components/navigation/SidebarShell';
import { AppDialogProvider } from '@/components/ui/app-dialog';
import { MenuBar } from '@/components/shell/MenuBar';
import { panelCatalog } from '@/features/panels/panelCatalog';
import {
  requestSftpSidebarNavigation,
  type SftpSidebarExplorer,
} from '@/features/sftp/sftpSidebarState';
import { Workspace } from '@/features/workspace/Workspace';
import { readSessionConfig } from '@/features/workspace/WorkspaceTabMenu';
import { getSelectedPanelId } from '@/features/workspace/workspaceLayoutActions';
import { loadSavedLayout, saveWorkspaceLayout } from '@/features/workspace/workspaceLayout';
import type { ActivityId, WorkspacePanel, WorkspacePanelType, WorkspaceTabItem } from '@/types/workspace';

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

    if (panel.type === 'settings' && existingNode?.getType() === 'tab') {
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

    modelRef.current.doAction(Actions.deleteTab(panelId));
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

function collectWorkspaceTabs(model: Model): WorkspaceTabItem[] {
  const tabs: WorkspaceTabItem[] = [];

  model.visitNodes((node) => {
    if (node.getType() !== 'tab') {
      return;
    }

    const tab = node as TabNode;
    const config = tab.getConfig() as { panelType?: string; session?: unknown };

    if (!isWorkspacePanelType(config.panelType)) {
      return;
    }

    const session = readSessionConfig(config.session);

    tabs.push({
      id: tab.getId(),
      session,
      title: tab.getName(),
      type: config.panelType,
    });
  });

  return tabs;
}

function isWorkspacePanelType(value: unknown): value is WorkspacePanelType {
  return value === 'terminal' || value === 'sftp' || value === 'ai' || value === 'rdp' || value === 'settings';
}

function collectSftpExplorers(model: Model): SftpSidebarExplorer[] {
  const explorers: SftpSidebarExplorer[] = [];

  model.visitNodes((node) => {
    if (node.getType() !== 'tab') {
      return;
    }

    const tab = node as TabNode;
    const config = tab.getConfig() as { panelType?: string; session?: unknown };

    if (config.panelType !== 'sftp') {
      return;
    }

    const session = readSessionConfig(config.session);

    explorers.push({
      host: session?.host,
      panelId: tab.getId(),
      session,
      title: tab.getName(),
      username: session?.username,
    });
  });

  return explorers;
}
