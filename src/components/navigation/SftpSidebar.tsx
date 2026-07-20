import { ChevronDown, ChevronUp, FolderOpen, Plus, UploadCloud, X } from 'lucide-react';
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Button } from '@/components/ui/button';
import { InlineSectionStatus } from '@/components/navigation/InlineSectionStatus';
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
  getSftpSidebarPanelStates,
  requestSftpSidebarLocalNavigation,
  requestSftpSidebarNavigation,
  requestSftpSidebarReconnect,
  subscribeSftpSidebarBookmark,
  subscribeSftpSidebarLocalFavorite,
  subscribeSftpSidebarPanelStates,
  type SftpSidebarExplorer,
  type SftpSidebarPanelState,
} from '@/features/sftp/sftpSidebarState';
import { formatLocalDisplayPath } from '@/features/sftp/sftpCommanderUtils';
import { useTransientStatus } from '@/hooks/useTransientStatus';
import { matchesSearchText } from '@/lib/searchText';
import type { WorkspaceTabItem } from '@/types/workspace';
import {
  ConnectionStatusDot,
  formatRemotePath,
  formatSftpExplorerTarget,
  formatTransferSummary,
  getRemotePathTitle,
  groupSftpExplorers,
  loadSftpBookmarks,
  sftpBookmarksStorageKey,
  type SftpBookmark,
} from './SidebarPanelUtils';

const SFTP_ACTIVITY_UI_STORAGE_KEY = 'shellpilot.sftp.activity.ui.v1';
const SFTP_LOCAL_FAVORITES_STORAGE_KEY = 'shellpilot:sftp-local-favorites';
const MIN_TABS_PANEL_HEIGHT = 96;
const MAX_TABS_PANEL_HEIGHT = 260;
const COLLAPSED_TABS_PANEL_HEIGHT = 34;

interface SftpLocalFavorite {
  id: string;
  label: string;
  path: string;
}

