import { PanelLeftClose } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { panelCatalog } from '@/features/panels/panelCatalog';
import {
  SessionsView,
  SidebarPanelList,
  SidebarStaticList,
} from '@/features/sessions/components/SessionsView';
import { t } from '@/i18n';
import type { ActivityId, WorkspacePanel } from '@/types/workspace';
import { getActivityDescription, getActivityTitle } from './activities';

export function SidebarShell({
  activeActivity,
  isCollapsed,
  onAddPanel,
  onToggle,
}: {
  activeActivity: ActivityId;
  isCollapsed: boolean;
  onAddPanel: (panel: WorkspacePanel) => void;
  onToggle: () => void;
}) {
  if (isCollapsed) {
    return null;
  }

  return (
    <aside className="flex min-w-0 flex-col gap-4 border-r bg-card p-4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-slate-50">{getActivityTitle(activeActivity)}</h1>
          <p className="truncate text-xs font-medium text-slate-400">
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

      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarContent activeActivity={activeActivity} onAddPanel={onAddPanel} />
      </div>
    </aside>
  );
}

function SidebarContent({
  activeActivity,
  onAddPanel,
}: {
  activeActivity: ActivityId;
  onAddPanel: (panel: WorkspacePanel) => void;
}) {
  if (activeActivity === 'sessions') {
    return <SessionsView onAddPanel={onAddPanel} />;
  }

  if (activeActivity === 'files') {
    return (
      <SidebarPanelList
        items={[
          { label: 'Open SFTP Explorer', panel: panelCatalog[2] },
          { label: 'Transfer Queue', panel: panelCatalog[2] },
          { label: 'Remote Bookmarks', panel: panelCatalog[2] },
        ]}
        onAddPanel={onAddPanel}
      />
    );
  }

  if (activeActivity === 'ai') {
    return (
      <SidebarPanelList
        items={[
          { label: 'AI Assistant', panel: panelCatalog[1] },
          { label: 'Command Diagnosis', panel: panelCatalog[1] },
          { label: 'Provider Settings', panel: panelCatalog[1] },
        ]}
        onAddPanel={onAddPanel}
      />
    );
  }

  if (activeActivity === 'logs') {
    return <SidebarStaticList items={['Terminal History', 'Transfer Logs', 'AI Conversations']} />;
  }

  return <SidebarStaticList items={['General', 'Credentials', 'AI Providers']} />;
}
