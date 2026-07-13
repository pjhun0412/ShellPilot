import { getCurrentWindow } from '@tauri-apps/api/window';
import { Check, Minus, Square, Terminal, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  elevatedLocalTerminalProfiles,
  getLocalTerminalProfile,
  localTerminalProfiles,
} from '@/features/terminal/localTerminalProfiles';
import { loadPreferences, subscribePreferences } from '@/features/settings/appPreferences';
import { cn } from '@/lib/utils';
import type { WorkspaceLocalPtyTarget } from '@/types/workspace';

export function MenuBar({
  isAiAssistantVisible,
  isTransferQueueVisible,
  onCheckForUpdates,
  onOpenElevatedLocalTerminal,
  onOpenLocalTerminal,
  onOpenSettings,
  onToggleAiAssistant,
  onToggleTransferQueue,
}: {
  isAiAssistantVisible?: boolean;
  isTransferQueueVisible?: boolean;
  onCheckForUpdates?: () => void;
  onOpenElevatedLocalTerminal: (shell: 'cmd' | 'powershell') => void;
  onOpenLocalTerminal: (request: { target: WorkspaceLocalPtyTarget; title: string }) => void;
  onOpenSettings: () => void;
  onToggleAiAssistant?: () => void;
  onToggleTransferQueue?: () => void;
}) {
  const appWindow = getCurrentWindow();
  const helpMenuRef = useRef<HTMLDivElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [isHelpMenuOpen, setIsHelpMenuOpen] = useState(false);
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [preferences, setPreferences] = useState(() => loadPreferences());
  const defaultLocalTerminalProfile = getLocalTerminalProfile(preferences.terminal.localTerminalProfileId);

  const startWindowDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;

    if (target.closest('.app-no-drag,button,a,input,select,textarea')) {
      return;
    }

    void appWindow.startDragging().catch(() => undefined);
  };

  useEffect(() => subscribePreferences(setPreferences), []);

  useEffect(() => {
    if (!isViewMenuOpen && !isSessionMenuOpen && !isHelpMenuOpen) {
      return;
    }

    const closeOpenMenus = (event: PointerEvent) => {
      const target = event.target as Node;

      if (
        viewMenuRef.current?.contains(target) ||
        sessionMenuRef.current?.contains(target) ||
        helpMenuRef.current?.contains(target)
      ) {
        return;
      }

      setIsHelpMenuOpen(false);
      setIsViewMenuOpen(false);
      setIsSessionMenuOpen(false);
    };
    const closeOpenMenusOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsHelpMenuOpen(false);
        setIsViewMenuOpen(false);
        setIsSessionMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', closeOpenMenus);
    window.addEventListener('keydown', closeOpenMenusOnEscape);

    return () => {
      window.removeEventListener('pointerdown', closeOpenMenus);
      window.removeEventListener('keydown', closeOpenMenusOnEscape);
    };
  }, [isHelpMenuOpen, isSessionMenuOpen, isViewMenuOpen]);

  return (
    <div
      className="app-drag-region grid h-9 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center border-b bg-background text-xs text-muted-foreground"
      data-tauri-drag-region
      onPointerDown={startWindowDrag}
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
            onClick={() => {
              setIsViewMenuOpen((current) => !current);
              setIsHelpMenuOpen(false);
              setIsSessionMenuOpen(false);
            }}
          >
            View
          </Button>
          {isViewMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-xl">
              <SessionSubmenu label="Show View">
                <MenuButton
                  onClick={() => {
                    onToggleTransferQueue?.();
                    setIsViewMenuOpen(false);
                  }}
                >
                  <span className="grid w-4 place-items-center">
                    {isTransferQueueVisible ? <Check className="size-3.5 text-primary" /> : null}
                  </span>
                  Transfer Queue
                </MenuButton>
                <MenuButton
                  onClick={() => {
                    onToggleAiAssistant?.();
                    setIsViewMenuOpen(false);
                  }}
                >
                  <span className="grid w-4 place-items-center">
                    {isAiAssistantVisible ? <Check className="size-3.5 text-primary" /> : null}
                  </span>
                  AI Assistant
                </MenuButton>
              </SessionSubmenu>
            </div>
          )}
        </div>
        <div ref={sessionMenuRef} className="relative">
          <Button
            className="h-7 px-2 text-xs"
            variant="ghost"
            size="sm"
            type="button"
            title="Session"
            onClick={() => {
              setIsSessionMenuOpen((current) => !current);
              setIsHelpMenuOpen(false);
              setIsViewMenuOpen(false);
            }}
          >
            Session
          </Button>
          {isSessionMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-56 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-xl">
              <SessionSubmenu label="Open Local Terminal">
                <MenuButton
                  onClick={() => {
                    onOpenLocalTerminal({
                      target: defaultLocalTerminalProfile.target,
                      title: defaultLocalTerminalProfile.title,
                    });
                    setIsSessionMenuOpen(false);
                  }}
                >
                  <Terminal className="size-3.5 text-muted-foreground" />
                  <span>Default</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {defaultLocalTerminalProfile.label}
                  </span>
                </MenuButton>
                <div className="-mx-1 my-1 h-px bg-border" />
                {localTerminalProfiles.map((option) => (
                  <MenuButton
                    key={option.id}
                    onClick={() => {
                      onOpenLocalTerminal({ target: option.target, title: option.title });
                      setIsSessionMenuOpen(false);
                    }}
                  >
                    <Terminal className="size-3.5 text-muted-foreground" />
                    {option.label}
                  </MenuButton>
                ))}
              </SessionSubmenu>
              <SessionSubmenu label="Open as Administrator">
                {elevatedLocalTerminalProfiles.map((option) => (
                  <MenuButton
                    key={`elevated-${option.shell}`}
                    onClick={() => {
                      onOpenElevatedLocalTerminal(option.shell);
                      setIsSessionMenuOpen(false);
                    }}
                  >
                    <Terminal className="size-3.5 text-muted-foreground" />
                    {option.label}
                  </MenuButton>
                ))}
              </SessionSubmenu>
            </div>
          )}
        </div>
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
        <div ref={helpMenuRef} className="relative">
          <Button
            className="h-7 px-2 text-xs"
            variant="ghost"
            size="sm"
            type="button"
            title="Help"
            onClick={() => {
              setIsHelpMenuOpen((current) => !current);
              setIsSessionMenuOpen(false);
              setIsViewMenuOpen(false);
            }}
          >
            Help
          </Button>
          {isHelpMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-44 rounded-md border bg-popover p-1 text-xs text-popover-foreground shadow-xl">
              <MenuButton
                onClick={() => {
                  onCheckForUpdates?.();
                  setIsHelpMenuOpen(false);
                }}
              >
                Check for Updates
              </MenuButton>
            </div>
          )}
        </div>
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

function SessionSubmenu({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="group/menu relative">
      <button
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
        type="button"
      >
        <Terminal className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1">{label}</span>
        <span className="text-muted-foreground">&gt;</span>
      </button>
      <div className="invisible absolute left-[calc(100%+0.25rem)] top-0 min-w-44 rounded-md border bg-popover p-1 text-xs text-popover-foreground opacity-0 shadow-xl transition group-hover/menu:visible group-hover/menu:opacity-100">
        {children}
      </div>
    </div>
  );
}

function MenuButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
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
