import type { WorkspaceLocalPtyTarget } from '@/types/workspace';

export type LocalTerminalProfileId = 'powershell' | 'cmd' | 'wsl' | 'git-bash' | 'zsh' | 'bash' | 'login-shell';

export interface LocalTerminalProfile {
  id: LocalTerminalProfileId;
  label: string;
  target: WorkspaceLocalPtyTarget;
  title: string;
}

const windowsLocalTerminalProfiles: LocalTerminalProfile[] = [
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

const macosLocalTerminalProfiles: LocalTerminalProfile[] = [
  {
    id: 'zsh',
    label: 'Zsh',
    title: 'Zsh',
    target: { args: ['-l'], command: '/bin/zsh' },
  },
  {
    id: 'bash',
    label: 'Bash',
    title: 'Bash',
    target: { args: ['-l'], command: '/bin/bash' },
  },
  {
    id: 'login-shell',
    label: 'Default Shell',
    title: 'Local Shell',
    target: { command: '__shellpilot_default_shell' },
  },
];

const unixLocalTerminalProfiles: LocalTerminalProfile[] = [
  {
    id: 'bash',
    label: 'Bash',
    title: 'Bash',
    target: { args: ['-l'], command: '/bin/bash' },
  },
  {
    id: 'zsh',
    label: 'Zsh',
    title: 'Zsh',
    target: { args: ['-l'], command: '/bin/zsh' },
  },
];

function getHostPlatform(): 'windows' | 'macos' | 'unix' {
  const platform = globalThis.navigator?.platform?.toLowerCase() ?? '';
  const userAgent = globalThis.navigator?.userAgent?.toLowerCase() ?? '';
  const value = `${platform} ${userAgent}`;

  if (value.includes('mac')) {
    return 'macos';
  }

  if (value.includes('win')) {
    return 'windows';
  }

  return 'unix';
}

export const localTerminalProfiles: LocalTerminalProfile[] = (() => {
  switch (getHostPlatform()) {
    case 'macos':
      return macosLocalTerminalProfiles;
    case 'windows':
      return windowsLocalTerminalProfiles;
    default:
      return unixLocalTerminalProfiles;
  }
})();

export const defaultLocalTerminalProfileId: LocalTerminalProfileId = localTerminalProfiles[0]?.id ?? 'bash';

export function getLocalTerminalProfile(profileId: unknown): LocalTerminalProfile {
  if (typeof profileId !== 'string') {
    return localTerminalProfiles[0];
  }

  return localTerminalProfiles.find((profile) => profile.id === profileId) ?? localTerminalProfiles[0];
}

export const defaultLocalTerminalProfile = getLocalTerminalProfile(defaultLocalTerminalProfileId);

const windowsElevatedLocalTerminalProfiles = [
  { label: 'PowerShell', shell: 'powershell' },
  { label: 'CMD', shell: 'cmd' },
] satisfies Array<{ label: string; shell: 'cmd' | 'powershell' }>;

export const elevatedLocalTerminalProfiles: Array<{ label: string; shell: 'cmd' | 'powershell' }> =
  getHostPlatform() === 'windows' ? windowsElevatedLocalTerminalProfiles : [];
