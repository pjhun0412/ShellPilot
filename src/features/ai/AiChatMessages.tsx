import type { RefObject } from 'react';
import { useState } from 'react';

import type { ReadonlyToolExecutionRecord } from './aiToolRouter';

export interface AiChatMessage {
  id: string;
  role: 'assistant' | 'user';
  status?: 'thinking' | 'streaming' | 'done' | 'failed';
  text: string;
  toolExecutions?: {
    failed: boolean;
    planName: string;
    records: ReadonlyToolExecutionRecord[];
  };
}

export function AiChatMessages({
  anchorRef,
  messages,
  thinkingTick,
}: {
  anchorRef: RefObject<HTMLDivElement>;
  messages: AiChatMessage[];
  thinkingTick: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {messages.map((message) => {
        const isThinking = message.role === 'assistant' && message.status === 'thinking';
        const thinkingLabel = `Thinking${'.'.repeat(thinkingTick)}`;

        return (
          <div
            className={
              message.role === 'user'
                ? 'ml-auto max-w-[78%] rounded-md bg-primary px-3 py-2 text-sm leading-6 text-primary-foreground'
                : 'mr-auto max-w-[86%] whitespace-pre-wrap rounded-md border border-border/80 bg-card/35 px-3 py-2 text-sm leading-6 text-slate-300'
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
                <span className="text-xs text-slate-500">waiting for CLI output</span>
              </span>
            ) : (
              <>
                {message.toolExecutions ? <ToolExecutionSummary executions={message.toolExecutions} /> : null}
                {message.text}
              </>
            )}
          </div>
        );
      })}
      <div ref={anchorRef} />
    </div>
  );
}

function ToolExecutionSummary({
  executions,
}: {
  executions: NonNullable<AiChatMessage['toolExecutions']>;
}) {
  const [expanded, setExpanded] = useState(false);
  const failedCount = executions.records.filter((record) => record.status === 'failed').length;
  const statusLabel = failedCount
    ? `${executions.records.length} read-only checks, ${failedCount} failed`
    : `${executions.records.length} read-only checks`;

  return (
    <div className="mb-2 rounded-md border border-border/70 bg-background/45 text-xs text-slate-400">
      <button
        className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left hover:bg-card/70"
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="min-w-0 truncate">
          Executed {statusLabel}
          <span className="ml-2 text-slate-500">({executions.planName})</span>
        </span>
        <span className="shrink-0 text-slate-500">{expanded ? 'Hide' : 'Details'}</span>
      </button>
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
