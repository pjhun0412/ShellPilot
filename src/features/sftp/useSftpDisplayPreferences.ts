import { useCallback, useState } from 'react';

import { loadPreferences, updatePreferences } from '@/features/settings/appPreferences';
import type { SftpViewMode } from './sftpPanelTypes';

export function useSftpDisplayPreferences() {
  const [showHiddenEntries, setShowHiddenEntriesState] = useState(() => loadPreferences().sftp.showHiddenFiles);
  const [showPermissions, setShowPermissions] = useState(true);
  const [viewMode, setViewMode] = useState<SftpViewMode>('explorer');

  const setShowHiddenEntries = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setShowHiddenEntriesState((current) => {
      const nextValue = typeof value === 'function' ? value(current) : value;

      updatePreferences((preferences) => ({
        ...preferences,
        sftp: {
          ...preferences.sftp,
          showHiddenFiles: nextValue,
        },
      }));

      return nextValue;
    });
  }, []);

  return {
    setShowHiddenEntries,
    setShowPermissions,
    setViewMode,
    showHiddenEntries,
    showPermissions,
    viewMode,
  };
}
