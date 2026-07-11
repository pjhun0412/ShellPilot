export const RDP_PROFILES = {
  speed: {
    desktopHeight: 720,
    desktopWidth: 1152,
    label: 'Speed',
    title: 'Prioritize faster updates with a smaller desktop surface.',
  },
  balanced: {
    desktopHeight: 800,
    desktopWidth: 1280,
    label: 'Balanced',
    title: 'Balanced desktop size for ordinary administration work.',
  },
  quality: {
    desktopHeight: 1080,
    desktopWidth: 1600,
    label: 'Quality',
    title: 'Prioritize a larger desktop surface and sharper remote view.',
  },
} as const;

export type RdpProfile = keyof typeof RDP_PROFILES;

