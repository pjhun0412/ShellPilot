import { ChevronDown, ChevronUp, FolderOpen, Plus, Star, Terminal, Trash2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import {
  subscribeConnectionStatus,
  type ConnectionStatus,
} from '@/features/connections/connectionStatus';
import { patchStoredSession } from '@/features/sessions/sessionStorage';
import { querySshCurrentDirectory, writeSshData } from '@/features/terminal/sshTerminalBridge';
import { focusRegisteredTerminal } from '@/features/terminal/terminalRegistry';
import type { OpenSftpHandler, WorkspaceTabItem } from '@/types/workspace';

import {
  createSshCdCommand,
  createSshFavoritePath,
  normalizeSshPath,
  readSshSessionMetadata,
  type SshFavoritePath,
  writeSshFavoritePathsMetadata,
} from './sshSessionTools';

const SSH_ACTIVITY_UI_STORAGE_KEY = 'shellpilot.ssh.activity.ui.v1';
const MIN_TABS_PANEL_HEIGHT = 96;
const MAX_TABS_PANEL_HEIGHT = 260;
const COLLAPSED_TABS_PANEL_HEIGHT = 34;

export function SshActivityPanel({
  activePanelId,
  onClosePanel,
  onOpenSftp,
  onSelectPanel,
  workspaceTabs,
}: {
  activePanelId?: string;
  onClosePanel: (panelId: string) => void;
  onOpenSftp: OpenSftpHandler;
  onSelectPanel: (panelId: string) => void;
  workspaceTabs: WorkspaceTabItem[];
}) {
  const sshTabs = useMemo(
    () => workspaceTabs.filter(isSshTerminalTab),
    [workspaceTabs],
  );
  const activeSshTab = useMemo(
    () => sshTabs.find((tab) => tab.id === activePanelId) ?? sshTabs[0],
    [activePanelId, sshTabs],
  );
  const activeSession = activeSshTab?.session;
  const [favoritePathInput, setFavoritePathInput] = useState('');
  const [favoriteLabelInput, setFavoriteLabelInput] = useState('');
  const [favoritePaths, setFavoritePaths] = useState<SshFavoritePath[]>(
    () => readSshSessionMetadata(activeSession).favoritePaths,
  );
  const [statusText, setStatusText] = useState<string>();
  const [tabsPanelState, setTabsPanelState] = useState(() => loadSshActivityUiState());
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, ConnectionStatus>>({});
  const showEmptyState = useDelayedEmptyState(!activeSshTab || !activeSession);

  useLayoutEffect(() => {
    setFavoritePaths(readSshSessionMetadata(activeSession).favoritePaths);
    setFavoritePathInput('');
    setFavoriteLabelInput('');
    setStatusText(undefined);
  }, [activeSession?.id]);

  useEffect(() => {
    saveSshActivityUiState(tabsPanelState);
  }, [tabsPanelState]);

  useEffect(
    () =>
      subscribeConnectionStatus(({ panelId, status }) => {
        setConnectionStatuses((current) => ({
          ...current,
          [panelId]: status,
        }));
      }),
    [],
  );

  const saveFavoritePaths = async (nextFavoritePaths: SshFavoritePath[]) => {
    if (!activeSession) {
      return;
    }

    setFavoritePaths(nextFavoritePaths);
    setStatusText(undefined);
    try {
      const didSave = await patchStoredSession({
        notifyWorkspace: false,
        sessionId: activeSession.id,
        patch: {
          metadata: writeSshFavoritePathsMetadata(activeSession, nextFavoritePaths),
        },
      });

      setStatusText(didSave ? undefined : 'Session not found');
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : 'Failed to save SSH paths.');
    }
  };
  const resolveFavoritePathInput = async () => {
    const typedPath = normalizeSshPath(favoritePathInput);

    if (typedPath) {
      return typedPath;
    }

    if (!activeSshTab) {
      return undefined;
    }

    return querySshCurrentDirectory(activeSshTab.id);
  };
  const addFavoritePath = async () => {
    const path = normalizeSshPath((await resolveFavoritePathInput()) ?? '');

    if (!path || favoritePaths.some((item) => item.path === path)) {
      setStatusText(path ? undefined : 'Current path unavailable');
      return;
    }

    const nextFavoritePaths = [
      ...favoritePaths,
      createSshFavoritePath(path, favoriteLabelInput),
    ];

    setFavoritePathInput('');
    setFavoriteLabelInput('');
    await saveFavoritePaths(nextFavoritePaths);
  };
  const removeFavoritePath = (favoritePathId: string) => {
    void saveFavoritePaths(favoritePaths.filter((item) => item.id !== favoritePathId));
  };
  const sendCdCommand = (path: string) => {
    if (!activeSshTab) {
      return;
    }

    void writeSshData(activeSshTab.id, createSshCdCommand(path)).then(() => {
      focusRegisteredTerminal(activeSshTab.id);
    });
  };
  const openSftpAtPath = (path?: string) => {
    if (!activeSession) {
      return;
    }

    onOpenSftp(activeSession, { initialPath: path, revealInSidebar: false });
  };

  if (!activeSshTab || !activeSession) {
    return (
      <section className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
        {showEmptyState ? <EmptySshState /> : <div className="min-h-0" />}
        <SshTabsPanel
          activeSshTabId={activeSshTab?.id}
          connectionStatuses={connectionStatuses}
          isCollapsed={tabsPanelState.isTabsPanelCollapsed}
          onClosePanel={onClosePanel}
          onResize={(height) => setTabsPanelState((current) => ({ ...current, tabsPanelHeight: height }))}
          onSelectPanel={onSelectPanel}
          onToggleCollapsed={() =>
            setTabsPanelState((current) => ({
              ...current,
              isTabsPanelCollapsed: !current.isTabsPanelCollapsed,
            }))
          }
          panelHeight={tabsPanelState.tabsPanelHeight}
          sshTabs={sshTabs}
        />
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-3">
      <div className="rounded-lg border border-border/70 bg-slate-950/35 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <Terminal className="mt-0.5 size-4 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{activeSession.name}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {activeSession.username ? `${activeSession.username}@` : ''}
              {activeSession.host ?? 'unknown host'}:{activeSession.port ?? 22}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-card/50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Favorite Paths</h2>
        </div>
        <div className="grid gap-2">
          <input
            className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            placeholder="Label (optional)"
            value={favoriteLabelInput}
            onChange={(event) => setFavoriteLabelInput(event.target.value)}
          />
          <div className="grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1.5">
            <input
              className="h-8 rounded border border-input bg-background/70 px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              placeholder="Path or blank for current"
              value={favoritePathInput}
              onChange={(event) => setFavoritePathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void addFavoritePath();
                }
              }}
            />
            <Button
              className="h-8 w-7 px-0"
              size="icon"
              type="button"
              onClick={() => void addFavoritePath()}
              aria-label="Add SSH favorite path"
              title="Add typed path or current SSH directory"
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          {statusText && (
            <div className="truncate text-[10px] leading-3 text-destructive" aria-live="polite">
              {statusText}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <OverlayScrollArea>
          <div className="grid gap-2 pr-2">
            {favoritePaths.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                Save frequently used remote paths here. Use the terminal button to send a cd command.
              </div>
            ) : (
              favoritePaths.map((favoritePath) => (
                <div
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-1 rounded-md border border-border/70 bg-background/40 p-2"
                  key={favoritePath.id}
                >
                  <div className="grid min-w-0 gap-0.5">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Star className="size-3 text-primary" />
                      <span className="truncate" title={favoritePath.label}>{favoritePath.label}</span>
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground" title={favoritePath.path}>
                      {favoritePath.path}
                    </span>
                  </div>
                  <button
                    className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    type="button"
                    title="Go to path in SSH"
                    aria-label="Go to path in SSH"
                    onClick={() => sendCdCommand(favoritePath.path)}
                  >
                    <Terminal className="size-3.5" />
                  </button>
                  <button
                    className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    type="button"
                    title="Open path in SFTP"
                    aria-label="Open path in SFTP"
                    onClick={() => openSftpAtPath(favoritePath.path)}
                  >
                    <FolderOpen className="size-3.5" />
                  </button>
                  <button
                    className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    type="button"
                    title="Remove path"
                    aria-label="Remove path"
                    onClick={() => removeFavoritePath(favoritePath.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </OverlayScrollArea>
      </div>

      <SshTabsPanel
        activeSshTabId={activeSshTab.id}
        connectionStatuses={connectionStatuses}
        isCollapsed={tabsPanelState.isTabsPanelCollapsed}
        onClosePanel={onClosePanel}
        onResize={(height) => setTabsPanelState((current) => ({ ...current, tabsPanelHeight: height }))}
        onSelectPanel={onSelectPanel}
        onToggleCollapsed={() =>
          setTabsPanelState((current) => ({
            ...current,
            isTabsPanelCollapsed: !current.isTabsPanelCollapsed,
          }))
        }
        panelHeight={tabsPanelState.tabsPanelHeight}
        sshTabs={sshTabs}
      />
    </section>
  );
}

function EmptySshState() {
  return (
    <div className="min-h-0">
      <div className="rounded-lg border border-dashed border-border/80 px-3 py-5 text-xs text-muted-foreground">
        Open or select an SSH terminal to manage remote favorite paths.
      </div>
    </div>
  );
}

function useDelayedEmptyState(shouldShow: boolean) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!shouldShow) {
      setIsVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => setIsVisible(true), 120);

    return () => window.clearTimeout(timeoutId);
  }, [shouldShow]);

  return isVisible;
}

function SshTabsPanel({
  activeSshTabId,
  connectionStatuses,
  isCollapsed,
  onClosePanel,
  onSelectPanel,
  onResize,
  onToggleCollapsed,
  panelHeight,
  sshTabs,
}: {
  activeSshTabId?: string;
  connectionStatuses: Record<string, ConnectionStatus>;
  isCollapsed: boolean;
  onClosePanel: (panelId: string) => void;
  onSelectPanel: (panelId: string) => void;
  onResize: (height: number) => void;
  onToggleCollapsed: () => void;
  panelHeight: number;
  sshTabs: WorkspaceTabItem[];
}) {
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelHeight;

    const resize = (moveEvent: PointerEvent) => {
      onResize(clampTabsPanelHeight(startHeight - (moveEvent.clientY - startY)));
    };
    const finishResize = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finishResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finishResize, { once: true });
  };
  const bodyHeight = isCollapsed ? COLLAPSED_TABS_PANEL_HEIGHT : panelHeight;

  return (
    <section
      className="shrink-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950/45"
      style={{ height: bodyHeight }}
      aria-label="SSH tabs"
    >
      {!isCollapsed && (
        <div
          className="h-2 cursor-ns-resize border-b border-slate-800/70 bg-slate-900/70 hover:bg-teal-500/30"
          role="separator"
          aria-orientation="horizontal"
          title="Resize SSH tabs"
          onPointerDown={startResize}
        />
      )}
      <div className="flex h-8 items-center gap-2 border-b border-slate-800 px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          SSH Tabs
        </span>
        <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {sshTabs.length}
        </span>
        <button
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-slate-800 hover:text-foreground"
          type="button"
          aria-label={isCollapsed ? 'Expand SSH tabs' : 'Collapse SSH tabs'}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          onClick={onToggleCollapsed}
        >
          {isCollapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>
      {!isCollapsed && (
        <OverlayScrollArea className="p-2" containerClassName="h-[calc(100%-2.375rem)]">
          {sshTabs.length === 0 ? (
            <div className="grid h-full place-items-center rounded border border-dashed border-slate-800 px-3 text-center text-xs text-muted-foreground">
              Open SSH tabs will appear here.
            </div>
          ) : (
            <div className="grid gap-1">
              {sshTabs.map((tab, index) => {
                const tabLabel = `SSH #${index + 1} · ${tab.session?.name ?? tab.title}`;

                return (
                <div
                  className={[
                    'group grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1 rounded px-2 py-1.5 text-xs transition-colors',
                    tab.id === activeSshTabId
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  ].join(' ')}
                  key={tab.id}
                >
                  <button
                    className="grid min-w-0 gap-0.5 text-left"
                    type="button"
                    onClick={() => onSelectPanel(tab.id)}
                  >
                    <span className="truncate font-semibold" title={tabLabel}>{tabLabel}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      {tab.session?.username ? `${tab.session.username}@` : ''}
                      {tab.session?.host ?? 'unknown host'}:{tab.session?.port ?? 22}
                    </span>
                  </button>
                  <SshTabStatus status={connectionStatuses[tab.id]} />
                  <button
                    className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    type="button"
                    title="Close SSH tab"
                    aria-label="Close SSH tab"
                    onClick={(event) => {
                      event.stopPropagation();
                      onClosePanel(tab.id);
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </OverlayScrollArea>
      )}
    </section>
  );
}

function SshTabStatus({ status }: { status?: ConnectionStatus }) {
  return (
    <span
      className={[
        'size-1.5 rounded-full',
        getSshStatusDotClassName(status),
      ].join(' ')}
      title={formatSshStatus(status)}
      aria-label={formatSshStatus(status)}
    />
  );
}

function formatSshStatus(status?: ConnectionStatus) {
  if (status === 'connected') {
    return 'on';
  }

  if (status === 'connecting') {
    return 'ing';
  }

  if (status === 'failed') {
    return 'err';
  }

  if (status === 'closed') {
    return 'off';
  }

  if (status === 'restored') {
    return 'restored';
  }

  return 'idle';
}

function getSshStatusDotClassName(status?: ConnectionStatus) {
  if (status === 'connected') {
    return 'bg-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.12)]';
  }

  if (status === 'restored') {
    return 'bg-slate-500';
  }

  if (status === 'connecting') {
    return 'bg-cyan-300 shadow-[0_0_0_2px_rgba(103,232,249,0.12)]';
  }

  if (status === 'failed') {
    return 'bg-red-400 shadow-[0_0_0_2px_rgba(248,113,113,0.12)]';
  }

  if (status === 'closed') {
    return 'bg-slate-500';
  }

  return 'bg-slate-600';
}

function loadSshActivityUiState() {
  if (typeof window === 'undefined') {
    return {
      isTabsPanelCollapsed: false,
      tabsPanelHeight: 140,
    };
  }

  try {
    const raw = window.localStorage.getItem(SSH_ACTIVITY_UI_STORAGE_KEY);

    if (!raw) {
      return {
        isTabsPanelCollapsed: false,
        tabsPanelHeight: 140,
      };
    }

    const parsed = JSON.parse(raw) as Partial<{
      isTabsPanelCollapsed: boolean;
      tabsPanelHeight: number;
      version: 1;
    }>;

    if (parsed.version !== 1) {
      return {
        isTabsPanelCollapsed: false,
        tabsPanelHeight: 140,
      };
    }

    return {
      isTabsPanelCollapsed: Boolean(parsed.isTabsPanelCollapsed),
      tabsPanelHeight: clampTabsPanelHeight(parsed.tabsPanelHeight ?? 140),
    };
  } catch {
    return {
      isTabsPanelCollapsed: false,
      tabsPanelHeight: 140,
    };
  }
}

function saveSshActivityUiState(state: {
  isTabsPanelCollapsed: boolean;
  tabsPanelHeight: number;
}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    SSH_ACTIVITY_UI_STORAGE_KEY,
    JSON.stringify({
      ...state,
      version: 1,
    }),
  );
}

function clampTabsPanelHeight(height: number) {
  return Math.min(MAX_TABS_PANEL_HEIGHT, Math.max(MIN_TABS_PANEL_HEIGHT, Math.round(height)));
}

function isSshTerminalTab(tab: WorkspaceTabItem) {
  return tab.type === 'terminal' && tab.session?.kind === 'ssh';
}
