import type { LocalPtyTarget } from '@/features/terminal/localPtyBridge';

import type { AiProviderInfo } from './aiBridge';

export function createAiTerminalTarget(provider?: AiProviderInfo): LocalPtyTarget | undefined {
  if (!provider?.available) {
    return undefined;
  }

  return {
    args: getProviderArgs(provider),
    command: provider.command,
  };
}

function getProviderArgs(provider: AiProviderInfo) {
  if (provider.id === 'codex-cli') {
    return ['--no-alt-screen'];
  }

  return undefined;
}
