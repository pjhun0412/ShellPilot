import type { RefObject } from 'react';
import { useState } from 'react';

import type {
  MutatingActionProposal,
  ReadonlyToolCost,
  ReadonlyToolExecutionRecord,
  ReadonlyToolSuggestion,
} from './aiToolRouter';

export type AiChatThinkingPhase = 'routing' | 'executing' | 'answering';

// Placeholder copy — wording is a later polish pass, not final.
const THINKING_PHASE_LABELS: Record<AiChatThinkingPhase, string> = {
  answering: '답변 생성 중',
  executing: '사용자 요청 명령 실행 중',
  routing: '라우팅 판단 중',
};

export interface AiChatMessage {
  id: string;
  role: 'assistant' | 'user';
  status?: 'thinking' | 'streaming' | 'done' | 'failed';
  text: string;
  thinkingPhase?: AiChatThinkingPhase;
  mutationProposal?: MutatingActionProposal;
  toolExecutions?: {
    cost?: ReadonlyToolCost;
    failed: boolean;
    planName: string;
    records: ReadonlyToolExecutionRecord[];
    suggestions?: ReadonlyToolSuggestion[];
  };
}

export function AiChatMessages({
  anchorRef,
  elapsedSeconds,
  messages,
  onRunSuggestion,
  thinkingTick,
}: {
  anchorRef: RefObject<HTMLDivElement>;
  elapsedSeconds: number;
  messages: AiChatMessage[];
  onRunSuggestion?: (suggestion: ReadonlyToolSuggestion) => void;
  thinkingTick: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {messages.map((message) => {
        const isThinking = message.role === 'assistant' && message.status === 'thinking';
        const thinkingLabel = `${THINKING_PHASE_LABELS[message.thinkingPhase ?? 'routing']}${'.'.repeat(thinkingTick)}`;

        return (
          <div
            className={
              message.role === 'user'
                ? 'ml-auto max-w-[78%] rounded-md bg-primary px-3 py-2 text-sm leading-6 text-primary-foreground'
                : 'mr-auto max-w-[86%] rounded-md border border-border/80 bg-card/35 px-3 py-2 text-sm leading-6 text-slate-300'
            }
            key={message.id}
          >
            {isThinking ? (
              <span className="inline-flex items-center gap-2 text-slate-400">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                <span>{thinkingLabel}</span>
                <span className="text-xs text-slate-500">{elapsedSeconds}s</span>
              </span>
            ) : (
              <>
                <div className="whitespace-pre-wrap">{message.text}</div>
                {message.mutationProposal ? <MutationApprovalSummary proposal={message.mutationProposal} /> : null}
                {message.toolExecutions ? (
                  <ToolExecutionSummary executions={message.toolExecutions} onRunSuggestion={onRunSuggestion} />
                ) : null}
              </>
            )}
          </div>
        );
      })}
      <div ref={anchorRef} />
    </div>
  );
}

function MutationApprovalSummary({ proposal }: { proposal: MutatingActionProposal }) {
  return (
    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
      <div className="font-semibold text-amber-50">Approval required</div>
      <div className="mt-1 text-amber-100/90">{proposal.actionLabel}</div>
      <div className="mt-2 text-amber-100/75">{proposal.reason}</div>
      <div className="mt-1 text-amber-100/60">{proposal.risk}</div>
      <div className="mt-2 rounded border border-amber-500/20 bg-background/40 px-2 py-1 text-amber-100/70">
        Mutating execution is not enabled yet. No remote command was run.
      </div>
    </div>
  );
}

function ToolExecutionSummary({
  executions,
  onRunSuggestion,
}: {
  executions: NonNullable<AiChatMessage['toolExecutions']>;
  onRunSuggestion?: (suggestion: ReadonlyToolSuggestion) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const failedCount = executions.records.filter((record) => record.status === 'failed').length;
  const statusLabel = failedCount
    ? `${executions.records.length} read-only checks, ${failedCount} failed`
    : `${executions.records.length} read-only checks`;
  const costLabel = executions.cost ? ` · ${executions.cost}` : '';

  return (
    <div className="mt-2 rounded-md border border-border/70 bg-background/45 text-xs text-slate-400">
      <button
        className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left hover:bg-card/70"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0 truncate">
          Read-only checks: {statusLabel}
          <span className="ml-2 text-slate-500">· {executions.planName}</span>
        </span>
        {costLabel ? <span className="shrink-0 text-slate-500">{costLabel.trim()}</span> : null}
        <span className="shrink-0 text-slate-500">{expanded ? 'Hide' : 'Details'}</span>
      </button>
      {executions.suggestions?.length ? (
        <div className="border-t border-border/60 px-2.5 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Suggested next checks</div>
          <div className="flex flex-wrap gap-1.5">
            {executions.suggestions.map((suggestion) => (
              <button
                className="rounded border border-border/70 bg-card/40 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                key={`${suggestion.intent}-${suggestion.label}`}
                type="button"
                disabled={!onRunSuggestion}
                onClick={() => onRunSuggestion?.(suggestion)}
              >
                {suggestion.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {expanded ? (
        <div className="space-y-2 border-t border-border/70 px-2.5 py-2">
          {executions.records.map((record, index) => (
            <div className="rounded border border-border/60 bg-card/30 p-2" key={`${record.name}-${index}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-300">{record.name}</span>
                <span className={record.status === 'failed' ? 'text-rose-300' : 'text-slate-500'}>
                  {record.status === 'failed' ? 'failed' : `exit ${record.exitCode ?? 'unknown'}`}
                </span>
              </div>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-background/80 px-2 py-1 font-mono text-[11px] leading-5 text-slate-300">
                {record.command}
              </pre>
              {record.error ? (
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-rose-950/20 px-2 py-1 font-mono text-[11px] leading-5 text-rose-200">
                  {record.error}
                </pre>
              ) : null}
              {record.stdout ? (
                <pre className="app-scrollbar mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background/60 px-2 py-1 font-mono text-[11px] leading-5 text-slate-400">
                  {record.stdout}
                </pre>
              ) : null}
              {record.stderr ? (
                <pre className="app-scrollbar mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-background/60 px-2 py-1 font-mono text-[11px] leading-5 text-amber-200">
                  {record.stderr}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
