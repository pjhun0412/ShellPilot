import type { WorkspacePanel } from '@/types/workspace';

export const panelCatalog: WorkspacePanel[] = [
  { id: 'ssh-terminal', title: 'SSH Terminal', type: 'terminal' },
  { id: 'ai-assistant', title: 'AI Assistant', type: 'ai' },
  { id: 'sftp-explorer', title: 'SFTP Explorer', type: 'sftp' },
  { id: 'rdp-preview', title: 'RDP Preview', type: 'rdp' },
];
