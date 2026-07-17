import { PanelLeftClose } from 'lucide-react';

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
  if (isCollapsed) {
    return null;
  }

  return (
    <aside className="app-scrollbar flex min-w-0 flex-col gap-4 overflow-hidden border-r bg-card p-4">
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
  if (activeActivity === 'sessions') {
    return <SessionsView onAddPanel={onAddPanel} />;
  }

  if (activeActivity === 'files') {
    return (
      <SftpSidebar
        activePanelId={activePanelId}
        explorers={sftpExplorers}
        onClonePanel={onClonePanel}
        onClosePanel={onClosePanel}
        onOpenTransferQueue={onOpenTransferQueue}
        onSelectPanel={onSelectPanel}
      />
    );
  }

  if (activeActivity === 'ssh') {
    return (
      <SshActivityPanel
        activePanelId={activePanelId}
        onClosePanel={onClosePanel}
        onOpenSftp={onOpenSftp}
        onSelectPanel={onSelectPanel}
        workspaceTabs={workspaceTabs}
      />
    );
  }

  if (activeActivity === 'notes') {
    return <NotesSidebar onAddPanel={onAddPanel} onClosePanel={onClosePanel} />;
  }

  if (activeActivity === 'tabs') {
    return (
      <WorkspaceTabsSidebar
        activePanelId={activePanelId}
        onAddPanel={onAddPanel}
        onClonePanel={onClonePanel}
        onClosePanel={onClosePanel}
        onSelectPanel={onSelectPanel}
        workspaceTabs={workspaceTabs}
      />
    );
  }

  if (activeActivity === 'ai') {
    return <AiSidebar onAddPanel={onAddPanel} />;
  }

  return <SidebarStaticList items={['General', 'Credentials', 'AI Providers']} />;
}
