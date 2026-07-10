import { Bot, Info, Link2, SendHorizontal, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { AiPanelBinding, SessionItem } from '@/types/workspace';
import { AiProviderSelect } from './AiProviderSelect';
import { AiChatMessages } from './AiChatMessages';
import { useBoundAiChat } from './useBoundAiChat';
import { getDefaultAiProviderId, useAiProviders } from './useAiProviders';

export function BoundAiPanel({ binding, session }: { binding: AiPanelBinding; session?: SessionItem }) {
  const { providers } = useAiProviders();
  const [providerId, setProviderId] = useState('');
  const contextTitle = useMemo(() => {
    if (binding.boundPanelType === 'sftp') {
      return 'SFTP context';
    }

    if (binding.boundPanelType === 'terminal') {
      return 'SSH terminal context';
    }

    return 'Workspace context';
  }, [binding.boundPanelType]);

  const sourceLabel = binding.sessionName
    ? binding.sessionHost
      ? `${binding.sessionName} (${formatPrincipal(binding)})`
      : binding.sessionName
    : formatPrincipal(binding) || binding.boundPanelTitle;
  const boundTabLabel = [
    binding.boundPanelType === 'sftp' ? 'SFTP' : 'SSH',
    binding.boundPanelOrdinal ? `#${binding.boundPanelOrdinal}` : undefined,
    binding.boundPanelShortId ? `· ${binding.boundPanelShortId}` : undefined,
  ]
    .filter(Boolean)
    .join(' ');
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const {
    canSend,
    cancelActivePrompt,
    draft,
    elapsedSeconds,
    isSending,
    messages,
    recallDraftHistory,
    scrollAnchorRef,
    setDraft,
    submitSuggestedTool,
    submitPrompt,
    thinkingTick,
  } = useBoundAiChat({ binding, selectedProvider, session });

  useEffect(() => {
    setProviderId((current) => current || getDefaultAiProviderId(providers));
  }, [providers]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-sm font-semibold text-slate-50">AI Assistant</h2>
              <div className="group relative shrink-0">
                <button
                  aria-label="AI context info"
                  className="grid size-5 place-items-center rounded text-slate-500 transition-colors hover:bg-card hover:text-slate-200"
                  type="button"
                >
                  <Info className="size-3.5" />
                </button>
                <div className="pointer-events-none absolute left-1/2 top-7 z-50 hidden w-72 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-xs leading-5 text-slate-300 shadow-xl group-hover:block">
                  <div className="font-medium text-slate-100">Bound AI context</div>
                  <div className="mt-1 text-slate-400">
                    This assistant is tied to the selected SSH/SFTP tab. Questions include that tab&apos;s session context.
                  </div>
                  <div className="mt-2 border-t border-border/70 pt-2 text-slate-500">
                    {binding.contextLabel ?? 'Current tab context will be attached.'}
                  </div>
                </div>
              </div>
            </div>
            <p className="truncate text-xs text-slate-400">
              {contextTitle} · {binding.boundPanelTitle} · {boundTabLabel}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/80 bg-card/40 px-2 py-1 text-[11px] text-slate-400">
          <Link2 className="size-3.5 text-primary" />
          <span className="max-w-56 truncate">{sourceLabel}</span>
        </div>
        <AiProviderSelect
          disabled={isSending}
          providers={providers}
          value={providerId}
          onValueChange={setProviderId}
        />
      </header>

      <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-4 py-2.5">
        <div className="mx-auto flex max-w-4xl flex-col gap-2">
          <AiChatMessages
            anchorRef={scrollAnchorRef}
            elapsedSeconds={elapsedSeconds}
            messages={messages}
            thinkingTick={thinkingTick}
            onRunSuggestion={submitSuggestedTool}
          />
        </div>
      </div>

      <footer className="border-t border-border/80 px-3 py-2">
        <div className="mx-auto grid max-w-4xl grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <textarea
            className="app-scrollbar min-h-9 resize-none rounded-md border border-border bg-card/40 px-3 py-1.5 text-sm leading-6 text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-primary/70"
            placeholder="Ask AI about this tab..."
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submitPrompt();
                return;
              }

              if (
                event.key === 'ArrowUp' &&
                event.currentTarget.selectionStart === 0 &&
                event.currentTarget.selectionEnd === 0
              ) {
                if (recallDraftHistory('previous')) {
                  event.preventDefault();
                }
                return;
              }

              if (
                event.key === 'ArrowDown' &&
                event.currentTarget.selectionStart === event.currentTarget.value.length &&
                event.currentTarget.selectionEnd === event.currentTarget.value.length
              ) {
                if (recallDraftHistory('next')) {
                  event.preventDefault();
                }
              }
            }}
          />
          {isSending ? (
            <Button className="h-9 gap-2" type="button" variant="secondary" onClick={() => void cancelActivePrompt()}>
              <Square className="size-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <Button className="h-9 gap-2" disabled={!canSend} type="button" onClick={() => void submitPrompt()}>
              <SendHorizontal className="size-4" />
              Ask
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function formatPrincipal(binding: AiPanelBinding) {
  const host = binding.sessionHost;

  if (!host) {
    return '';
  }

  return binding.sessionUsername ? `${binding.sessionUsername}@${host}` : host;
}
