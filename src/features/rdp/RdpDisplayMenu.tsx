import { Check, ChevronDown, ChevronRight, Monitor } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';

import {
  RDP_IMAGE_QUALITY_OPTIONS,
  getRdpResolutionOptions,
  type RdpDisplayMode,
  type RdpImageQuality,
  type RdpResolutionOption,
} from './rdpDisplayOptions';

interface RdpDisplayMenuProps {
  displayMode: RdpDisplayMode;
  imageQuality: RdpImageQuality;
  isOpen: boolean;
  menuRef: RefObject<HTMLDivElement>;
  resolution: RdpResolutionOption;
  showLabel: boolean;
  onDisplayModeChange: (mode: RdpDisplayMode) => void;
  onImageQualityChange: (quality: RdpImageQuality) => void;
  onResolutionChange: (resolution: RdpResolutionOption) => void;
  onToggle: () => void;
}

export function RdpDisplayMenu({
  displayMode,
  imageQuality,
  isOpen,
  menuRef,
  onDisplayModeChange,
  onImageQualityChange,
  onResolutionChange,
  onToggle,
  resolution,
  showLabel,
}: RdpDisplayMenuProps) {
  const resolutionOptions = getRdpResolutionOptions(resolution);

  return (
    <div ref={menuRef} className="relative">
      <Button
        size="sm"
        variant="ghost"
        title="RDP display scaling and resolution"
        onClick={onToggle}
      >
        <Monitor className="size-4" />
        {showLabel ? <span>Display</span> : null}
        <ChevronDown className="size-3" />
      </Button>
      {isOpen ? (
        <div className="absolute right-0 top-9 z-[80] w-56 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl shadow-black/60">
          <MenuSection label="View">
            <MenuItem active={displayMode === 'actual'} label="Original size" onClick={() => onDisplayModeChange('actual')} />
            <MenuItem active={displayMode === 'fit'} label="Scale to fit" onClick={() => onDisplayModeChange('fit')} />
          </MenuSection>

          <div className="py-1">
            <SubMenu label="Image quality">
              {RDP_IMAGE_QUALITY_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  active={option.value === imageQuality}
                  label={option.label}
                  title={option.title}
                  onClick={() => onImageQualityChange(option.value)}
                />
              ))}
            </SubMenu>

            <SubMenu label="Resolution" submenuClassName="w-44">
              <OverlayScrollArea className="max-h-80 pr-1" containerClassName="max-h-80">
                {resolutionOptions.map((option) => (
                  <MenuItem
                    key={`${option.width}x${option.height}:${option.label}`}
                    active={option.width === resolution.width && option.height === resolution.height}
                    label={option.label}
                    onClick={() => onResolutionChange(option)}
                  />
                ))}
              </OverlayScrollArea>
            </SubMenu>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuSection({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="border-b border-slate-800/80 py-1 last:border-b-0">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function SubMenu({
  children,
  label,
  submenuClassName = 'w-48',
}: {
  children: ReactNode;
  label: string;
  submenuClassName?: string;
}) {
  return (
    <div className="group relative">
      <button
        className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-semibold text-muted-foreground hover:bg-slate-800 group-hover:bg-slate-800"
        type="button"
      >
        <span className="grid size-4 place-items-center" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronRight className="size-3 text-slate-500" />
      </button>
      <div
        className={`invisible absolute left-full top-0 z-[90] ml-1 rounded-md border border-border bg-popover p-1.5 text-popover-foreground opacity-0 shadow-2xl shadow-black/60 group-hover:visible group-hover:opacity-100 ${submenuClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

function MenuItem({
  active,
  label,
  onClick,
  title,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs font-semibold ${
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-slate-800'
      }`}
      title={title}
      type="button"
      onClick={onClick}
    >
      <span className="grid size-4 place-items-center">{active ? <Check className="size-3" /> : null}</span>
      {label}
    </button>
  );
}
