import { getCurrentWindow } from '@tauri-apps/api/window';
import { Check, Minus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function MenuBar({
  isTransferQueueVisible,
  onOpenSettings,
  onToggleTransferQueue,
}: {
  isTransferQueueVisible?: boolean;
  onOpenSettings: () => void;
  onToggleTransferQueue?: () => void;
}) {
  const appWindow = getCurrentWindow();
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);

  useEffect(() => {
    if (!isViewMenuOpen) {
      return;
    }

    const closeViewMenu = (event: PointerEvent) => {
      if (viewMenuRef.current?.contains(event.target as Node)) {
        return;
      }

      setIsViewMenuOpen(false);
    };
    const closeViewMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsViewMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeViewMenu);
    window.addEventListener('keydown', closeViewMenuOnEscape);

    return () => {
      window.removeEventListener('pointerdown', closeViewMenu);
      window.removeEventListener('keydown', closeViewMenuOnEscape);
    };
  }, [isViewMenuOpen]);

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
        {['File', 'Edit'].map((item) => (
          <Button
            className="h-7 px-2 text-xs"
            variant="ghost"
            size="sm"
            type="button"
            key={item}
            title={item}
          >
            {item}
          </Button>
        ))}
        <div ref={viewMenuRef} className="relative">
          <Button
            className="h-7 px-2 text-xs"
            variant="ghost"
            size="sm"
            type="button"
            title="View"
            onClick={() => setIsViewMenuOpen((current) => !current)}
          >
            View
          </Button>
          {isViewMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-xl">
              <button
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                type="button"
                onClick={() => {
                  onToggleTransferQueue?.();
                  setIsViewMenuOpen(false);
                }}
              >
                <span className="grid w-4 place-items-center">
                  {isTransferQueueVisible ? <Check className="size-3.5 text-primary" /> : null}
                </span>
                Transfer Queue
              </button>
            </div>
          )}
        </div>
        {['Session'].map((item) => (
          <Button
            className="h-7 px-2 text-xs"
            variant="ghost"
            size="sm"
            type="button"
            key={item}
            title={item}
          >
            {item}
          </Button>
        ))}
        <Button
          className="h-7 px-2 text-xs"
          variant="ghost"
          size="sm"
          type="button"
          title="Open Settings"
          onClick={onOpenSettings}
        >
          Tools
        </Button>
        <Button
          className="h-7 px-2 text-xs"
          variant="ghost"
          size="sm"
          type="button"
          title="Help"
        >
          Help
        </Button>
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
