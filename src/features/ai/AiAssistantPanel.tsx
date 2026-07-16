import { Bot } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { LocalPtyTerminal } from '@/features/terminal/LocalPtyTerminal';
import { AiProviderSelect } from './AiProviderSelect';
import { createAiTerminalTarget } from './aiTerminalTarget';
import { getDefaultAiProviderId, useAiProviders } from './useAiProviders';

export function AiAssistantPanel({ panelId }: { panelId: string }) {
  const { isLoading, providers } = useAiProviders();
  const [providerId, setProviderId] = useState('');
  const [connectedProviderId, setConnectedProviderId] = useState('');
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const connectedProvider = providers.find((provider) => provider.id === connectedProviderId);
  const localPtyTarget = createAiTerminalTarget(connectedProvider);
  const isConnected = Boolean(connectedProviderId);

  useEffect(() => {
    setProviderId((current) => current || getDefaultAiProviderId(providers));
  }, [providers]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border/80 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-primary/20 bg-primary/10 text-primary">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">AI Assistant</h2>
            <p className="truncate text-xs text-muted-foreground">
              {selectedProvider?.available
                ? `${selectedProvider.label} · ${selectedProvider.version ?? selectedProvider.command}`
                : 'Select an available local CLI provider'}
            </p>
          </div>
        </div>

        <AiProviderSelect
          disabled={isConnected}
          providers={providers}
          triggerClassName="h-8 w-44 text-xs"
          value={providerId}
          onValueChange={setProviderId}
        />

        {isConnected ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setConnectedProviderId('')}
          >
            Disconnect
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={!selectedProvider?.available}
            onClick={() => setConnectedProviderId(providerId)}
          >
            Connect
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {!isLoading && !selectedProvider?.available && (
          <div className="m-3 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-xs leading-5 text-destructive-foreground">
            Claude CLI 또는 Codex CLI를 찾지 못했습니다. 터미널에서 로그인해서 쓰는 명령이 PATH에 잡혀 있는지 확인해 주세요.
          </div>
        )}

        {!localPtyTarget && selectedProvider?.available && (
          <div className="grid h-full place-items-center p-4 text-center">
            <div className="max-w-sm rounded-md border border-dashed border-border bg-card/40 p-4 text-sm leading-6 text-muted-foreground">
              Select a provider and click Connect to start an interactive CLI session.
            </div>
          </div>
        )}

        {localPtyTarget && connectedProviderId && (
          <LocalPtyTerminal
            key={connectedProviderId}
            panelId={panelId}
            target={localPtyTarget}
          />
        )}
      </div>
    </div>
  );
}
