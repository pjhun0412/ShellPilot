import { Actions, DockLocation, Model } from 'flexlayout-react';
import { useMemo, useRef, useState } from 'react';

import { ActivityBar } from '@/components/navigation/ActivityBar';
import { Sidebar } from '@/components/navigation/Sidebar';
import { MenuBar } from '@/components/shell/MenuBar';
import { StatusBar } from '@/components/shell/StatusBar';
import { Workspace } from '@/features/workspace/Workspace';
import { layoutStorageKey, loadSavedLayout } from '@/features/workspace/workspaceLayout';
import type { ActivityId, WorkspacePanel } from '@/types/workspace';

export function App() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(312);
  const [activeActivity, setActiveActivity] = useState<ActivityId>('sessions');
  const [lastAddedPanelId, setLastAddedPanelId] = useState<string>();
  const [savedLayoutAt, setSavedLayoutAt] = useState<string | null>(null);
  const [, setLayoutVersion] = useState(0);
  const model = useMemo(() => {
    const nextModel = Model.fromJson(loadSavedLayout());
    nextModel.setSplitterSize(6);
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

  const saveLayout = () => {
    const serialized = modelRef.current.toJson();
    localStorage.setItem(layoutStorageKey, JSON.stringify(serialized));
    setSavedLayoutAt(new Date().toLocaleTimeString());
  };

  const addPanel = (panel: WorkspacePanel) => {
    const activeTabset = modelRef.current.getActiveTabset();
    if (!activeTabset) {
      return;
    }

    const tabId = `${panel.id}-${Date.now()}`;

    modelRef.current.doAction(
      Actions.addTab(
        {
          type: 'tab',
          id: tabId,
          name: panel.title,
          component: 'panel',
          config: { panelType: panel.type, session: panel.session },
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

  return (
    <main className="workspace-bg grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <MenuBar />

      <section
        className="grid min-h-0"
        style={{
          gridTemplateColumns: isSidebarCollapsed
            ? '3rem minmax(0, 1fr)'
            : `3rem ${sidebarWidth}px 6px minmax(0, 1fr)`,
        }}
      >
        <ActivityBar
          activeActivity={activeActivity}
          isSidebarCollapsed={isSidebarCollapsed}
          onSelectActivity={(activityId) => {
            setActiveActivity(activityId);
            setIsSidebarCollapsed(false);
          }}
        />
        <Sidebar
          activeActivity={activeActivity}
          isCollapsed={isSidebarCollapsed}
          onAddPanel={addPanel}
          onToggle={() => setIsSidebarCollapsed((current) => !current)}
        />
        {!isSidebarCollapsed && (
          <div
            className="cursor-col-resize border-r bg-border/70 hover:bg-primary/60"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startSidebarResize}
          />
        )}

        <Workspace
          lastAddedPanelId={lastAddedPanelId}
          model={model}
          onModelChange={(nextModel) => {
            modelRef.current = nextModel;
          }}
        />
      </section>

      <StatusBar savedLayoutAt={savedLayoutAt} onSaveLayout={saveLayout} />
    </main>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
