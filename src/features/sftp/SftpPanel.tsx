import { Folder, FolderOpen, RefreshCcw, Server, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { SessionItem } from '@/types/workspace';
import {
  closeSftpSession,
  listSftpDirectory,
  openSftpSession,
  type SftpEntry,
} from './sftpBridge';

export function SftpPanel({ panelId, session }: { panelId: string; session: SessionItem }) {
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [path, setPath] = useState('.');

  const loadDirectory = async (nextPath = path) => {
    setIsLoading(true);
    setError(undefined);

    try {
      const result = await listSftpDirectory(panelId, nextPath);

      setPath(result.path);
      setEntries(result.entries);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    let disposed = false;

    const open = async () => {
      setIsLoading(true);
      setError(undefined);

      try {
        await openSftpSession(panelId, session);
        if (!disposed) {
          await loadDirectory('.');
        }
      } catch (error) {
        if (!disposed) {
          setError(error instanceof Error ? error.message : String(error));
          setIsLoading(false);
        }
      }
    };

    void open();

    return () => {
      disposed = true;
      void closeSftpSession(panelId);
    };
  }, [panelId, session]);

  const openEntry = (entry: SftpEntry) => {
    void loadDirectory(entry.path);
  };
  const goParent = () => {
    if (path === '.' || path === '/') {
      return;
    }

    const parts = path.split('/').filter(Boolean);

    if (parts.length <= 1) {
      void loadDirectory('/');
      return;
    }

    void loadDirectory(`/${parts.slice(0, -1).join('/')}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[hsl(var(--workspace-terminal))] text-sm text-slate-100">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <Server className="size-4 text-primary" />
        <div className="min-w-0 flex-1 truncate font-medium">
          {session.username ? `${session.username}@` : ''}{session.host}
        </div>
        <Button size="sm" variant="secondary" type="button" onClick={goParent} disabled={isLoading || path === '.' || path === '/'}>
          <FolderOpen className="size-3.5" />
          Up
        </Button>
        <Button size="sm" variant="secondary" type="button" onClick={() => void loadDirectory()} disabled={isLoading}>
          <RefreshCcw className="size-3.5" />
          Refresh
        </Button>
        <Button size="sm" type="button" disabled>
          <Upload className="size-3.5" />
          Upload
        </Button>
      </div>

      <div className="flex h-9 shrink-0 items-center border-b border-border/50 px-3 font-mono text-xs text-slate-300">
        <span className="truncate">{path}</span>
      </div>

      {error ? (
        <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-foreground">
          {error}
        </div>
      ) : (
        <div className="app-scrollbar min-h-0 flex-1 overflow-auto p-2">
          {isLoading ? (
            <div className="p-3 text-xs text-slate-400">Loading SFTP directory...</div>
          ) : entries.length === 0 ? (
            <div className="p-3 text-xs text-slate-400">No remote entries.</div>
          ) : (
            <div className="grid gap-0.5">
              {entries.map((entry) => (
                <button
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800/75 hover:text-white"
                  key={entry.path}
                  type="button"
                  onDoubleClick={() => openEntry(entry)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder className="size-4 shrink-0 text-primary" />
                    <span className="truncate font-medium">{entry.filename}</span>
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">remote</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
