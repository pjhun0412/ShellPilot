import { PanelLeftClose } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { AiSidebar } from '@/features/ai/AiSidebar';
import { NotesSidebar } from '@/features/notes/NotesSidebar';
import type { SftpSidebarExplorer } from '@/features/sftp/sftpSidebarState';
import { SshActivityPanel } from '@/features/ssh/SshActivityPanel';
import {
  SessionsView,
  SidebarStaticList,
} from '@/features/sessions/components/SessionsView';
import { t } from '@/i18n';
import type { ActivityId, OpenSftpHandler, WorkspacePanel, WorkspaceTabItem } from '@/types/workspace';
import { getActivityDescription, getActivityTitle } from './activities';
import { SftpSidebar, WorkspaceTabsSidebar } from './SidebarPanels';

export function SidebarShell({
  activeActivity,
  activePanelId,
  isCollapsed,
  onClosePanel,
  onAddPanel,
  onClonePanel,
  onOpenSftp,
  onOpenTransferQueue,
  onSelectPanel,
  sftpExplorers,
  workspaceTabs,
  onToggle,
}: {
  activeActivity: ActivityId;
  activePanelId?: string;
  isCollapsed: boolean;
  onClosePanel: (panelId: string) => void;
  onAddPanel: (panel: WorkspacePanel) => void;
  onClonePanel: (tab: WorkspaceTabItem, path?: string) => void;
  onOpenSftp: OpenSftpHandler;
  onOpenTransferQueue: () => void;
  onSelectPanel: (panelId: string) => void;
  sftpExplorers: SftpSidebarExplorer[];
  workspaceTabs: WorkspaceTabItem[];
  onToggle: () => void;
}) {
  return (
    <aside
      className={
        isCollapsed
          ? 'hidden'
          : 'app-scrollbar flex min-w-0 flex-col gap-4 overflow-hidden border-r bg-card p-4'
      }
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-foreground">{getActivityTitle(activeActivity)}</h1>
          <p className="truncate text-xs font-medium text-muted-foreground">
            {getActivityDescription(activeActivity)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          aria-label={t('sidebar.collapse')}
          onClick={onToggle}
        >
          <PanelLeftClose />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <SidebarContent
          activeActivity={activeActivity}
          activePanelId={activePanelId}
          onClosePanel={onClosePanel}
          onAddPanel={onAddPanel}
          onClonePanel={onClonePanel}
          onOpenSftp={onOpenSftp}
          onOpenTransferQueue={onOpenTransferQueue}
          onSelectPanel={onSelectPanel}
          sftpExplorers={sftpExplorers}
          workspaceTabs={workspaceTabs}
        />
      </div>
    </aside>
  );
}

function SidebarContent({
  activeActivity,
  activePanelId,
  onClosePanel,
  onAddPanel,
  onClonePanel,
  onOpenSftp,
  onOpenTransferQueue,
  onSelectPanel,
  sftpExplorers,
  workspaceTabs,
}: {
  activeActivity: ActivityId;
  activePanelId?: string;
  onClosePanel: (panelId: string) => void;
  onAddPanel: (panel: WorkspacePanel) => void;
  onClonePanel: (tab: WorkspaceTabItem, path?: string) => void;
  onOpenSftp: OpenSftpHandler;
  onOpenTransferQueue: () => void;
  onSelectPanel: (panelId: string) => void;
  sftpExplorers: SftpSidebarExplorer[];
  workspaceTabs: WorkspaceTabItem[];
}) {
  const sessionsView = <SessionsView onAddPanel={onAddPanel} />;

  if (activeActivity === 'sessions') {
    return sessionsView;
  }

  let activeContent: ReactNode;

  if (activeActivity === 'files') {
    activeContent = (
      <SftpSidebar
        activePanelId={activePanelId}
        explorers={sftpExplorers}
        onClonePanel={onClonePanel}
        onClosePanel={onClosePanel}
        onOpenTransferQueue={onOpenTransferQueue}
        onSelectPanel={onSelectPanel}
      />
    );
  } else if (activeActivity === 'ssh') {
    activeContent = (
      <SshActivityPanel
        activePanelId={activePanelId}
        onClosePanel={onClosePanel}
        onOpenSftp={onOpenSftp}
        onSelectPanel={onSelectPanel}
        workspaceTabs={workspaceTabs}
      />
    );
  } else if (activeActivity === 'notes') {
    activeContent = (
      <NotesSidebar
        activePanelId={activePanelId}
        onAddPanel={onAddPanel}
        onClosePanel={onClosePanel}
        onSelectPanel={onSelectPanel}
        workspaceTabs={workspaceTabs}
      />
    );
  } else if (activeActivity === 'tabs') {
    activeContent = (
      <WorkspaceTabsSidebar
        activePanelId={activePanelId}
        onAddPanel={onAddPanel}
        onClonePanel={onClonePanel}
        onClosePanel={onClosePanel}
        onSelectPanel={onSelectPanel}
        workspaceTabs={workspaceTabs}
      />
    );
  } else if (activeActivity === 'ai') {
    activeContent = <AiSidebar onAddPanel={onAddPanel} />;
  } else {
    activeContent = <SidebarStaticList items={['General', 'Credentials', 'AI Providers']} />;
  }

  return (
    <>
      <div className="hidden">{sessionsView}</div>
      {activeContent}
    </>
  );
}
