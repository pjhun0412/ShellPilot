import { invoke } from '@tauri-apps/api/core';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { appConfirm } from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface KnownHostRecord {
  algorithm: string;
  fingerprint: string;
  host: string;
  port: number;
}

export function KnownHostsSettings({ searchQuery }: { searchQuery: string }) {
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
            <h3 className="text-sm font-semibold text-foreground">SSH Known Hosts</h3>
            <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">
              Trusted SSH host keys are stored locally and used to detect server identity changes.
            </p>
          </div>
          <span className="rounded border border-slate-800 bg-slate-950/80 px-2 py-1 font-mono text-[11px] font-semibold text-muted-foreground">
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
          <p className="text-xs font-medium leading-5 text-muted-foreground">
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
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-1 text-sm font-semibold text-foreground">
                    <span className="min-w-0 truncate">{record.host}</span>
                    <span className="font-mono text-xs font-normal text-muted-foreground">:{record.port}</span>
                  </div>
                  <div className="mt-1 text-xs font-medium text-muted-foreground">{record.algorithm}</div>
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
                className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded border border-slate-900 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-muted-foreground"
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
