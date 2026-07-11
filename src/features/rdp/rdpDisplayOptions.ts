export type RdpDisplayMode = 'actual' | 'fit';
export type RdpImageQuality = 'speed' | 'balanced' | 'quality';

export interface RdpResolutionOption {
  height: number;
  label: string;
  width: number;
}

export const RDP_RESOLUTION_OPTIONS: RdpResolutionOption[] = [
  { height: 2160, label: '3840x2160 (4K)', width: 3840 },
  { height: 1440, label: '2560x1440', width: 2560 },
  { height: 1080, label: '1920x1080', width: 1920 },
  { height: 1050, label: '1680x1050', width: 1680 },
  { height: 900, label: '1600x900', width: 1600 },
  { height: 900, label: '1440x900', width: 1440 },
  { height: 768, label: '1366x768', width: 1366 },
  { height: 1024, label: '1280x1024', width: 1280 },
  { height: 960, label: '1280x960', width: 1280 },
  { height: 800, label: '1280x800', width: 1280 },
  { height: 768, label: '1280x768', width: 1280 },
  { height: 720, label: '1280x720', width: 1280 },
  { height: 864, label: '1152x864', width: 1152 },
  { height: 768, label: '1024x768', width: 1024 },
  { height: 600, label: '800x600', width: 800 },
  { height: 480, label: '640x480', width: 640 },
];

// MS-RDPEDISP requires even width/height for later live resizes, so round the
// detected screen size down to the nearest even number to stay consistent
// between the initial connect and any resize done through the same channel.
function toEvenDimension(value: number) {
  return Math.max(200, Math.floor(value / 2) * 2);
}

export function getLocalScreenResolution(): RdpResolutionOption {
  const pixelRatio = window.devicePixelRatio || 1;
  const width = toEvenDimension(window.screen.width * pixelRatio);
  const height = toEvenDimension(window.screen.height * pixelRatio);
  const preset = RDP_RESOLUTION_OPTIONS.find((option) => option.width === width && option.height === height);

  return preset ?? { height, label: `${width}x${height} (this display)`, width };
}

export function getRdpResolutionOptions(selectedResolution?: RdpResolutionOption) {
  if (!selectedResolution) {
    return RDP_RESOLUTION_OPTIONS;
  }

  const selectedPreset = RDP_RESOLUTION_OPTIONS.some(
    (option) => option.width === selectedResolution.width && option.height === selectedResolution.height,
  );

  return selectedPreset ? RDP_RESOLUTION_OPTIONS : [selectedResolution, ...RDP_RESOLUTION_OPTIONS];
}

export const RDP_IMAGE_QUALITY_OPTIONS: Array<{
  label: string;
  title: string;
  value: RdpImageQuality;
}> = [
  {
    label: 'Speed',
    title: 'Prefer cheaper canvas scaling while resizing or using constrained panels.',
    value: 'speed',
  },
  {
    label: 'Balanced',
    title: 'Use the browser default scaling quality.',
    value: 'balanced',
  },
  {
    label: 'Quality',
    title: 'Prefer smoother scaled output for detailed remote desktops.',
    value: 'quality',
  },
];
