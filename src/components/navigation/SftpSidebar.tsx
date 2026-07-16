import { BookmarkPlus, Folder, UploadCloud, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { requestSftpSidebarReconnect, requestSftpSidebarNavigation, subscribeSftpSidebarPanelStates, type SftpSidebarExplorer, type SftpSidebarPanelState } from '@/features/sftp/sftpSidebarState';
import type { WorkspaceTabItem } from '@/types/workspace';
import { ConnectionStatusDot, formatConnectionStatusLabel, formatRemotePath, formatSftpExplorerTarget, formatTransferSummary, getRemotePathTitle, groupSftpExplorers, loadBooleanPreference, loadSftpBookmarks, saveBooleanPreference, sftpBookmarksStorageKey, sftpShowAllExplorersStorageKey, type SftpBookmark } from './SidebarPanelUtils';
export function SftpSidebar({
  activePanelId,
  explorers,
  onClonePanel,
  onClosePanel,
  onSelectPanel,
}: {
  activePanelId?: string;
  explorers: SftpSidebarExplorer[];
  onClonePanel: (tab: WorkspaceTabItem, path?: string) => void;
  onClosePanel: (panelId: string) => void;
  onSelectPanel: (panelId: string) => void;
}) {
  const [panelStates, setPanelStates] = useState<Record<string, SftpSidebarPanelState>>({});
  const [bookmarks, setBookmarks] = useState<SftpBookmark[]>(() => loadSftpBookmarks());
  const [showAllExplorers, setShowAllExplorers] = useState(() =>
    loadBooleanPreference(sftpShowAllExplorersStorageKey, false),
  );
  const groupedExplorers = useMemo(
    () => groupSftpExplorers(explorers, panelStates),
    [explorers, panelStates],
  );
  const visibleExplorers = showAllExplorers ? groupedExplorers : groupedExplorers.slice(0, 4);
  const activeExplorer = useMemo(
    () => explorers.find((explorer) => panelStates[explorer.panelId]?.status === 'connected') ?? explorers[0],
    [explorers, panelStates],
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

  useEffect(() => subscribeSftpSidebarPanelStates(setPanelStates), []);

  const saveBookmarks = (nextBookmarks: SftpBookmark[]) => {
    setBookmarks(nextBookmarks);
    window.localStorage.setItem(sftpBookmarksStorageKey, JSON.stringify(nextBookmarks));
  };

  const addExplorerBookmark = (explorer: SftpSidebarExplorer) => {
    const path = panelStates[explorer.panelId]?.path;

    if (!path) {
      return;
    }

    const bookmark: SftpBookmark = {
      host: explorer.host,
      id: `${explorer.panelId}:${path}:${Date.now()}`,
      path,
      title: explorer.session?.name ?? panelStates[explorer.panelId]?.title ?? explorer.title,
      username: explorer.username,
    };
    const exists = bookmarks.some(
      (item) => item.path === bookmark.path && item.host === bookmark.host && item.username === bookmark.username,
    );

    if (exists) {
      return;
    }

    saveBookmarks([bookmark, ...bookmarks].slice(0, 24));
  };
  const addCurrentPathBookmark = () => {
    if (activeExplorer) {
      addExplorerBookmark(activeExplorer);
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

  const openBookmark = (bookmark: SftpBookmark) => {
    const target =
      explorers.find(
        (explorer) =>
          explorer.host === bookmark.host &&
          (!bookmark.username || explorer.username === bookmark.username),
      ) ?? activeExplorer;

    if (!target) {
      return;
    }

    onSelectPanel(target.panelId);
    requestSftpSidebarNavigation(target.panelId, bookmark.path);
  };

  const removeBookmark = (bookmarkId: string) => {
    saveBookmarks(bookmarks.filter((bookmark) => bookmark.id !== bookmarkId));
  };
  const toggleShowAllExplorers = () => {
    setShowAllExplorers((current) => {
      const next = !current;

      saveBooleanPreference(sftpShowAllExplorersStorageKey, next);
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Open Explorers</h2>
          <span className="rounded border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            {groupedExplorers.length}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <OverlayScrollArea>
            <div className="grid gap-1 pr-2">
              {groupedExplorers.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-slate-500">
                  Open SFTP from an SSH tab or session.
                </div>
              ) : (
                <>
                  {visibleExplorers.map((explorer) => (
                    <SftpExplorerButton
                      active={explorer.primary.panelId === activePanelId}
                      explorer={explorer.primary}
                      key={explorer.panelId}
                      count={explorer.count}
                      ordinalLabel={explorer.ordinalLabel}
                      onAddBookmark={() => addExplorerBookmark(explorer.primary)}
                      onClone={() => cloneExplorer(explorer.primary)}
                      onClose={() => onClosePanel(explorer.primary.panelId)}
                      onClick={() => onSelectPanel(explorer.primary.panelId)}
                      onCopyPath={() => copyRemotePath(explorer.state?.path)}
                      onReconnect={() => requestSftpSidebarReconnect(explorer.primary.panelId)}
                      state={explorer.state}
                    />
                  ))}
                  {groupedExplorers.length > 4 && (
                    <button
                      className="rounded-md border border-border/70 px-3 py-1.5 text-left text-xs text-muted-foreground hover:border-primary/40 hover:bg-accent hover:text-foreground"
                      type="button"
                      onClick={toggleShowAllExplorers}
                    >
                      {showAllExplorers ? 'Show fewer explorers' : `Show ${groupedExplorers.length - 4} more explorers`}
                    </button>
                  )}
                </>
              )}
            </div>
          </OverlayScrollArea>
        </div>
      </section>

      <button
        className="flex w-full items-center justify-between gap-2 rounded-md border border-border/80 bg-background/35 px-3 py-2 text-left hover:border-primary/40 hover:bg-accent"
        type="button"
        onClick={() => onSelectPanel('sftp-transfer-queue')}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <UploadCloud className="size-4 text-primary" />
            Transfer Queue
          </div>
          <span
            className={[
              'rounded border px-1.5 py-0.5 font-mono text-[10px]',
              transferSummary.failed > 0
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-border/80 text-muted-foreground',
            ].join(' ')}
          >
            {formatTransferSummary(transferSummary)}
          </span>
        </div>
      </button>

      <section className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Remote Bookmarks</h2>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            title="Add current path"
            aria-label="Add current path"
            disabled={!activeExplorer || !panelStates[activeExplorer.panelId]?.path}
            onClick={addCurrentPathBookmark}
          >
            <BookmarkPlus className="size-4" />
            Current
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <OverlayScrollArea>
            <div className="grid gap-1 pr-2">
              {bookmarks.length === 0 ? (
                <div className="rounded-md border border-dashed border-border/80 px-3 py-4 text-xs text-slate-500">
                  Add a remote path from an open SFTP explorer.
                </div>
              ) : (
                bookmarks.map((bookmark) => (
                  <ContextMenu key={bookmark.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded px-2 py-1.5 hover:bg-accent"
                      >
                        <button
                          className="grid min-w-0 gap-0.5 text-left text-xs"
                          type="button"
                          title="Double-click to open this remote path"
                          onDoubleClick={() => openBookmark(bookmark)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              openBookmark(bookmark);
                            }
                          }}
                        >
                          <span className="truncate text-xs font-semibold text-foreground">
                            {getRemotePathTitle(bookmark.path)}
                          </span>
                          <span className="truncate font-mono text-[10px] text-muted-foreground/90">
                            {formatSftpExplorerTarget(bookmark)}
                          </span>
                          <span className="truncate font-mono text-[10px] text-slate-500/80">
                            {formatRemotePath(bookmark.path)}
                          </span>
                        </button>
                        <button
                          className="grid size-5 place-items-center rounded text-slate-500 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                          type="button"
                          title="Remove bookmark"
                          aria-label="Remove bookmark"
                          onClick={() => removeBookmark(bookmark.id)}
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuLabel>{getRemotePathTitle(bookmark.path)}</ContextMenuLabel>
                      <ContextMenuItem onSelect={() => openBookmark(bookmark)}>Open</ContextMenuItem>
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
                ))
              )}
            </div>
          </OverlayScrollArea>
        </div>
      </section>
    </div>
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={[
            'group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-1 rounded px-2 py-1.5',
            active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent',
          ].join(' ')}
        >
          <button
            className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-left"
            type="button"
            onClick={onClick}
          >
            <Folder className="mt-0.5 size-3.5 text-primary" />
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-xs font-semibold">
                {ordinalLabel} · {pathTitle}
              </span>
              <span className="truncate font-mono text-[10px] text-muted-foreground/90">
                {formatSftpExplorerTarget(explorer)}
              </span>
              <span className="truncate font-mono text-[10px] text-slate-500/80">
                {formatRemotePath(path)}
              </span>
            </span>
          </button>
          <span className="flex items-center gap-1">
            {count > 1 && (
              <span className="rounded border border-border/60 px-1 font-mono text-[10px] text-slate-500">
                {count}
              </span>
            )}
            <span
              className={[
                'size-2 rounded-full',
                state?.status === 'connected'
                  ? 'bg-emerald-400'
                  : state?.status === 'connecting'
                    ? 'bg-sky-400'
                    : state?.status === 'failed'
                      ? 'bg-destructive'
                      : 'bg-slate-600',
              ].join(' ')}
              title={state?.status ?? 'restored'}
            />
            <button
              className="grid size-5 place-items-center rounded text-slate-500 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
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
      <ContextMenuContent>
        <ContextMenuLabel>{ordinalLabel} · {pathTitle}</ContextMenuLabel>
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