export function SftpSidebar({
  activePanelId,
  explorers,
  onClonePanel,
  onClosePanel,
  onOpenTransferQueue,
  onSelectPanel,
}: {
  activePanelId?: string;
  explorers: SftpSidebarExplorer[];
  onClonePanel: (tab: WorkspaceTabItem, path?: string) => void;
  onClosePanel: (panelId: string) => void;
  onOpenTransferQueue: () => void;
  onSelectPanel: (panelId: string) => void;
}) {
  const [panelStates, setPanelStates] = useState<Record<string, SftpSidebarPanelState>>(
    () => getSftpSidebarPanelStates(),
  );
  const [bookmarks, setBookmarks] = useState<SftpBookmark[]>(() => loadSftpBookmarks());
  const [localFavorites, setLocalFavorites] = useState<SftpLocalFavorite[]>(() => loadSftpLocalFavorites());
  const [bookmarkSearchInput, setBookmarkSearchInput] = useState('');
  const [localFavoriteSearchInput, setLocalFavoriteSearchInput] = useState('');
  const [editingBookmark, setEditingBookmark] = useState<SftpBookmark>();
  const [editingLocalFavorite, setEditingLocalFavorite] = useState<SftpLocalFavorite>();
  const {
    clearStatus: clearBookmarkStatus,
    showTransientStatus: showTransientBookmarkStatus,
    statusText: bookmarkStatusText,
  } = useTransientStatus();
  const {
    clearStatus: clearLocalFavoriteStatus,
    showTransientStatus: showTransientLocalFavoriteStatus,
    statusText: localFavoriteStatusText,
  } = useTransientStatus();
  const [tabsPanelState, setTabsPanelState] = useState(() => loadSftpActivityUiState());
  const groupedExplorers = useMemo(
    () => groupSftpExplorers(explorers, panelStates),
    [explorers, panelStates],
  );
  const connectedExplorer = useMemo(
    () =>
      explorers.find(
        (explorer) =>
          explorer.panelId === activePanelId &&
          panelStates[explorer.panelId]?.status === 'connected',
      ) ??
      explorers.find((explorer) => panelStates[explorer.panelId]?.status === 'connected'),
    [activePanelId, explorers, panelStates],
  );
  const transferSummary = useMemo(
    () =>
      explorers.reduce(
        (summary, explorer) => {
          const next = panelStates[explorer.panelId]?.transferSummary;

          if (!next) {
            return summary;
          }

          return {
            canceled: summary.canceled + next.canceled,
            completed: summary.completed + next.completed,
            failed: summary.failed + next.failed,
            running: summary.running + next.running,
            total: summary.total + next.total,
          };
        },
        { canceled: 0, completed: 0, failed: 0, running: 0, total: 0 },
      ),
    [explorers, panelStates],
  );
  const serverBookmarks = useMemo(
    () =>
      connectedExplorer
        ? bookmarks.filter((bookmark) => isSameSftpTarget(bookmark, connectedExplorer))
        : [],
    [bookmarks, connectedExplorer],
  );
  const filteredServerBookmarks = useMemo(
    () =>
      serverBookmarks.filter((bookmark) =>
        matchesSearchText(bookmarkSearchInput, bookmark.title, bookmark.path),
      ),
    [bookmarkSearchInput, serverBookmarks],
  );
  const filteredLocalFavorites = useMemo(
    () =>
      localFavorites.filter((favorite) =>
        matchesSearchText(localFavoriteSearchInput, favorite.label, favorite.path),
      ),
    [localFavoriteSearchInput, localFavorites],
  );
  const connectedPanelState = connectedExplorer ? panelStates[connectedExplorer.panelId] : undefined;
  const showLocalFavorites = connectedPanelState?.viewMode === 'commander';
  const showEmptyState = useDelayedEmptyState(!connectedExplorer);

  useEffect(() => subscribeSftpSidebarPanelStates(setPanelStates), []);
  useEffect(() => {
    saveSftpActivityUiState(tabsPanelState);
  }, [tabsPanelState]);
  useEffect(() => {
    setBookmarkSearchInput('');
    setLocalFavoriteSearchInput('');
    setEditingBookmark(undefined);
    setEditingLocalFavorite(undefined);
    clearBookmarkStatus();
    clearLocalFavoriteStatus();
  }, [clearBookmarkStatus, clearLocalFavoriteStatus, connectedExplorer?.panelId]);

  const saveBookmarks = (nextBookmarks: SftpBookmark[]) => {
    setBookmarks(nextBookmarks);
    window.localStorage.setItem(sftpBookmarksStorageKey, JSON.stringify(nextBookmarks));
  };
  const saveLocalFavorites = (nextFavorites: SftpLocalFavorite[]) => {
    setLocalFavorites(nextFavorites);
    window.localStorage.setItem(SFTP_LOCAL_FAVORITES_STORAGE_KEY, JSON.stringify(nextFavorites));
  };

  const addExplorerBookmark = (
    explorer: SftpSidebarExplorer,
    options: { label?: string; path?: string } = {},
  ) => {
    const latestPanelStates = getSftpSidebarPanelStates();
    const explorerState = latestPanelStates[explorer.panelId] ?? panelStates[explorer.panelId];
    const typedPath = normalizeRemoteBookmarkPath(options.path);
    const path = typedPath || normalizeRemoteBookmarkPath(explorerState?.path);

    if (!path) {
      showTransientBookmarkStatus('Current path unavailable');
      return false;
    }

    const bookmark: SftpBookmark = {
      host: explorer.host,
      id: `${explorer.panelId}:${path}:${Date.now()}`,
      path,
      port: explorer.port,
      title: options.label?.trim() || getRemotePathTitle(path),
      username: explorer.username,
    };
    const exists = bookmarks.some(
      (item) =>
        item.path === bookmark.path &&
        item.host === bookmark.host &&
        getSftpEndpointPort(item.port) === getSftpEndpointPort(bookmark.port) &&
        (item.username ?? '') === (bookmark.username ?? ''),
    );

    if (exists) {
      showTransientBookmarkStatus('Bookmark already exists');
      return false;
    }

    setPanelStates(latestPanelStates);
    clearBookmarkStatus();
    saveBookmarks([bookmark, ...bookmarks].slice(0, 24));
    return true;
  };
  const addConnectedBookmark = (options: { path?: string } = {}) => {
    if (!connectedExplorer) {
      return;
    }

    const didAdd = addExplorerBookmark(connectedExplorer, {
      path: options.path,
    });

    if (!didAdd) {
      return;
    }
  };
  const cloneExplorer = (explorer: SftpSidebarExplorer) => {
    if (!explorer.session) {
      return;
    }

    onClonePanel(
      {
        id: explorer.panelId,
        session: explorer.session,
        title: explorer.title,
        type: 'sftp',
      },
      panelStates[explorer.panelId]?.path,
    );
  };
  const copyRemotePath = (path?: string) => {
    if (path) {
      void navigator.clipboard?.writeText(path);
    }
  };
  const copyLocalPath = (path?: string) => {
    if (path) {
      void navigator.clipboard?.writeText(path);
    }
  };

  const openBookmark = (bookmark: SftpBookmark) => {
    if (!connectedExplorer) {
      return;
    }

    onSelectPanel(connectedExplorer.panelId);
    requestSftpSidebarNavigation(connectedExplorer.panelId, bookmark.path);
  };
  const openLocalFavorite = (favorite: SftpLocalFavorite) => {
    if (!connectedExplorer) {
      return;
    }

    onSelectPanel(connectedExplorer.panelId);
    requestSftpSidebarLocalNavigation(connectedExplorer.panelId, favorite.path);
  };

  const removeBookmark = (bookmarkId: string) => {
    saveBookmarks(bookmarks.filter((bookmark) => bookmark.id !== bookmarkId));
  };
  const updateBookmark = (bookmark: SftpBookmark) => {
    const path = normalizeRemoteBookmarkPath(bookmark.path);

    if (!path) {
      showTransientBookmarkStatus('Path is required');
      return;
    }

    clearBookmarkStatus();
    saveBookmarks(
      bookmarks.map((item) =>
        item.id === bookmark.id
          ? {
              ...item,
              path,
              title: bookmark.title.trim() || getRemotePathTitle(path),
            }
          : item,
      ),
    );
    setEditingBookmark(undefined);
  };
  const addLocalFavorite = (options: { path?: string } = {}) => {
    const path = normalizeLocalFavoritePath(options.path) ||
      normalizeLocalFavoritePath(connectedPanelState?.localPath);

    if (!path) {
      showTransientLocalFavoriteStatus('Local path unavailable');
      return;
    }

    if (localFavorites.some((favorite) => favorite.path === path)) {
      showTransientLocalFavoriteStatus('Local favorite already exists');
      return;
    }

    clearLocalFavoriteStatus();
    saveLocalFavorites([
      {
        id: `local:${path}:${Date.now()}`,
        label: getLocalPathTitle(path),
        path,
      },
      ...localFavorites,
    ].slice(0, 24));
  };
  const removeLocalFavorite = (favoriteId: string) => {
    saveLocalFavorites(localFavorites.filter((favorite) => favorite.id !== favoriteId));
  };
  const updateLocalFavorite = (favorite: SftpLocalFavorite) => {
    const path = normalizeLocalFavoritePath(favorite.path);

    if (!path) {
      showTransientLocalFavoriteStatus('Path is required');
      return;
    }

    clearLocalFavoriteStatus();
    saveLocalFavorites(
      localFavorites.map((item) =>
        item.id === favorite.id
          ? {
              ...item,
              label: favorite.label.trim() || getLocalPathTitle(path),
              path,
            }
          : item,
      ),
    );
    setEditingLocalFavorite(undefined);
  };
  useEffect(() => subscribeSftpSidebarBookmark(({ panelId, path }) => {
    const explorer = explorers.find((item) => item.panelId === panelId);

    if (!explorer) {
      return;
    }

    addExplorerBookmark(explorer, { path });
  }), [addExplorerBookmark, explorers]);
  useEffect(() => subscribeSftpSidebarLocalFavorite(({ panelId, path }) => {
    if (!explorers.some((item) => item.panelId === panelId)) {
      return;
    }

    addLocalFavorite({ path });
  }), [addLocalFavorite, explorers]);

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      {connectedExplorer ? (
        <div className="rounded-lg border border-border/70 bg-slate-950/35 p-3">
          <div className="flex min-w-0 items-start gap-2">
            <FolderOpen className="mt-0.5 size-4 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {connectedExplorer.session?.name ?? connectedExplorer.title}
              </p>
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {formatSftpExplorerTarget(connectedExplorer)}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {connectedExplorer ? (
        <section
          className={[
            'min-h-0 overflow-hidden rounded-lg border border-border/70 bg-card/50',
            tabsPanelState.isRemoteBookmarksCollapsed ? 'shrink-0' : 'flex flex-1 flex-col',
          ].join(' ')}
        >
          <button
            className="flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-accent/60"
            type="button"
            onClick={() =>
              setTabsPanelState((current) => ({
                ...current,
                isRemoteBookmarksCollapsed: !current.isRemoteBookmarksCollapsed,
              }))
            }
          >
            <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Remote Bookmarks
            </span>
            <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {bookmarkSearchInput.trim()
                ? `${filteredServerBookmarks.length}/${serverBookmarks.length}`
                : serverBookmarks.length}
            </span>
            {tabsPanelState.isRemoteBookmarksCollapsed ? (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronUp className="size-3.5 text-muted-foreground" />
            )}
          </button>
          {!tabsPanelState.isRemoteBookmarksCollapsed && (
            <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-2 px-3 pb-3">
              <div className="grid gap-2">
                <div className="grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1.5">
                  <input
                    className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                    placeholder="Search bookmarks"
                    value={bookmarkSearchInput}
                    onChange={(event) => setBookmarkSearchInput(event.target.value)}
                  />
                  <Button
                    className="h-8 w-7 px-0"
                    disabled={!panelStates[connectedExplorer.panelId]?.path}
                    size="icon"
                    type="button"
                    onClick={() => addConnectedBookmark()}
                    aria-label="Save current SFTP path"
                    title="Save current path"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <InlineSectionStatus message={bookmarkStatusText} />
              </div>
              <OverlayScrollArea containerClassName="min-h-0">
                <div className="grid gap-2">
                  {serverBookmarks.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                      Save frequently used remote paths for this server here.
                    </div>
                  ) : filteredServerBookmarks.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                      No remote bookmarks match this search.
                    </div>
                  ) : (
                    filteredServerBookmarks.map((bookmark) =>
                      editingBookmark?.id === bookmark.id ? (
                        <div className="grid gap-2 rounded-md border border-primary/40 bg-background/50 p-2" key={bookmark.id}>
                          <input
                            className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                            value={editingBookmark.title}
                            onChange={(event) => setEditingBookmark({ ...editingBookmark, title: event.target.value })}
                          />
                          <input
                            className="h-8 rounded border border-input bg-background/70 px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                            value={editingBookmark.path}
                            onChange={(event) => setEditingBookmark({ ...editingBookmark, path: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                updateBookmark(editingBookmark);
                              }
                              if (event.key === 'Escape') {
                                setEditingBookmark(undefined);
                              }
                            }}
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button className="h-7 px-2 text-xs" size="sm" variant="ghost" type="button" onClick={() => setEditingBookmark(undefined)}>
                              Cancel
                            </Button>
                            <Button className="h-7 px-2 text-xs" size="sm" type="button" onClick={() => updateBookmark(editingBookmark)}>
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <ContextMenu key={bookmark.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              className="group grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-1 rounded border border-border/60 bg-background/35 px-1.5 py-1 shadow-[inset_2px_0_0_hsl(var(--primary)_/_0.35)] transition-colors hover:border-primary/35 hover:bg-accent/35"
                            >
                              <button
                                className="flex h-6 min-w-0 items-center text-left"
                                type="button"
                                title={formatRemotePath(bookmark.path)}
                                onDoubleClick={() => setEditingBookmark(bookmark)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    openBookmark(bookmark);
                                  }
                                }}
                              >
                                <span className="block truncate text-[11px] font-semibold text-foreground" title={bookmark.title}>
                                  {bookmark.title}
                                </span>
                              </button>
                              <button
                                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                type="button"
                                title="Open bookmark"
                                aria-label="Open bookmark"
                                onClick={() => openBookmark(bookmark)}
                              >
                                <FolderOpen className="size-3" />
                              </button>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="max-w-64">
                            <ContextMenuLabel className="truncate" title={bookmark.title}>
                              {bookmark.title}
                            </ContextMenuLabel>
                            <ContextMenuItem onSelect={() => openBookmark(bookmark)}>Open</ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEditingBookmark(bookmark)}>Edit</ContextMenuItem>
                            <ContextMenuItem onSelect={() => copyRemotePath(bookmark.path)}>Copy Path</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => removeBookmark(bookmark.id)}
                            >
                              Remove Bookmark
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ),
                    )
                  )}
                </div>
              </OverlayScrollArea>
            </div>
          )}
        </section>
      ) : showEmptyState ? (
        <EmptySftpState />
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      {connectedExplorer && showLocalFavorites && (
        <section
          className={[
            'min-h-0 overflow-hidden rounded-lg border border-border/70 bg-card/50',
            tabsPanelState.isLocalFavoritesCollapsed ? 'shrink-0' : 'flex flex-1 flex-col',
          ].join(' ')}
        >
          <button
            className="flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-accent/60"
            type="button"
            onClick={() =>
              setTabsPanelState((current) => ({
                ...current,
                isLocalFavoritesCollapsed: !current.isLocalFavoritesCollapsed,
              }))
            }
          >
            <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Local Favorites
            </span>
            <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {localFavoriteSearchInput.trim()
                ? `${filteredLocalFavorites.length}/${localFavorites.length}`
                : localFavorites.length}
            </span>
            {tabsPanelState.isLocalFavoritesCollapsed ? (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronUp className="size-3.5 text-muted-foreground" />
            )}
          </button>
          {!tabsPanelState.isLocalFavoritesCollapsed && (
            <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-2 px-3 pb-3">
              <div className="grid gap-2">
                <div className="grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1.5">
                  <input
                    className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                    placeholder="Search local favorites"
                    value={localFavoriteSearchInput}
                    onChange={(event) => setLocalFavoriteSearchInput(event.target.value)}
                  />
                  <Button
                    className="h-8 w-7 px-0"
                    disabled={!connectedPanelState?.localPath}
                    size="icon"
                    type="button"
                    onClick={() => addLocalFavorite()}
                    aria-label="Save current local path"
                    title="Save current local path"
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <InlineSectionStatus message={localFavoriteStatusText} />
              </div>
              <OverlayScrollArea containerClassName="min-h-0">
                <div className="grid gap-2">
                  {localFavorites.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                      Save frequently used local directories for Commander mode here.
                    </div>
                  ) : filteredLocalFavorites.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-muted-foreground">
                      No local favorites match this search.
                    </div>
                  ) : (
                    filteredLocalFavorites.map((favorite) =>
                      editingLocalFavorite?.id === favorite.id ? (
                        <div className="grid gap-2 rounded-md border border-primary/40 bg-background/50 p-2" key={favorite.id}>
                          <input
                            className="h-8 rounded border border-input bg-background/70 px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                            value={editingLocalFavorite.label}
                            onChange={(event) => setEditingLocalFavorite({ ...editingLocalFavorite, label: event.target.value })}
                          />
                          <input
                            className="h-8 rounded border border-input bg-background/70 px-2 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
                            value={editingLocalFavorite.path}
                            onChange={(event) => setEditingLocalFavorite({ ...editingLocalFavorite, path: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                updateLocalFavorite(editingLocalFavorite);
                              }
                              if (event.key === 'Escape') {
                                setEditingLocalFavorite(undefined);
                              }
                            }}
                          />
                          <div className="flex justify-end gap-1.5">
                            <Button className="h-7 px-2 text-xs" size="sm" variant="ghost" type="button" onClick={() => setEditingLocalFavorite(undefined)}>
                              Cancel
                            </Button>
                            <Button className="h-7 px-2 text-xs" size="sm" type="button" onClick={() => updateLocalFavorite(editingLocalFavorite)}>
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <ContextMenu key={favorite.id}>
                          <ContextMenuTrigger asChild>
                            <div className="group grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-1 rounded border border-border/60 bg-background/35 px-1.5 py-1 shadow-[inset_2px_0_0_hsl(var(--primary)_/_0.35)] transition-colors hover:border-primary/35 hover:bg-accent/35">
                              <button
                                className="flex h-6 min-w-0 items-center text-left"
                                type="button"
                                title={formatLocalDisplayPath(favorite.path)}
                                onDoubleClick={() => setEditingLocalFavorite(favorite)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    openLocalFavorite(favorite);
                                  }
                                }}
                              >
                                <span className="block truncate text-[11px] font-semibold text-foreground" title={favorite.label}>
                                  {favorite.label}
                                </span>
                              </button>
                              <button
                                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                                type="button"
                                title="Open local favorite"
                                aria-label="Open local favorite"
                                onClick={() => openLocalFavorite(favorite)}
                              >
                                <FolderOpen className="size-3" />
                              </button>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="max-w-64">
                            <ContextMenuLabel className="truncate" title={favorite.label}>
                              {favorite.label}
                            </ContextMenuLabel>
                            <ContextMenuItem onSelect={() => openLocalFavorite(favorite)}>Open</ContextMenuItem>
                            <ContextMenuItem onSelect={() => setEditingLocalFavorite(favorite)}>Edit</ContextMenuItem>
                            <ContextMenuItem onSelect={() => copyLocalPath(favorite.path)}>Copy Path</ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => removeLocalFavorite(favorite.id)}
                            >
                              Remove Favorite
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ),
                    )
                  )}
                </div>
              </OverlayScrollArea>
            </div>
          )}
        </section>
      )}

      <TransferQueueButton
        onClick={onOpenTransferQueue}
        transferSummary={transferSummary}
      />

      <SftpTabsPanel
        activePanelId={activePanelId}
        explorers={groupedExplorers}
        isCollapsed={tabsPanelState.isTabsPanelCollapsed}
        onAddBookmark={addExplorerBookmark}
        onClone={cloneExplorer}
        onClosePanel={onClosePanel}
        onCopyPath={copyRemotePath}
        onResize={(height) => setTabsPanelState((current) => ({ ...current, tabsPanelHeight: height }))}
        onSelectPanel={onSelectPanel}
        onToggleCollapsed={() =>
          setTabsPanelState((current) => ({
            ...current,
            isTabsPanelCollapsed: !current.isTabsPanelCollapsed,
          }))
        }
        panelHeight={tabsPanelState.tabsPanelHeight}
      />
    </section>
  );
}

