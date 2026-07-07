import { Boxes, Monitor, Server, Star, Terminal } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';
import type { SessionItem } from '@/types/workspace';

export const SessionButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { isSelected?: boolean; session: SessionItem }
>(({ className, isSelected = false, session, ...props }, ref) => {
  const Icon = getSessionIcon(session.kind);

  return (
    <button
      ref={ref}
      aria-selected={isSelected}
      className={cn(
        'group relative grid h-6 w-full grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-1.5 rounded px-1.5 text-left text-[13px] leading-none outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-primary',
        isSelected && 'bg-primary/12 text-primary shadow-[inset_2px_0_0_hsl(var(--primary))]',
        className,
      )}
      type="button"
      {...props}
    >
      <span className="relative">
        <Icon className={cn('size-3.5 text-slate-400', isSelected && 'text-primary')} />
        <span
          className={cn(
            'absolute -right-0.5 -top-0.5 size-1.5 rounded-full ring-1 ring-card',
            session.status === 'ready' && 'bg-[hsl(var(--workspace-success))]',
            session.status === 'connecting' && 'bg-primary',
            session.status === 'offline' && 'bg-destructive',
          )}
        />
      </span>
      <span className={cn('truncate font-medium text-white', isSelected && 'font-semibold text-primary')}>
        {session.name}
      </span>
      <span className={cn('truncate text-xs font-normal text-slate-400', isSelected && 'text-primary/85')}>
        {session.host ?? getSessionKindLabel(session.kind)}
      </span>
      {session.favorite && <Star className="size-3 fill-primary text-primary" />}
      <span className={cn('font-mono text-[11px] font-bold text-slate-400', isSelected && 'text-primary/85')}>
        {getSessionKindLabel(session.kind)}
      </span>
    </button>
  );
});
SessionButton.displayName = 'SessionButton';

function getSessionIcon(kind: SessionItem['kind']) {
  if (kind === 'rdp') {
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
