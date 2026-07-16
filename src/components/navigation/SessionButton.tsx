import { Boxes, Monitor, Server, Star, Terminal } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';
import type { SessionItem } from '@/types/workspace';

export const SessionButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { isSelected?: boolean; session: SessionItem }
>(({ className, isSelected = false, session, ...props }, ref) => {
  const Icon = getSessionIcon(session.kind);
  const kindLabel = getSessionKindLabel(session.kind);

  return (
    <button
      ref={ref}
      aria-selected={isSelected}
      className={cn(
        'group relative grid h-7 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left text-[13px] leading-none outline-none transition-colors hover:bg-slate-800/70 focus-visible:ring-1 focus-visible:ring-primary',
        isSelected && 'bg-primary/14 text-primary shadow-[inset_2px_0_0_hsl(var(--primary))]',
        className,
      )}
      type="button"
      {...props}
    >
      <span className={cn(
        'relative grid size-4 place-items-center rounded text-muted-foreground transition-colors group-hover:text-foreground',
        getSessionIconColor(session.kind),
        isSelected && 'text-primary',
      )}>
        <Icon className="size-3.5" />
        <span
          className={cn(
            'absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-1 ring-slate-950',
            session.status === 'ready' && 'bg-[hsl(var(--workspace-success))]',
            session.status === 'connecting' && 'bg-primary',
            session.status === 'offline' && 'bg-destructive',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className={cn(
          'block truncate font-normal text-foreground group-hover:text-foreground',
          isSelected && 'font-medium text-primary',
        )}>
          {session.name}
        </span>
        <span className={cn(
          'block truncate pt-0.5 text-[11px] font-medium leading-none text-muted-foreground group-hover:text-foreground',
          isSelected && 'text-primary/85',
        )}>
          {session.host ?? kindLabel}
        </span>
      </span>
      {session.favorite && <Star className="size-3 fill-primary text-primary" />}
      <span className={cn(
        'rounded border border-slate-700 bg-slate-950/55 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-muted-foreground',
        isSelected && 'border-primary/40 bg-primary/10 text-primary',
      )}>
        {kindLabel}
      </span>
    </button>
  );
});
SessionButton.displayName = 'SessionButton';

function getSessionIcon(kind: SessionItem['kind']) {
  if (kind === 'rdp' || kind === 'vnc') {
    return Monitor;
  }

  if (kind === 'local' || kind === 'wsl') {
    return Terminal;
  }

  if (kind === 'docker') {
    return Boxes;
  }

  return Server;
}

function getSessionKindLabel(kind: SessionItem['kind']) {
  if (kind === 'wsl') {
    return 'WSL';
  }

  return kind.toUpperCase();
}

function getSessionIconColor(kind: SessionItem['kind']) {
  if (kind === 'ssh') {
    return 'text-sky-300';
  }

  if (kind === 'sftp' || kind === 'ftp') {
    return 'text-emerald-300';
  }

  if (kind === 'rdp') {
    return 'text-cyan-300';
  }

  if (kind === 'vnc') {
    return 'text-violet-300';
  }

  if (kind === 'local' || kind === 'wsl') {
    return 'text-primary';
  }

  return 'text-muted-foreground';
}
