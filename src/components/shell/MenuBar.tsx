import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function MenuBar() {
  const appWindow = getCurrentWindow();

  return (
    <div
      className="app-drag-region grid h-9 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center border-b bg-background text-xs text-muted-foreground"
      data-tauri-drag-region
    >
      <div className="flex h-full items-center gap-2 px-2" data-tauri-drag-region>
        <div className="grid size-5 place-items-center rounded border border-primary/40 bg-primary/10 text-[0.58rem] font-black text-primary">
          SP
        </div>
        <strong className="text-sm text-foreground">ShellPilot</strong>
      </div>

      <nav className="app-no-drag flex h-full items-center gap-1 px-1">
        {['File', 'Edit', 'View', 'Session', 'Tools', 'Help'].map((item) => (
          <Button className="h-7 px-2 text-xs" variant="ghost" size="sm" type="button" key={item}>
            {item}
          </Button>
        ))}
      </nav>

      <div className="h-full min-w-0" data-tauri-drag-region />

      <div className="app-no-drag flex h-full items-stretch">
        <WindowControlButton label="Minimize" onClick={() => void appWindow.minimize()}>
          <Minus className="size-3.5" />
        </WindowControlButton>
        <WindowControlButton label="Maximize" onClick={() => void appWindow.toggleMaximize()}>
          <Square className="size-3" />
        </WindowControlButton>
        <WindowControlButton
          className="hover:bg-destructive hover:text-destructive-foreground"
          label="Close"
          onClick={() => void appWindow.close()}
        >
          <X className="size-3.5" />
        </WindowControlButton>
      </div>
    </div>
  );
}

function WindowControlButton({
  children,
  className,
  label,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'grid h-full w-11 place-items-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
