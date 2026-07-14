import { Folder, Monitor } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function PanelFocusFrame({
  children,
  isActive,
  onActivate,
}: {
  children: ReactNode;
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
      onPointerDownCapture={onActivate}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

export function LocalTerminalPlaceholder() {
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

export function RdpPlaceholder() {
  return (
    <div className="app-scrollbar grid h-full min-h-0 place-content-center gap-3 overflow-auto bg-card p-4 text-center text-muted-foreground">
      <div className="mx-auto grid size-14 place-items-center rounded-md border bg-background/60">
        <Monitor className="size-7" />
      </div>
      <span className="text-sm">RDP surface placeholder</span>
    </div>
  );
}

export function FilePanelPlaceholder() {
  return (
    <div className="app-scrollbar file-panel grid h-full min-h-0 content-start gap-1 overflow-auto p-3 text-sm">
      {[
        ['/var/www', 'remote path'],
        ['app', 'folder'],
        ['var', 'folder'],
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
  );
}
