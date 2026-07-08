import { useCallback, useEffect, useState } from 'react';

import { listAiProviders, type AiProviderInfo } from './aiBridge';

export function useAiProviders() {
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refreshProviders = useCallback(() => {
    setIsLoading(true);

    return listAiProviders()
      .then(setProviders)
      .catch(() => setProviders([]))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  return { isLoading, providers, refreshProviders };
}

export function getDefaultAiProviderId(providers: AiProviderInfo[]) {
  return providers.find((provider) => provider.available)?.id ?? '';
}
