import { Bot, CheckCircle2, CircleAlert, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { panelCatalog } from '@/features/panels/panelCatalog';
import type { WorkspacePanel } from '@/types/workspace';
import { useAiProviders } from './useAiProviders';

export function AiSidebar({ onAddPanel }: { onAddPanel: (panel: WorkspacePanel) => void }) {
  const { isLoading, providers, refreshProviders } = useAiProviders();

  const openAiPanel = () => {
    const aiPanel = panelCatalog.find((panel) => panel.type === 'ai');

    if (aiPanel) {
      onAddPanel(aiPanel);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <Button className="w-full justify-start" type="button" onClick={openAiPanel}>
        <Bot />
        Open AI Assistant
      </Button>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Local providers</h2>
          <button
            className="grid size-7 place-items-center rounded-md text-slate-400 hover:bg-accent hover:text-slate-100"
            disabled={isLoading}
            type="button"
            title="Refresh providers"
            onClick={() => void refreshProviders()}
          >
            <RefreshCw className={isLoading ? 'size-4 animate-spin' : 'size-4'} />
          </button>
        </div>

        <div className="space-y-1">
          {providers.map((provider) => (
            <div className="rounded-md px-2 py-2 hover:bg-accent/55" key={provider.id}>
              <div className="flex min-w-0 items-center gap-2">
                {provider.available ? (
                  <CheckCircle2 className="size-4 shrink-0 text-[hsl(var(--workspace-success))]" />
                ) : (
                  <CircleAlert className="size-4 shrink-0 text-slate-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-100">
                  {provider.label}
                </span>
              </div>
              <p className="mt-1 truncate pl-6 text-[11px] text-slate-500">
                {provider.available ? provider.version ?? provider.command : provider.message ?? 'Not found'}
              </p>
            </div>
          ))}
          {!providers.length && !isLoading && (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-xs leading-5 text-slate-500">
              No local AI CLI provider was detected.
            </div>
          )}
        </div>
      </section>

      <section className="mt-auto rounded-md border border-border/80 bg-slate-950/35 p-3 text-xs leading-5 text-slate-400">
        Session-bound AI will use the same provider layer later, with one thread per SSH/SFTP tab.
      </section>
    </div>
  );
}
