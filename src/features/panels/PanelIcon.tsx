import { Bot, Folder, Monitor, Terminal } from 'lucide-react';

import type { WorkspacePanelType } from '@/types/workspace';

export function PanelIcon({ type }: { type: WorkspacePanelType }) {
  if (type === 'terminal') {
    return <Terminal />;
  }

  if (type === 'ai') {
    return <Bot />;
  }

  if (type === 'rdp') {
    return <Monitor />;
  }

  return <Folder />;
}
