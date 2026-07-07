import { invoke } from '@tauri-apps/api/core';
import {
  Bot,
  Copy,
  Folder,
  KeyRound,
  Monitor,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { appConfirm } from '@/components/ui/app-dialog';
import { SshTerminal } from '@/features/terminal/SshTerminal';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import type { WorkspacePanel } from '@/types/workspace';

export function PanelBody({
  isActive,
  onActivate,
  panel,
}: {
  isActive?: boolean;
  onActivate?: () => void;
  panel: WorkspacePanel;
}) {
  if (panel.type === 'terminal') {
    return (
      <PanelFocusFrame isActive={isActive} onActivate={onActivate}>
        {panel.session?.kind === 'ssh' ? (
          <SshTerminal autoConnect={panel.autoConnect !== false} panelId={panel.id} session={panel.session} />
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

function SettingsPanel() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const sections = [
    {
      description: 'Theme, density, and workspace restore options will live here.',
      icon: Settings,
      id: 'general',
      title: 'General',
    },
    {
      description: 'Font, scrollback, copy/paste, and rendering preferences.',
      icon: Terminal,
      id: 'terminal',
      title: 'Terminal',
    },
    {
      description: 'Known hosts, key handling, agent behavior, and connection defaults.',
      icon: ShieldCheck,
      id: 'ssh-security',
      title: 'SSH Security',
    },
    {
      description: 'Credential store policy and saved secret references.',
      icon: KeyRound,
      id: 'credentials',
      title: 'Credentials',
    },
  ] satisfies SettingsSection[];
  const selectedSection = sections.find((section) => section.id === activeSection);

  return (
    <div className="settings-panel h-full min-h-0">
      <div className="settings-panel__layout">
        <aside className="settings-panel__nav">
          <div className="settings-panel__heading">
            <h2 className="text-sm font-semibold text-slate-100">Settings</h2>
            <p className="mt-1 text-xs text-slate-500">ShellPilot preferences</p>
          </div>
          <nav className="settings-panel__nav-list">
            {sections.map((section) => (
              <SettingsNavButton
                isActive={activeSection === section.id}
                key={section.id}
                section={section}
                onSelect={() => setActiveSection(section.id)}
              />
            ))}
          </nav>
        </aside>
        <OverlayScrollArea className="settings-panel__content">
          <div className="settings-panel__content-inner">
            <div className="relative min-w-0 max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input
                className="h-9 w-full rounded-md border border-slate-800 bg-slate-950/70 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-primary/70"
                placeholder="Search settings"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-50">{selectedSection?.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">{selectedSection?.description}</p>
            </div>
            <SettingsSectionContent sectionId={activeSection} searchQuery={searchQuery} />
          </div>
        </OverlayScrollArea>
      </div>
    </div>
  );
}

type SettingsSectionId = 'general' | 'terminal' | 'ssh-security' | 'credentials';

interface SettingsSection {
  description: string;
  icon: typeof Settings;
  id: SettingsSectionId;
  title: string;
}

function SettingsNavButton({
  isActive,
  onSelect,
  section,
}: {
  isActive: boolean;
  onSelect: () => void;
  section: SettingsSection;
}) {
  const Icon = section.icon;

  return (
    <button
      className={cn(
        'flex h-8 min-w-0 flex-1 basis-36 items-center gap-2 rounded px-2 text-left text-sm transition-colors',
        isActive
          ? 'bg-slate-800/75 text-slate-50'
          : 'text-slate-400 hover:bg-slate-900/70 hover:text-slate-100',
      )}
      type="button"
      onClick={onSelect}
    >
      <Icon className={cn('size-3.5 shrink-0', isActive ? 'text-primary' : 'text-slate-500')} />
      <span className="truncate">{section.title}</span>
    </button>
  );
}

function SettingsSectionContent({
  searchQuery,
  sectionId,
}: {
  searchQuery: string;
  sectionId: SettingsSectionId;
}) {
  if (sectionId === 'ssh-security') {
    return (
      <div className="grid gap-3">
        <KnownHostsSettings searchQuery={searchQuery} />
      </div>
    );
  }

  const copyBySection: Record<Exclude<SettingsSectionId, 'ssh-security'>, string> = {
    credentials: 'Credential store policy and saved secret references will be managed here.',
    general: 'Theme, density, and workspace restore preferences will be added here.',
    terminal: 'Terminal font, scrollback, paste, and rendering options will be added here.',
  };

  return (
    <section className="rounded-md border border-dashed border-slate-800 bg-slate-950/20 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-300">
        {copyBySection[sectionId]}
      </p>
    </section>
  );
}

function OverlayScrollArea({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({
    height: 0,
    top: 0,
    visible: false,
  });

  const syncThumb = useCallback(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const maxScrollTop = element.scrollHeight - element.clientHeight;

    if (maxScrollTop <= 0) {
      setThumb({ height: 0, top: 0, visible: false });
      return;
    }

    const trackHeight = element.clientHeight - 4;
    const height = Math.max(32, Math.round((element.clientHeight / element.scrollHeight) * trackHeight));
    const top = Math.round((element.scrollTop / maxScrollTop) * (trackHeight - height)) + 2;

    setThumb({ height, top, visible: true });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver(syncThumb);

    resizeObserver.observe(element);
    if (element.firstElementChild) {
      resizeObserver.observe(element.firstElementChild);
    }

    syncThumb();

    return () => {
      resizeObserver.disconnect();
    };
  }, [syncThumb]);

  return (
    <div className="group/scroll relative h-full min-h-0 overflow-hidden">
      <div
        className={cn('app-scrollbar-native-hidden h-full min-h-0 overflow-auto', className)}
        ref={scrollRef}
        onScroll={syncThumb}
      >
        {children}
      </div>
      {thumb.visible && (
        <div className="pointer-events-none absolute bottom-1 right-0 top-1 w-2 opacity-0 transition-opacity duration-200 group-hover/scroll:opacity-100">
          <div
            className="absolute right-1 w-1.5 rounded-full bg-[hsl(var(--scrollbar-thumb)_/_0.78)] transition-colors duration-200"
            style={{ height: thumb.height, top: thumb.top }}
          />
        </div>
      )}
    </div>
  );
}

interface KnownHostRecord {
  algorithm: string;
  fingerprint: string;
  host: string;
  port: number;
}

function KnownHostsSettings({ searchQuery }: { searchQuery: string }) {
  const [knownHosts, setKnownHosts] = useState<KnownHostRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredKnownHosts = normalizedSearchQuery
    ? knownHosts.filter((record) =>
        [record.host, String(record.port), record.algorithm, record.fingerprint]
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearchQuery),
      )
    : knownHosts;

  const loadKnownHosts = async () => {
    setIsLoading(true);
    setErrorMessage(undefined);

    try {
      setKnownHosts(await invoke<KnownHostRecord[]>('list_ssh_known_hosts'));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadKnownHosts();
  }, []);

  const deleteKnownHost = async (record: KnownHostRecord) => {
    const confirmed = await appConfirm({
      confirmLabel: 'Delete',
      message: `Delete the trusted SSH host key for ${record.host}:${record.port}?\n\nThe next connection will require fingerprint verification again.`,
      title: 'Delete Known Host',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    await invoke('forget_ssh_known_host', {
      host: record.host,
      port: record.port,
    });
    await loadKnownHosts();
  };

  const clearKnownHosts = async () => {
    const confirmed = await appConfirm({
      confirmLabel: 'Delete All',
      message:
        'Delete all trusted SSH host keys?\n\nEvery server will require fingerprint verification on the next connection.',
      title: 'Delete All Known Hosts',
      tone: 'danger',
    });

    if (!confirmed) {
      return;
    }

    await invoke('clear_ssh_known_hosts');
    await loadKnownHosts();
  };

  const copyFingerprint = async (record: KnownHostRecord) => {
    await navigator.clipboard.writeText(record.fingerprint).catch(() => undefined);
  };

  return (
    <section className="grid min-w-0 gap-3 rounded-md border border-slate-800 bg-slate-950/35 p-3">
      <div className="grid min-w-0 gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-100">SSH Known Hosts</h3>
            <p className="mt-1 text-xs font-medium leading-5 text-slate-400">
              Trusted SSH host keys are stored locally and used to detect server identity changes.
            </p>
          </div>
          <span className="rounded border border-slate-800 bg-slate-950/80 px-2 py-1 font-mono text-[11px] font-semibold text-slate-300">
            {knownHosts.length}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button size="sm" type="button" variant="secondary" disabled={isLoading} onClick={() => void loadKnownHosts()}>
            <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button
            size="sm"
            type="button"
            variant="ghost"
            disabled={knownHosts.length === 0}
            onClick={() => void clearKnownHosts()}
          >
            <Trash2 className="size-3.5" />
            Delete All
          </Button>
        </div>
        <div className="rounded border border-slate-900 bg-black/20 px-3 py-2">
          <p className="text-xs font-medium leading-5 text-slate-400">
            New hosts require fingerprint approval before connecting. Changed host keys are blocked until you reset trust for that host.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {errorMessage}
        </div>
      )}

      {knownHosts.length === 0 ? (
        <div className="rounded border border-dashed border-slate-800 px-3 py-6 text-center text-xs font-medium text-slate-500">
          {isLoading ? 'Loading known hosts...' : 'No trusted SSH host keys yet.'}
        </div>
      ) : filteredKnownHosts.length === 0 ? (
        <div className="rounded border border-dashed border-slate-800 px-3 py-6 text-center text-xs font-medium text-slate-500">
          No known hosts match this search.
        </div>
      ) : (
        <div className="grid min-w-0 gap-2">
          {filteredKnownHosts.map((record) => (
            <div
              className="grid min-w-0 gap-2 rounded-md border border-slate-800 bg-slate-950/45 p-3"
              key={`${record.host}:${record.port}`}
            >
              <div className="grid min-w-0 gap-2">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm font-semibold text-slate-100">
                    <span className="min-w-0 truncate">{record.host}</span>
                    <span className="font-mono text-xs font-normal text-slate-400">:{record.port}</span>
                  </div>
                  <div className="mt-1 text-xs font-medium text-slate-400">{record.algorithm}</div>
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <Button
                    size="icon"
                    type="button"
                    variant="ghost"
                    aria-label={`Copy fingerprint for ${record.host}:${record.port}`}
                    title="Copy fingerprint"
                    onClick={() => void copyFingerprint(record)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    type="button"
                    variant="ghost"
                    aria-label={`Delete ${record.host}:${record.port}`}
                    title="Delete known host"
                    onClick={() => void deleteKnownHost(record)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <code
                className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded border border-slate-900 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-slate-300"
                title={record.fingerprint}
              >
                {record.fingerprint}
              </code>
            </div>
          ))}
        </div>
      )}
    </section>
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
