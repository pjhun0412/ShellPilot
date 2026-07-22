import { ChevronDown, ChevronUp, Clipboard, Play, Plus, Terminal, X } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { InlineSectionStatus } from '@/components/navigation/InlineSectionStatus';
import { SidebarActionMenu } from '@/components/navigation/SidebarActionMenu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import {
  subscribeConnectionStatus,
  type ConnectionStatus,
} from '@/features/connections/connectionStatus';
import { patchStoredSession } from '@/features/sessions/sessionStorage';
import { querySshCurrentDirectory, writeSshData } from '@/features/terminal/sshTerminalBridge';
import { focusRegisteredTerminal } from '@/features/terminal/terminalRegistry';
import { useTransientStatus } from '@/hooks/useTransientStatus';
import { matchesSearchText } from '@/lib/searchText';
import type { OpenSftpHandler, WorkspaceTabItem } from '@/types/workspace';

import {
  createSshCdCommand,
  createSshCommandInDirectory,
  createSshCommandSnippet,
  createSshFavoritePath,
  createSshSnippetPayload,
  notifySshSessionMetadataChanged,
  normalizeSshCommand,
  normalizeSshPath,
  readSshSessionMetadata,
  subscribeSshSessionMetadataChanged,
  type SshCommandSnippet,
  type SshFavoritePath,
  writeSshSessionMetadata,
} from './sshSessionTools';
import { confirmSshCommandSnippetSave } from './sshSnippetSecurity';

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
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, ConnectionStatus>>({});
  const activeSshTab = useMemo(
    () =>
      // Keep the sidebar bound to the selected SSH tab while its status event is
      // still pending. Otherwise it can fall back to another connected tab and
      // ignore that selected tab's favorite/snippet metadata updates.
      sshTabs.find((tab) => tab.id === activePanelId) ??
      sshTabs.find((tab) => connectionStatuses[tab.id] === 'connected'),
    [activePanelId, connectionStatuses, sshTabs],
  );
  const activeSession = activeSshTab?.session;
  const [favoritePathSearchInput, setFavoritePathSearchInput] = useState('');
  const [favoritePaths, setFavoritePaths] = useState<SshFavoritePath[]>(
    () => readSshSessionMetadata(activeSession).favoritePaths,
  );
  const [commandSnippetSearchInput, setCommandSnippetSearchInput] = useState('');
  const [snippetCommandInput, setSnippetCommandInput] = useState('');
  const [commandSnippets, setCommandSnippets] = useState<SshCommandSnippet[]>(
    () => readSshSessionMetadata(activeSession).commandSnippets,
  );
  const [editingFavoritePath, setEditingFavoritePath] = useState<SshFavoritePath>();
  const [editingCommandSnippet, setEditingCommandSnippet] = useState<SshCommandSnippet>();
  const [isAddingCommandSnippet, setIsAddingCommandSnippet] = useState(false);
  const {
    clearStatus: clearFavoriteStatus,
    setPersistentStatus: setPersistentFavoriteStatus,
    showTransientStatus: showTransientFavoriteStatus,
    statusText: favoriteStatusText,
  } = useTransientStatus();
  const {
    clearStatus: clearSnippetStatus,
    setPersistentStatus: setPersistentSnippetStatus,
    showTransientStatus: showTransientSnippetStatus,
    statusText: snippetStatusText,
  } = useTransientStatus();
  const [tabsPanelState, setTabsPanelState] = useState(() => loadSshActivityUiState());
  const showEmptyState = useDelayedEmptyState(!activeSshTab || !activeSession);
  const activeSshStatus = activeSshTab ? connectionStatuses[activeSshTab.id] : undefined;
  const canWriteToActiveSsh = activeSshStatus === 'connected';
  const filteredFavoritePaths = useMemo(
    () =>
      favoritePaths.filter((favoritePath) =>
        matchesSearchText(favoritePathSearchInput, favoritePath.label, favoritePath.path),
      ),
    [favoritePathSearchInput, favoritePaths],
  );
  const filteredCommandSnippets = useMemo(
    () =>
      commandSnippets.filter((snippet) =>
        matchesSearchText(commandSnippetSearchInput, snippet.label, snippet.command),
      ),
    [commandSnippetSearchInput, commandSnippets],
  );

  useLayoutEffect(() => {
    const metadata = readSshSessionMetadata(activeSession);

    setFavoritePaths(metadata.favoritePaths);
    setCommandSnippets(metadata.commandSnippets);
    setFavoritePathSearchInput('');
    setCommandSnippetSearchInput('');
    setSnippetCommandInput('');
    setIsAddingCommandSnippet(false);
    setEditingCommandSnippet(undefined);
    setEditingFavoritePath(undefined);
    clearFavoriteStatus();
    clearSnippetStatus();
  }, [activeSession?.id, clearFavoriteStatus, clearSnippetStatus]);

  useEffect(() => {
    saveSshActivityUiState(tabsPanelState);
  }, [tabsPanelState]);

  useEffect(
    () =>
      subscribeSshSessionMetadataChanged(({ metadata, sessionId }) => {
        if (sessionId !== activeSession?.id) {
          return;
        }

        setFavoritePaths(metadata.favoritePaths);
        setCommandSnippets(metadata.commandSnippets);
      }),
    [activeSession?.id],
  );

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
    clearFavoriteStatus();
    const nextMetadata = {
      commandSnippets,
      favoritePaths: nextFavoritePaths,
    };
    try {
      const didSave = await patchStoredSession({
        sessionId: activeSession.id,
        patch: {
          metadata: writeSshSessionMetadata(activeSession, nextMetadata),
        },
      });

      if (didSave) {
        notifySshSessionMetadataChanged({
          sessionId: activeSession.id,
          metadata: nextMetadata,
        });
        clearFavoriteStatus();
      } else {
        setPersistentFavoriteStatus('Session not found');
      }
    } catch (error) {
      setPersistentFavoriteStatus(error instanceof Error ? error.message : 'Failed to save SSH paths.');
    }
  };
  const saveCommandSnippets = async (nextCommandSnippets: SshCommandSnippet[]) => {
    if (!activeSession) {
      return;
    }

    setCommandSnippets(nextCommandSnippets);
    clearSnippetStatus();
    const nextMetadata = {
      commandSnippets: nextCommandSnippets,
      favoritePaths,
    };
    try {
      const didSave = await patchStoredSession({
        sessionId: activeSession.id,
        patch: {
          metadata: writeSshSessionMetadata(activeSession, nextMetadata),
        },
      });

      if (didSave) {
        notifySshSessionMetadataChanged({
          sessionId: activeSession.id,
          metadata: nextMetadata,
        });
        clearSnippetStatus();
      } else {
        setPersistentSnippetStatus('Session not found');
      }
    } catch (error) {
      setPersistentSnippetStatus(error instanceof Error ? error.message : 'Failed to save SSH snippets.');
    }
  };
  const resolveFavoritePathInput = async () => {
    if (!activeSshTab) {
      return undefined;
    }

    return querySshCurrentDirectory(activeSshTab.id);
  };
  const addFavoritePath = async () => {
    const path = normalizeSshPath((await resolveFavoritePathInput()) ?? '');

    if (!path) {
      showTransientFavoriteStatus('Current path unavailable');
      return;
    }

    if (favoritePaths.some((item) => item.path === path)) {
      showTransientFavoriteStatus('Path already exists');
      return;
    }

    const nextFavoritePaths = [
      ...favoritePaths,
      createSshFavoritePath(path),
    ];

    await saveFavoritePaths(nextFavoritePaths);
  };
  const removeFavoritePath = (favoritePathId: string) => {
    void saveFavoritePaths(favoritePaths.filter((item) => item.id !== favoritePathId));
  };
  const updateFavoritePath = (favoritePath: SshFavoritePath) => {
    const path = normalizeSshPath(favoritePath.path);

    if (!path) {
      showTransientFavoriteStatus('Path is required');
      return;
    }

    void saveFavoritePaths(
      favoritePaths.map((item) =>
        item.id === favoritePath.id
          ? {
              ...item,
              label: favoritePath.label.trim() || path,
              path,
            }
          : item,
      ),
    ).then(() => setEditingFavoritePath(undefined));
  };
  const addCommandSnippet = async (options: { useCurrentDirectory?: boolean } = {}) => {
    const typedCommand = normalizeSshCommand(snippetCommandInput);

    if (!typedCommand) {
      showTransientSnippetStatus('Command is required');
      return;
    }

    const currentDirectory = options.useCurrentDirectory && activeSshTab
      ? normalizeSshPath((await querySshCurrentDirectory(activeSshTab.id)) ?? '')
      : '';

    if (options.useCurrentDirectory && !currentDirectory) {
      showTransientSnippetStatus('Current path unavailable');
      return;
    }

    const command = options.useCurrentDirectory
      ? createSshCommandInDirectory(currentDirectory, typedCommand)
      : typedCommand;

    if (commandSnippets.some((item) => item.command === command)) {
      showTransientSnippetStatus('Snippet already exists');
      return;
    }

    if (!(await confirmSshCommandSnippetSave(typedCommand))) {
      showTransientSnippetStatus('Snippet not saved');
      return;
    }

    const nextCommandSnippets = [
      ...commandSnippets,
      createSshCommandSnippet(command, createCommandSnippetLabel(typedCommand), {
        basePath: currentDirectory,
        displayCommand: options.useCurrentDirectory ? typedCommand : undefined,
      }),
    ];

    setSnippetCommandInput('');
    setIsAddingCommandSnippet(false);
    await saveCommandSnippets(nextCommandSnippets);
  };
  const removeCommandSnippet = (snippetId: string) => {
    void saveCommandSnippets(commandSnippets.filter((item) => item.id !== snippetId));
  };
  const updateCommandSnippet = async (snippet: SshCommandSnippet) => {
    const command = normalizeSshCommand(snippet.command);

    if (!command) {
      showTransientSnippetStatus('Command is required');
      return;
    }

    const existingSnippet = commandSnippets.find((item) => item.id === snippet.id);

    if (existingSnippet?.command !== command && !(await confirmSshCommandSnippetSave(command))) {
      showTransientSnippetStatus('Snippet not saved');
      return;
    }

    await saveCommandSnippets(
      commandSnippets.map((item) =>
        item.id === snippet.id
          ? {
              ...item,
              command,
              basePath: undefined,
              displayCommand: undefined,
              label: snippet.label.trim() || command,
            }
          : item,
      ),
    );
    setEditingCommandSnippet(undefined);
  };
  const sendCdCommand = (path: string) => {
    if (!activeSshTab) {
      return;
    }

    void writeSshData(activeSshTab.id, createSshCdCommand(path)).then(() => {
      focusRegisteredTerminal(activeSshTab.id);
    });
  };
  const sendSnippetCommand = (snippet: SshCommandSnippet, shouldRun: boolean) => {
    if (!activeSshTab || !canWriteToActiveSsh) {
      return;
    }

    const payload = createSshSnippetPayload(snippet.command, shouldRun);

    if (!payload) {
      return;
    }

    void writeSshData(activeSshTab.id, payload).then(() => {
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
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
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

      <div className="flex min-h-0 flex-col gap-3">
        <CollapsibleToolSection
          count={
            favoritePathSearchInput.trim()
              ? `${filteredFavoritePaths.length}/${favoritePaths.length}`
              : favoritePaths.length
          }
          isCollapsed={tabsPanelState.isFavoritePathsCollapsed}
          onToggleCollapsed={() =>
            setTabsPanelState((current) => ({
              ...current,
              isFavoritePathsCollapsed: !current.isFavoritePathsCollapsed,
            }))
          }
          title="Favorite Paths"
        >
          <div className="grid gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1.5">
              <input
                className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                placeholder="Search favorite paths"
                value={favoritePathSearchInput}
                onChange={(event) => setFavoritePathSearchInput(event.target.value)}
              />
              <Button
                className="h-8 w-7 px-0"
                size="icon"
                type="button"
                onClick={() => void addFavoritePath()}
                aria-label="Add SSH favorite path"
                title="Add current SSH directory"
              >
                <Plus className="size-3.5" />
              </Button>
            </div>
            <InlineSectionStatus message={favoriteStatusText} />
          </div>
          <div className="min-h-0">
            <OverlayScrollArea>
              <div className="grid gap-2">
                {favoritePaths.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                    Save frequently used remote paths here. Use the terminal button to send a cd command.
                  </div>
                ) : filteredFavoritePaths.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                    No favorite paths match this search.
                  </div>
                ) : (
                  filteredFavoritePaths.map((favoritePath) => (
                    <FavoritePathCard
                      editingValue={editingFavoritePath?.id === favoritePath.id ? editingFavoritePath : undefined}
                      favoritePath={favoritePath}
                      key={favoritePath.id}
                      onCancelEdit={() => setEditingFavoritePath(undefined)}
                      onChangeEdit={setEditingFavoritePath}
                      onEdit={() => setEditingFavoritePath(favoritePath)}
                      onOpenSftp={() => openSftpAtPath(favoritePath.path)}
                      onRemove={() => removeFavoritePath(favoritePath.id)}
                      onSaveEdit={updateFavoritePath}
                      onSendCd={() => sendCdCommand(favoritePath.path)}
                    />
                  ))
                )}
              </div>
            </OverlayScrollArea>
          </div>
        </CollapsibleToolSection>

        <CollapsibleToolSection
          count={
            commandSnippetSearchInput.trim()
              ? `${filteredCommandSnippets.length}/${commandSnippets.length}`
              : commandSnippets.length
          }
          isCollapsed={tabsPanelState.isCommandSnippetsCollapsed}
          onToggleCollapsed={() =>
            setTabsPanelState((current) => ({
              ...current,
              isCommandSnippetsCollapsed: !current.isCommandSnippetsCollapsed,
            }))
          }
          title="Command Snippets"
        >
          <div className="grid gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1.5">
              <input
                className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                placeholder="Search command snippets"
                value={commandSnippetSearchInput}
                onChange={(event) => setCommandSnippetSearchInput(event.target.value)}
              />
              <Button
                className="h-8 w-7 px-0"
                size="icon"
                type="button"
                onClick={() => setIsAddingCommandSnippet((current) => !current)}
                aria-label="Add SSH command snippet"
                title="Add command snippet"
              >
                {isAddingCommandSnippet ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
              </Button>
            </div>
            {isAddingCommandSnippet && (
              <div className="grid gap-2 rounded-md border border-primary/25 bg-background/40 p-2">
                <div className="grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1.5">
                  <input
                    className="h-8 rounded border border-input bg-background/70 px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                    placeholder="Command, e.g. tail -f ~/app/logs/app.log"
                    value={snippetCommandInput}
                    onChange={(event) => setSnippetCommandInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void addCommandSnippet();
                      }
                    }}
                  />
                  <SidebarActionMenu
                    ariaLabel="Choose SSH command snippet save mode"
                    icon={<Plus className="size-3.5" />}
                    items={[
                      { label: 'Save as typed', onSelect: () => void addCommandSnippet() },
                      { label: 'Save with current path', onSelect: () => void addCommandSnippet({ useCurrentDirectory: true }) },
                    ]}
                    title="Choose snippet save mode"
                  />
                </div>
              </div>
            )}
            <InlineSectionStatus message={snippetStatusText} />
          </div>
          <div className="min-h-0">
            <OverlayScrollArea>
              <div className="grid gap-2">
                {commandSnippets.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                    Save commands for this SSH session. Paste inserts text; Run sends Enter.
                  </div>
                ) : filteredCommandSnippets.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                    No command snippets match this search.
                  </div>
                ) : (
                  filteredCommandSnippets.map((snippet) => (
                    <CommandSnippetCard
                      canWrite={canWriteToActiveSsh}
                      editingValue={editingCommandSnippet?.id === snippet.id ? editingCommandSnippet : undefined}
                      key={snippet.id}
                      onCancelEdit={() => setEditingCommandSnippet(undefined)}
                      onChangeEdit={setEditingCommandSnippet}
                      onEdit={() => setEditingCommandSnippet(snippet)}
                      onPaste={() => sendSnippetCommand(snippet, false)}
                      onRemove={() => removeCommandSnippet(snippet.id)}
                      onRun={() => sendSnippetCommand(snippet, true)}
                      onSaveEdit={updateCommandSnippet}
                      snippet={snippet}
                    />
                  ))
                )}
              </div>
            </OverlayScrollArea>
          </div>
        </CollapsibleToolSection>
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