function isSameSftpTarget(bookmark: SftpBookmark, explorer: SftpSidebarExplorer) {
  return (
    bookmark.host === explorer.host &&
    getSftpEndpointPort(bookmark.port) === getSftpEndpointPort(explorer.port) &&
    (bookmark.username ?? '') === (explorer.username ?? '')
  );
}

function getSftpEndpointPort(port?: number) {
  return port ?? 22;
}

function normalizeRemoteBookmarkPath(path?: string) {
  return path?.trim() ?? '';
}

function loadSftpLocalFavorites(): SftpLocalFavorite[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(SFTP_LOCAL_FAVORITES_STORAGE_KEY) ?? '[]');

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isSftpLocalFavorite);
  } catch {
    return [];
  }
}

function isSftpLocalFavorite(value: unknown): value is SftpLocalFavorite {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'id' in value &&
      'label' in value &&
      'path' in value &&
      typeof (value as SftpLocalFavorite).id === 'string' &&
      typeof (value as SftpLocalFavorite).label === 'string' &&
      typeof (value as SftpLocalFavorite).path === 'string',
  );
}

function normalizeLocalFavoritePath(path?: string) {
  return path ? formatLocalDisplayPath(path.trim()) : '';
}

function getLocalPathTitle(path: string) {
  const normalizedPath = path.replace(/[\\/]+$/, '');
  const parts = normalizedPath.split(/[\\/]+/).filter(Boolean);

  return parts[parts.length - 1] || normalizedPath || path;
}

