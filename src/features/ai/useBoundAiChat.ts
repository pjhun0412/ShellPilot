import { useEffect, useRef, useState } from 'react';

import { readTerminalScrollbackText } from '@/features/terminal/terminalRegistry';
import type { AiPanelBinding, SessionItem } from '@/types/workspace';
import type { AiProviderInfo } from './aiBridge';
import { listenAiPromptEvents, runAiPromptStream } from './aiBridge';
import {
  classifyToolPlan,
  collectReadonlyToolContext,
  createReadonlyToolPlan,
} from './aiToolRouter';
import type { AiChatMessage } from './AiChatMessages';

export function useBoundAiChat({
  binding,
  selectedProvider,
  session,
}: {
  binding: AiPanelBinding;
  selectedProvider?: AiProviderInfo;
  session?: SessionItem;
}) {
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [thinkingTick, setThinkingTick] = useState(0);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null);
  const stderrBufferRef = useRef('');
  const canSend = Boolean(selectedProvider?.available && draft.trim() && !isSending);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  useEffect(() => {
    if (!isSending) {
      setThinkingTick(0);
      return undefined;
    }

    const timer = window.setInterval(() => {
      setThinkingTick((current) => (current + 1) % 4);
    }, 420);

    return () => window.clearInterval(timer);
  }, [isSending]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    listenAiPromptEvents((event) => {
      if (
        disposed ||
        event.panelId !== binding.boundPanelId ||
        event.runId !== activeRunIdRef.current
      ) {
        return;
      }

      if (event.status === 'data' && event.data) {
        const messageId = activeAssistantMessageIdRef.current;

        if (!messageId) {
          return;
        }

        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  status: 'streaming',
                  text: message.status === 'thinking' ? event.data ?? '' : `${message.text}${event.data ?? ''}`,
                }
              : message,
          ),
        );
        return;
      }

      if (event.status === 'stderr' && event.data) {
        stderrBufferRef.current += event.data;
        return;
      }

      if (event.status === 'failed') {
        failActiveMessage(event.message || stderrBufferRef.current.trim() || 'AI CLI failed.');
        return;
      }

      if (event.status === 'completed') {
        completeActiveMessage();
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [binding.boundPanelId]);

  const submitPrompt = async () => {
    const prompt = draft.trim();

    if (!prompt || !selectedProvider?.available || isSending) {
      return;
    }

    setDraft('');
    setIsSending(true);
    stderrBufferRef.current = '';
    const runId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    activeAssistantMessageIdRef.current = assistantMessageId;
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', text: prompt },
      { id: assistantMessageId, role: 'assistant', status: 'thinking', text: '' },
    ]);

    try {
      const toolPlan =
        session?.kind === 'ssh'
          ? createReadonlyToolPlan(prompt) ?? (await classifyToolPlan(prompt, selectedProvider.id))
          : undefined;
      const toolResult =
        toolPlan && session
          ? await collectReadonlyToolContext(binding.boundPanelId, session, toolPlan)
          : undefined;
      const scrollbackContext = buildTerminalScrollbackContext(binding);

      await runAiPromptStream({
        context: [buildContext(binding), scrollbackContext, toolResult?.context].filter(Boolean).join('\n\n'),
        panelId: binding.boundPanelId,
        prompt,
        providerId: selectedProvider.id,
        runId,
      });
    } catch (error) {
      setMessages((current) => [
        ...current.filter((message) => message.id !== assistantMessageId),
        {
          id: assistantMessageId,
          role: 'assistant',
          status: 'failed',
          text: error instanceof Error ? error.message : String(error),
        },
      ]);
      resetActiveRun();
    }
  };

  const failActiveMessage = (errorText: string) => {
    const messageId = activeAssistantMessageIdRef.current;

    if (messageId) {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                status: 'failed',
                text:
                  message.status === 'thinking'
                    ? errorText
                    : `${message.text.trimEnd()}\n\n${errorText}`,
              }
            : message,
        ),
      );
    }

    resetActiveRun();
  };

  const completeActiveMessage = () => {
    const messageId = activeAssistantMessageIdRef.current;

    if (messageId) {
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                status: 'done',
                text:
                  message.status === 'thinking'
                    ? stderrBufferRef.current.trim() || 'No output returned.'
                    : message.text,
              }
            : message,
        ),
      );
    }

    resetActiveRun();
  };

  const resetActiveRun = () => {
    activeRunIdRef.current = null;
    activeAssistantMessageIdRef.current = null;
    stderrBufferRef.current = '';
    setIsSending(false);
  };

  return {
    canSend,
    draft,
    isSending,
    messages,
    scrollAnchorRef,
    setDraft,
    submitPrompt,
    thinkingTick,
  };
}

function buildContext(binding: AiPanelBinding) {
  return [
    'You are answering inside ShellPilot.',
    'Keep the answer specific to the bound session tab unless the user asks otherwise.',
    `Bound panel type: ${binding.boundPanelType}`,
    `Bound panel title: ${binding.boundPanelTitle}`,
    binding.sessionName ? `Session name: ${binding.sessionName}` : undefined,
    binding.sessionUsername ? `Username: ${binding.sessionUsername}` : undefined,
    binding.sessionHost ? `Host: ${binding.sessionHost}` : undefined,
    binding.contextLabel ? `Context label: ${binding.contextLabel}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildTerminalScrollbackContext(binding: AiPanelBinding): string | undefined {
  if (binding.boundPanelType !== 'terminal') {
    return undefined;
  }

  const scrollback = readTerminalScrollbackText(binding.boundPanelId, 150);

  if (!scrollback) {
    return undefined;
  }

  return `Recent terminal output for this tab (most recent line last):\n${scrollback}`;
}