function CollapsibleToolSection({
  children,
  count,
  isCollapsed,
  onToggleCollapsed,
  title,
}: {
  children: ReactNode;
  count: ReactNode;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
  title: string;
}) {
  return (
    <section
      className={[
        'min-h-0 overflow-hidden rounded-lg border border-border/70 bg-card/50',
        isCollapsed ? 'shrink-0' : 'flex flex-1 flex-col',
      ].join(' ')}
    >
      <button
        className="flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-accent/60"
        type="button"
        onClick={onToggleCollapsed}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {count}
        </span>
        {isCollapsed ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronUp className="size-3.5 text-muted-foreground" />}
      </button>
      {!isCollapsed && (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-2 px-3 pb-3">
          {children}
        </div>
      )}
    </section>
  );
}

function FavoritePathCard({
  editingValue,
  favoritePath,
  onCancelEdit,
  onChangeEdit,
  onEdit,
  onOpenSftp,
  onRemove,
  onSaveEdit,
  onSendCd,
}: {
  editingValue?: SshFavoritePath;
  favoritePath: SshFavoritePath;
  onCancelEdit: () => void;
  onChangeEdit: (favoritePath: SshFavoritePath) => void;
  onEdit: () => void;
  onOpenSftp: () => void;
  onRemove: () => void;
  onSaveEdit: (favoritePath: SshFavoritePath) => void;
  onSendCd: () => void;
}) {
  if (editingValue) {
    return (
      <div className="grid gap-2 rounded-md border border-border/70 bg-background/50 p-2">
        <input
          className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          value={editingValue.label}
          onChange={(event) => onChangeEdit({ ...editingValue, label: event.target.value })}
        />
        <input
          className="h-8 rounded border border-input bg-background/70 px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          value={editingValue.path}
          onChange={(event) => onChangeEdit({ ...editingValue, path: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onSaveEdit(editingValue);
            }
            if (event.key === 'Escape') {
              onCancelEdit();
            }
          }}
        />
        <div className="flex justify-end gap-1.5">
          <Button className="h-7 px-2 text-xs" size="sm" variant="ghost" type="button" onClick={onCancelEdit}>
            Cancel
          </Button>
          <Button className="h-7 px-2 text-xs" size="sm" type="button" onClick={() => onSaveEdit(editingValue)}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-1 rounded border border-border/60 bg-background/35 px-1.5 py-1 shadow-[inset_2px_0_0_hsl(var(--primary)_/_0.35)] transition-colors hover:border-primary/35 hover:bg-accent/35">
          <button className="flex h-6 min-w-0 items-center text-left" type="button" title={favoritePath.path} onDoubleClick={onEdit}>
            <span className="block truncate text-[11px] font-semibold text-foreground" title={favoritePath.label}>
              {favoritePath.label}
            </span>
          </button>
          <button
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            type="button"
            title="Go to path in SSH"
            aria-label="Go to path in SSH"
            onClick={onSendCd}
          >
            <Terminal className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="max-w-64">
        <ContextMenuLabel className="truncate" title={favoritePath.label}>
          {favoritePath.label}
        </ContextMenuLabel>
        <ContextMenuItem onSelect={onSendCd}>Go to path in SSH</ContextMenuItem>
        <ContextMenuItem onSelect={onOpenSftp}>Open path in SFTP</ContextMenuItem>
        <ContextMenuItem onSelect={onEdit}>Edit</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
          Remove path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CommandSnippetCard({
  canWrite,
  editingValue,
  onCancelEdit,
  onChangeEdit,
  onEdit,
  onPaste,
  onRemove,
  onRun,
  onSaveEdit,
  snippet,
}: {
  canWrite: boolean;
  editingValue?: SshCommandSnippet;
  onCancelEdit: () => void;
  onChangeEdit: (snippet: SshCommandSnippet) => void;
  onEdit: () => void;
  onPaste: () => void;
  onRemove: () => void;
  onRun: () => void;
  onSaveEdit: (snippet: SshCommandSnippet) => void;
  snippet: SshCommandSnippet;
}) {
  const displayCommand = getSnippetDisplayCommand(snippet);
  const basePath = getSnippetBasePath(snippet);
  const commandTitle = displayCommand !== snippet.command
    ? `${basePath ? `Base path: ${basePath}\n` : ''}Runs: ${snippet.command}`
    : snippet.command;

  if (editingValue) {
    return (
      <div className="grid gap-2 rounded-md border border-border/70 bg-background/50 p-2">
        <input
          className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          value={editingValue.label}
          onChange={(event) => onChangeEdit({ ...editingValue, label: event.target.value })}
        />
        <input
          className="h-8 rounded border border-input bg-background/70 px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
          value={editingValue.command}
          onChange={(event) => onChangeEdit({ ...editingValue, command: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onSaveEdit(editingValue);
            }
            if (event.key === 'Escape') {
              onCancelEdit();
            }
          }}
        />
        <div className="flex justify-end gap-1.5">
          <Button className="h-7 px-2 text-xs" size="sm" variant="ghost" type="button" onClick={onCancelEdit}>
            Cancel
          </Button>
          <Button className="h-7 px-2 text-xs" size="sm" type="button" onClick={() => onSaveEdit(editingValue)}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem_1.5rem] items-center gap-1 rounded border border-border/60 bg-background/35 px-1.5 py-1 shadow-[inset_2px_0_0_hsl(var(--primary)_/_0.35)] transition-colors hover:border-primary/35 hover:bg-accent/35">
          <button className="flex h-6 min-w-0 items-center text-left" type="button" title={commandTitle} onDoubleClick={onEdit}>
            <span className="block truncate text-[11px] font-semibold text-foreground" title={snippet.label}>
              {snippet.label}
            </span>
          </button>
          <button
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            title={canWrite ? 'Paste command' : 'Reconnect SSH before pasting'}
            aria-label="Paste command"
            disabled={!canWrite}
            onClick={onPaste}
          >
            <Clipboard className="size-3" />
          </button>
          <button
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            title={canWrite ? 'Run command' : 'Reconnect SSH before running'}
            aria-label="Run command"
            disabled={!canWrite}
            onClick={onRun}
          >
            <Play className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="max-w-64">
        <ContextMenuLabel className="truncate" title={snippet.label}>
          {snippet.label}
        </ContextMenuLabel>
        <ContextMenuItem disabled={!canWrite} onSelect={onPaste}>Paste command</ContextMenuItem>
        <ContextMenuItem disabled={!canWrite} onSelect={onRun}>Run command</ContextMenuItem>
        <ContextMenuItem onSelect={onEdit}>Edit</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onRemove}>
          Remove snippet
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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

function createCommandSnippetLabel(command: string) {
  return command.split(/\s+/).slice(0, 3).join(' ') || 'Command';
}

function getSnippetDisplayCommand(snippet: SshCommandSnippet) {
  if (snippet.displayCommand) {
    return snippet.displayCommand;
  }

  const commandMatch = /^cd -- '(?:[^']|'\\'')*' && (.+)$/.exec(snippet.command);

  return commandMatch?.[1] ?? snippet.command;
}

function getSnippetBasePath(snippet: SshCommandSnippet) {
  if (snippet.basePath) {
    return snippet.basePath;
  }

  const pathMatch = /^cd -- '((?:[^']|'\\'')*)' && .+$/.exec(snippet.command);

  return pathMatch?.[1]?.replace(/'\\''/g, "'") ?? '';
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
      isCommandSnippetsCollapsed: true,
      isFavoritePathsCollapsed: false,
      isTabsPanelCollapsed: false,
      tabsPanelHeight: 140,
    };
  }

  try {
    const raw = window.localStorage.getItem(SSH_ACTIVITY_UI_STORAGE_KEY);

    if (!raw) {
      return {
        isCommandSnippetsCollapsed: true,
        isFavoritePathsCollapsed: false,
        isTabsPanelCollapsed: false,
        tabsPanelHeight: 140,
      };
    }

    const parsed = JSON.parse(raw) as Partial<{
      isCommandSnippetsCollapsed: boolean;
      isFavoritePathsCollapsed: boolean;
      isTabsPanelCollapsed: boolean;
      tabsPanelHeight: number;
      version: 1;
    }>;

    if (parsed.version !== 1) {
      return {
        isCommandSnippetsCollapsed: true,
        isFavoritePathsCollapsed: false,
        isTabsPanelCollapsed: false,
        tabsPanelHeight: 140,
      };
    }

    return {
      isCommandSnippetsCollapsed: parsed.isCommandSnippetsCollapsed ?? true,
      isFavoritePathsCollapsed: Boolean(parsed.isFavoritePathsCollapsed),
      isTabsPanelCollapsed: Boolean(parsed.isTabsPanelCollapsed),
      tabsPanelHeight: clampTabsPanelHeight(parsed.tabsPanelHeight ?? 140),
    };
  } catch {
    return {
      isCommandSnippetsCollapsed: true,
      isFavoritePathsCollapsed: false,
      isTabsPanelCollapsed: false,
      tabsPanelHeight: 140,
    };
  }
}

function saveSshActivityUiState(state: {
  isCommandSnippetsCollapsed: boolean;
  isFavoritePathsCollapsed: boolean;
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
