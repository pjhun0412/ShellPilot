import type { BorderNode, TabNode, TabSetNode } from 'flexlayout-react';

import type { ConnectionStatus } from '@/features/connections/connectionStatus';
import { cn } from '@/lib/utils';

export type WorkspaceRenderTabValues = {
  content: React.ReactNode;
  leading: React.ReactNode;
};

export function createWorkspaceTabRenderer({
  activePanelId,
  connectionStatuses,
}: {
  activePanelId?: string;
  connectionStatuses: Record<string, ConnectionStatus>;
}) {
  return (node: TabNode, renderValues: WorkspaceRenderTabValues) => {
    const config = node.getConfig() as { session?: unknown };
    const isActive = activePanelId === node.getId();

    renderValues.content = (
      <span
        className={cn('shellpilot-tab-title', isActive && 'shellpilot-tab-title--active')}
        data-shellpilot-tab-id={node.getId()}
      >
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
          connectionStatuses[node.getId()] === 'closed' && 'bg-slate-500/60',
          connectionStatuses[node.getId()] === 'restored' && 'bg-slate-500/60',
        )}
      />
    );
  };
}

export function closeFlexLayoutTabOnMiddleClick({
  event,
  requestTabClose,
}: {
  event: React.MouseEvent<HTMLDivElement, MouseEvent>;
  requestTabClose: (tabId: string) => void;
}) {
  if (event.button !== 1) {
    return;
  }

  const target = event.target as HTMLElement | null;
  const tabButton = target?.closest('.flexlayout__tab_button, .flexlayout__border_button');
  const tabTitle = tabButton?.querySelector<HTMLElement>('[data-shellpilot-tab-id]');
  const tabId = tabTitle?.dataset.shellpilotTabId;

  if (!tabId) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  requestTabClose(tabId);
}

export function closeLayoutNodeOnMiddleClick({
  event,
  node,
  requestTabClose,
}: {
  event: React.MouseEvent<HTMLElement, MouseEvent>;
  node: TabNode | TabSetNode | BorderNode;
  requestTabClose: (tabId: string) => void;
}) {
  if (event.button !== 1 || node.getType() !== 'tab') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  requestTabClose(node.getId());
}

export function renderWorkspaceDragPreview(content: React.ReactNode) {
  return (
    <div className="rounded border border-primary/60 bg-card px-2 py-1 text-xs text-foreground shadow-lg">
      {content}
    </div>
  );
}
