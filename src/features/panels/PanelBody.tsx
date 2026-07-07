import { Bot, Folder, Monitor } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SettingsPanel } from '@/features/settings/SettingsPanel';
import { SftpPanel } from '@/features/sftp/SftpPanel';
import { SshTerminal } from '@/features/terminal/SshTerminal';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import type { WorkspacePanel } from '@/types/workspace';

export function PanelBody({
  isActive,
  onActivate,
  onOpenSftp,
  panel,
}: {
  isActive?: boolean;
  onActivate?: () => void;
  onOpenSftp?: (session: NonNullable<WorkspacePanel['session']>) => void;
  panel: WorkspacePanel;
}) {
  if (panel.type === 'terminal') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        {panel.session?.kind === 'ssh' ? (
          <SshTerminal
            autoConnect={panel.autoConnect !== false}
            panelId={panel.id}
            session={panel.session}
            onOpenSftp={onOpenSftp}
          />
        ) : (
          <LocalTerminalPlaceholder />
        )}
      </PanelFocusFrame>
    );
  }

  if (panel.type === 'ai') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        <div className="app-scrollbar ai-panel flex h-full min-h-0 flex-col justify-between gap-5 overflow-auto p-4">
          <div className="space-y-4">
            <div className="flex size-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
              <Bot className="size-5" />
            </div>
            <div>
              <h3 className="text-sm font-medium">AI Assistant</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                {t('ai.placeholder')}
              </p>
            </div>
          </div>
          <Button type="button">
            <Bot />
            {t('ai.ask')}
          </Button>
        </div>
      </PanelFocusFrame>
    );
  }

  if (panel.type === 'rdp') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        <div className="app-scrollbar grid h-full min-h-0 place-content-center gap-3 overflow-auto bg-card p-4 text-center text-muted-foreground">
          <div className="mx-auto grid size-14 place-items-center rounded-md border bg-background/60">
            <Monitor className="size-7" />
          </div>
          <span className="text-sm">RDP surface placeholder</span>
        </div>
      </PanelFocusFrame>
    );
  }

  if (panel.type === 'settings') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        <SettingsPanel />
      </PanelFocusFrame>
    );
  }

  if (panel.type === 'sftp' && panel.session) {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        <SftpPanel panelId={panel.id} session={panel.session} />
      </PanelFocusFrame>
    );
  }

  return (
    <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
      <div className="app-scrollbar file-panel grid h-full min-h-0 content-start gap-1 overflow-auto p-3 text-sm">
        {[
          ['/var/www', 'remote path'],
          ['app', 'folder'],
          ['logs', 'folder'],
          ['deploy.sh', 'script'],
        ].map(([name, kind]) => (
          <div
            className="flex items-center justify-between gap-4 rounded-md border border-transparent px-3 py-2.5 hover:border-border hover:bg-accent/80"
            key={name}
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              <Folder className="size-4 text-muted-foreground" />
              <span className="truncate">{name}</span>
            </span>
            <small className="shrink-0 text-muted-foreground">{kind}</small>
          </div>
        ))}
      </div>
    </PanelFocusFrame>
  );
}

function PanelFocusFrame({
  children,
  isActive,
  onActivate,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  onActivate?: () => void;
}) {
  return (
    <div
      className={cn(
        'relative h-full min-h-0 outline-none transition-[filter] duration-150',
        'overflow-hidden',
        !isActive && 'brightness-[0.98]',
      )}
      onPointerDown={onActivate}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

function LocalTerminalPlaceholder() {
  return (
    <div className="app-scrollbar terminal-panel flex h-full min-h-0 flex-col overflow-auto p-4 font-mono text-[13px] leading-6">
      <span className="text-[hsl(var(--workspace-info))]">~ shellpilot</span>
      <span>
        <span className="text-primary">$</span> local terminal
      </span>
      <span className="text-muted-foreground">Local terminal support will be wired after SSH shell I/O.</span>
    </div>
  );
}

export function LogsPanel({
  isActive,
  onActivate,
}: {
  isActive?: boolean;
  onActivate?: () => void;
}) {
  return (
    <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
      <div className="app-scrollbar terminal-panel h-full overflow-auto p-3 font-mono text-xs leading-5 text-muted-foreground">
        <div>
          <span className="text-primary">[system]</span> ShellPilot workspace initialized
        </div>
        <div>
          <span className="text-primary">[layout]</span> FlexLayout model loaded
        </div>
        <div>
          <span className="text-primary">[hint]</span> Drag tabs to split left, right, top, bottom, or
          center
        </div>
      </div>
    </PanelFocusFrame>
  );
}
