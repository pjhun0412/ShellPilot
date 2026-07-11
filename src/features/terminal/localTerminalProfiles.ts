import type { WorkspaceLocalPtyTarget } from '@/types/workspace';

export type LocalTerminalProfileId = 'powershell' | 'cmd' | 'wsl' | 'git-bash';

export interface LocalTerminalProfile {
  id: LocalTerminalProfileId;
  label: string;
  target: WorkspaceLocalPtyTarget;
  title: string;
}

export const localTerminalProfiles: LocalTerminalProfile[] = [
  {
    id: 'powershell',
    label: 'PowerShell',
    title: 'PowerShell',
    target: { command: 'powershell.exe' },
  },
  {
    id: 'cmd',
    label: 'CMD',
    title: 'CMD',
    target: { command: 'cmd.exe' },
  },
  {
    id: 'wsl',
    label: 'WSL',
    title: 'WSL',
    target: { command: 'wsl.exe' },
  },
  {
    id: 'git-bash',
    label: 'Git Bash',
    title: 'Git Bash',
    target: { args: ['--login', '-i'], command: 'C:\\Program Files\\Git\\bin\\bash.exe' },
  },
];

export const defaultLocalTerminalProfileId: LocalTerminalProfileId = 'powershell';

export function getLocalTerminalProfile(profileId: unknown): LocalTerminalProfile {
  if (typeof profileId !== 'string') {
    return localTerminalProfiles[0];
  }

  return localTerminalProfiles.find((profile) => profile.id === profileId) ?? localTerminalProfiles[0];
}

export const defaultLocalTerminalProfile = getLocalTerminalProfile(defaultLocalTerminalProfileId);

export const elevatedLocalTerminalProfiles: Array<{ label: string; shell: 'cmd' | 'powershell' }> = [
  { label: 'PowerShell', shell: 'powershell' },
  { label: 'CMD', shell: 'cmd' },
];
