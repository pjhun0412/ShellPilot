import type { RefObject } from 'react';

export interface AiChatMessage {
  id: string;
  role: 'assistant' | 'user';
  status?: 'thinking' | 'streaming' | 'done' | 'failed';
  text: string;
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
              message.text
            )}
          </div>
        );
      })}
      <div ref={anchorRef} />
    </div>
  );
}