function EmptySftpState() {
  return (
    <div className="min-h-0 flex-1">
      <div className="rounded-lg border border-dashed border-border/80 px-3 py-5 text-xs text-muted-foreground">
        Open or reconnect an SFTP explorer to manage remote bookmarks.
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

function TransferQueueButton({
  onClick,
  transferSummary,
}: {
  onClick: () => void;
  transferSummary: {
    canceled: number;
    completed: number;
    failed: number;
    running: number;
    total: number;
  };
}) {
  return (
    <button
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent"
      type="button"
      onClick={onClick}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground">
        <UploadCloud className="size-4 shrink-0 text-primary" />
        <span className="truncate">Transfer Queue</span>
      </div>
      <span
        className={[
          'shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]',
          transferSummary.failed > 0
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-border/80 text-muted-foreground',
        ].join(' ')}
      >
        {formatTransferSummary(transferSummary)}
      </span>
    </button>
  );
}

function SftpTabsPanel({
  activePanelId,
  explorers,
  isCollapsed,
  onAddBookmark,
  onClone,
  onClosePanel,
  onCopyPath,
  onResize,
  onSelectPanel,
  onToggleCollapsed,
  panelHeight,
}: {
  activePanelId?: string;
  explorers: ReturnType<typeof groupSftpExplorers>;
  isCollapsed: boolean;
  onAddBookmark: (explorer: SftpSidebarExplorer) => void;
  onClone: (explorer: SftpSidebarExplorer) => void;
  onClosePanel: (panelId: string) => void;
  onCopyPath: (path?: string) => void;
  onResize: (height: number) => void;
  onSelectPanel: (panelId: string) => void;
  onToggleCollapsed: () => void;
  panelHeight: number;
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
      aria-label="SFTP tabs"
    >
      {!isCollapsed && (
        <div
          className="h-2 cursor-ns-resize border-b border-slate-800/70 bg-slate-900/70 hover:bg-teal-500/30"
          role="separator"
          aria-orientation="horizontal"
          title="Resize SFTP tabs"
          onPointerDown={startResize}
        />
      )}
      <div className="flex h-8 items-center gap-2 border-b border-slate-800 px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          SFTP Tabs
        </span>
        <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {explorers.length}
        </span>
        <button
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-slate-800 hover:text-foreground"
          type="button"
          aria-label={isCollapsed ? 'Expand SFTP tabs' : 'Collapse SFTP tabs'}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          onClick={onToggleCollapsed}
        >
          {isCollapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>
      {!isCollapsed && (
        <OverlayScrollArea className="p-2" containerClassName="h-[calc(100%-2.375rem)]">
          {explorers.length === 0 ? (
            <div className="grid h-full place-items-center rounded border border-dashed border-slate-800 px-3 text-center text-xs text-muted-foreground">
              Open SFTP explorers will appear here.
            </div>
          ) : (
            <div className="grid gap-1">
              {explorers.map((explorer) => (
                <SftpExplorerButton
                  active={explorer.primary.panelId === activePanelId}
                  explorer={explorer.primary}
                  key={explorer.panelId}
                  count={explorer.count}
                  ordinalLabel={explorer.ordinalLabel}
                  onAddBookmark={() => onAddBookmark(explorer.primary)}
                  onClone={() => onClone(explorer.primary)}
                  onClose={() => onClosePanel(explorer.primary.panelId)}
                  onClick={() => onSelectPanel(explorer.primary.panelId)}
                  onCopyPath={() => onCopyPath(explorer.state?.path)}
                  onReconnect={() => requestSftpSidebarReconnect(explorer.primary.panelId)}
                  state={explorer.state}
                />
              ))}
            </div>
          )}
        </OverlayScrollArea>
      )}
    </section>
  );
}

function SftpExplorerButton({
  active,
  count,
  explorer,
  onAddBookmark,
  onClone,
  onClick,
  onClose,
  onCopyPath,
  onReconnect,
  ordinalLabel,
  state,
}: {
  active: boolean;
  count: number;
  explorer: SftpSidebarExplorer;
  onAddBookmark: () => void;
  onClone: () => void;
  onClick: () => void;
  onClose: () => void;
  onCopyPath: () => void;
  onReconnect: () => void;
  ordinalLabel: string;
  state?: SftpSidebarPanelState;
}) {
  const path = state?.path ?? 'Home';
  const pathTitle = getRemotePathTitle(path);
  const targetLabel = formatSftpExplorerTarget(explorer);
  const formattedPath = formatRemotePath(path);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={[
            'group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded-md px-2 py-1.5 transition-colors',
            active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          ].join(' ')}
        >
          <button className="grid min-w-0 gap-0.5 text-left" type="button" onClick={onClick}>
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-xs font-semibold" title={`${ordinalLabel} · ${pathTitle}`}>
                {ordinalLabel} · {pathTitle}
              </span>
              <span className="truncate font-mono text-[10px] text-muted-foreground/90" title={targetLabel}>
                {targetLabel}
              </span>
              <span className="truncate font-mono text-[10px] text-muted-foreground" title={formattedPath}>
                {formattedPath}
              </span>
            </span>
          </button>
          <span className="flex items-center gap-1">
            {count > 1 && (
              <span className="rounded border border-border/60 px-1 font-mono text-[10px] text-slate-500">
                {count}
              </span>
            )}
            <ConnectionStatusDot status={state?.status ?? 'restored'} />
            <button
              className="grid size-5 place-items-center rounded text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
              type="button"
              title="Close SFTP tab"
              aria-label="Close SFTP tab"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="max-w-64">
        <ContextMenuLabel className="truncate" title={`${ordinalLabel} · ${pathTitle}`}>
          {ordinalLabel} · {pathTitle}
        </ContextMenuLabel>
        <ContextMenuItem onSelect={onClick}>Open</ContextMenuItem>
        <ContextMenuItem onSelect={onReconnect}>Reconnect</ContextMenuItem>
        <ContextMenuItem disabled={!explorer.session} onSelect={onClone}>
          Clone Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!state?.path} onSelect={onAddBookmark}>
          Add Bookmark
        </ContextMenuItem>
        <ContextMenuItem disabled={!state?.path} onSelect={onCopyPath}>
          Copy Path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={onClose}>
          Close
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function loadSftpActivityUiState() {
  if (typeof window === 'undefined') {
    return {
      isLocalFavoritesCollapsed: false,
      isRemoteBookmarksCollapsed: false,
      isTabsPanelCollapsed: false,
      tabsPanelHeight: 140,
    };
  }

  try {
    const raw = window.localStorage.getItem(SFTP_ACTIVITY_UI_STORAGE_KEY);

    if (!raw) {
      return {
        isLocalFavoritesCollapsed: false,
        isRemoteBookmarksCollapsed: false,
        isTabsPanelCollapsed: false,
        tabsPanelHeight: 140,
      };
    }

    const parsed = JSON.parse(raw) as Partial<{
      isLocalFavoritesCollapsed: boolean;
      isRemoteBookmarksCollapsed: boolean;
      isTabsPanelCollapsed: boolean;
      tabsPanelHeight: number;
      version: 1;
    }>;

    if (parsed.version !== 1) {
      return {
        isLocalFavoritesCollapsed: false,
        isRemoteBookmarksCollapsed: false,
        isTabsPanelCollapsed: false,
        tabsPanelHeight: 140,
      };
    }

    return {
      isLocalFavoritesCollapsed: Boolean(parsed.isLocalFavoritesCollapsed),
      isRemoteBookmarksCollapsed: Boolean(parsed.isRemoteBookmarksCollapsed),
      isTabsPanelCollapsed: Boolean(parsed.isTabsPanelCollapsed),
      tabsPanelHeight: clampTabsPanelHeight(parsed.tabsPanelHeight ?? 140),
    };
  } catch {
    return {
      isLocalFavoritesCollapsed: false,
      isRemoteBookmarksCollapsed: false,
      isTabsPanelCollapsed: false,
      tabsPanelHeight: 140,
    };
  }
}

function saveSftpActivityUiState(state: {
  isLocalFavoritesCollapsed: boolean;
  isRemoteBookmarksCollapsed: boolean;
  isTabsPanelCollapsed: boolean;
  tabsPanelHeight: number;
}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    SFTP_ACTIVITY_UI_STORAGE_KEY,
    JSON.stringify({
      ...state,
      version: 1,
    }),
  );
}

function clampTabsPanelHeight(height: number) {
  return Math.min(MAX_TABS_PANEL_HEIGHT, Math.max(MIN_TABS_PANEL_HEIGHT, Math.round(height)));
}
