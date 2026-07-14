import { Bot, Folder, Layers, Server } from 'lucide-react';

import type { ActivityId } from '@/types/workspace';

export const activities: Array<{ id: ActivityId; label: string; icon: typeof Server }> = [
  { id: 'sessions', label: 'Sessions', icon: Server },
  { id: 'tabs', label: 'Open Tabs', icon: Layers },
  { id: 'files', label: 'SFTP', icon: Folder },
  { id: 'ai', label: 'AI', icon: Bot },
];

export function getActivityTitle(activityId: ActivityId) {
  return activities.find((activity) => activity.id === activityId)?.label ?? 'ShellPilot';
}

export function getActivityDescription(activityId: ActivityId) {
  if (activityId === 'sessions') {
    return 'Servers and quick connect';
  }

  if (activityId === 'tabs') {
    return 'Open workspace tabs';
  }

  if (activityId === 'files') {
    return 'Remote files and transfers';
  }

  if (activityId === 'ai') {
    return 'Agents and providers';
  }

  return 'ShellPilot';
}
