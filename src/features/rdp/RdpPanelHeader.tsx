import { Activity, AppWindow, Monitor, RefreshCcw } from 'lucide-react';
import type { RefObject } from 'react';

import { Button } from '@/components/ui/button';
import type { SessionItem } from '@/types/workspace';

import { RdpDisplayMenu } from './RdpDisplayMenu';
import { RdpStatusBadge } from './RdpStatusBadge';
import type { RdpDisplayMode, RdpImageQuality, RdpResolutionOption } from './rdpDisplayOptions';
import type { RdpStatus } from './rdpBridge';
import {
  formatRdpBytesPerSecond,
  formatRdpFrameGap,
  formatRdpNetworkHealth,
  type RdpNetworkStats,
} from './rdpNetworkStats';

type RdpHeaderDensity = 'compact' | 'comfortable' | 'wide';

interface RdpPanelHeaderProps {
  certificateFingerprint?: string;
  desktopSize?: { height: number; width: number };
  displayMenuRef: RefObject<HTMLDivElement>;
  displayMode: RdpDisplayMode;
  endpoint: string;
  imageQuality: RdpImageQuality;
  isDisplayMenuOpen: boolean;
  isConnecting: boolean;
  networkStats: RdpNetworkStats;
  panelWidth?: number;
  resolution: RdpResolutionOption;
  session: SessionItem;
  showCanvas: boolean;
  status: RdpStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  onDisplayMenuToggle: () => void;
  onDisplayModeChange: (mode: RdpDisplayMode) => void;
  onImageQualityChange: (quality: RdpImageQuality) => void;
  onResolutionChange: (resolution: RdpResolutionOption) => void;
  onSendWindowsMenu: () => void;
}

export function RdpPanelHeader({
  certificateFingerprint,
  desktopSize,
  displayMenuRef,
  displayMode,
  endpoint,
  imageQuality,
  isDisplayMenuOpen,
  isConnecting,
  networkStats,
  onConnect,
  onDisconnect,
  onDisplayMenuToggle,
  onDisplayModeChange,
  onImageQualityChange,
  onResolutionChange,
  onSendWindowsMenu,
  panelWidth = 0,
  resolution,
  session,
  showCanvas,
  status,
}: RdpPanelHeaderProps) {
  const density: RdpHeaderDensity = panelWidth < 760 ? 'compact' : panelWidth < 1080 ? 'comfortable' : 'wide';

  return (
    <header className="relative z-20 flex min-h-11 max-w-full items-center gap-2 overflow-visible border-b border-border bg-slate-950/70 px-2.5 shadow-[inset_0_-1px_0_rgb(255_255_255_/_0.02)]">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        {density !== 'compact' ? (
          <div className="grid size-7 shrink-0 place-items-center rounded-md border border-primary/35 bg-primary/10 text-primary shadow-[0_0_18px_rgb(45_212_191_/_0.08)]">
            <Monitor className="size-4" />
          </div>
        ) : null}
        <div className="flex min-w-0 items-center gap-1.5 text-xs" title={session.name}>
          <span className={density === 'wide' ? 'max-w-44 truncate font-mono text-[12px] font-semibold text-slate-100' : 'max-w-24 truncate font-mono text-[12px] font-semibold text-slate-100'}>
            {endpoint}
          </span>
          {desktopSize && density === 'wide' ? (
            <span className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              {desktopSize.width}x{desktopSize.height}
            </span>
          ) : null}
          {certificateFingerprint && density === 'wide' ? (
            <span
              className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-500"
              title={`TLS certificate SHA-256: ${certificateFingerprint}`}
            >
              TLS
            </span>
          ) : null}
        </div>
        {showCanvas ? <RdpNetworkPill density={density} networkStats={networkStats} /> : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1.5 overflow-visible">
        <RdpDisplayMenu
          displayMode={displayMode}
          imageQuality={imageQuality}
          isOpen={isDisplayMenuOpen}
          menuRef={displayMenuRef}
          resolution={resolution}
          showLabel={density === 'wide'}
          onDisplayModeChange={onDisplayModeChange}
          onImageQualityChange={onImageQualityChange}
          onResolutionChange={onResolutionChange}
          onToggle={onDisplayMenuToggle}
        />
        <RdpStatusBadge compact={density === 'compact'} status={status} />
        <Button
          size="sm"
          variant="ghost"
          disabled={!showCanvas}
          title="Send Windows menu (Ctrl+Esc) to the remote session"
          onClick={onSendWindowsMenu}
        >
          <AppWindow className="size-4" />
          {density === 'wide' ? <span>Windows menu</span> : null}
        </Button>
        <Button size="sm" variant="secondary" disabled={isConnecting} onClick={onConnect}>
          <RefreshCcw className="size-4" />
          {density === 'wide' ? <span>Reconnect</span> : null}
        </Button>
        {density === 'wide' ? (
          <Button size="sm" variant="ghost" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : null}
      </div>
    </header>
  );
}

function RdpNetworkPill({
  density,
  networkStats,
}: {
  density: RdpHeaderDensity;
  networkStats: RdpNetworkStats;
}) {
  return (
    <div
      className="pointer-events-none flex min-w-0 shrink items-center overflow-hidden rounded-md border border-slate-800/90 bg-slate-950/80 text-[11px] text-slate-400 shadow-inner"
      title={`${formatRdpNetworkHealth(networkStats.health)} - ${networkStats.fps.toFixed(1)} fps - ${formatRdpBytesPerSecond(
        networkStats.bytesPerSecond,
      )} - ${formatRdpFrameGap(networkStats.averageFrameGapMs)}`}
    >
      <span className="flex items-center gap-1.5 border-r border-slate-800/80 px-2 py-1 font-semibold text-slate-200">
        <Activity className="size-3 text-primary" />
        <span className="size-1.5 rounded-full bg-primary" />
      </span>
      <span className="min-w-14 border-r border-slate-800/80 px-2 py-1 text-right tabular-nums text-slate-300">
        {networkStats.fps.toFixed(1)}
        <span className="ml-0.5 text-slate-500">fps</span>
      </span>
      {density !== 'compact' ? (
        <span className="min-w-20 border-r border-slate-800/80 px-2 py-1 text-right tabular-nums text-slate-300">
          {formatRdpBytesPerSecond(networkStats.bytesPerSecond)}
        </span>
      ) : null}
      {density === 'wide' ? (
        <span className="min-w-16 px-2 py-1 text-right tabular-nums text-slate-300">
          {networkStats.averageFrameGapMs === null ? '-- ms' : `${networkStats.averageFrameGapMs.toFixed(0)} ms`}
        </span>
      ) : null}
    </div>
  );
}
