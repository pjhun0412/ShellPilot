export interface RdpNetworkStats {
  averageFrameGapMs: number | null;
  bytesPerSecond: number;
  fps: number;
  health: 'idle' | 'excellent' | 'good' | 'fair' | 'poor';
}

export function createIdleRdpNetworkStats(): RdpNetworkStats {
  return {
    averageFrameGapMs: null,
    bytesPerSecond: 0,
    fps: 0,
    health: 'idle',
  };
}

export function estimateRdpNetworkHealth(
  fps: number,
  averageFrameGapMs: number | null,
): RdpNetworkStats['health'] {
  if (!averageFrameGapMs || fps === 0) {
    return 'idle';
  }

  if (fps >= 20 && averageFrameGapMs <= 80) {
    return 'excellent';
  }

  if (fps >= 10 && averageFrameGapMs <= 160) {
    return 'good';
  }

  if (fps >= 4 && averageFrameGapMs <= 350) {
    return 'fair';
  }

  return 'poor';
}

export function formatRdpBytesPerSecond(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s`;
  }

  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  }

  return `${bytesPerSecond.toFixed(0)} B/s`;
}

export function formatRdpFrameGap(value: number | null) {
  return value === null ? 'frame gap --' : `frame gap ${value.toFixed(0)} ms`;
}

export function formatRdpNetworkHealth(health: RdpNetworkStats['health']) {
  return {
    excellent: 'Excellent',
    fair: 'Fair',
    good: 'Good',
    idle: 'Idle',
    poor: 'Poor',
  }[health];
}

