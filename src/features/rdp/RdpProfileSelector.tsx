import { RDP_PROFILES, type RdpProfile } from './rdpProfiles';

interface RdpProfileSelectorProps {
  onChange: (profile: RdpProfile) => void;
  profile: RdpProfile;
  profileNeedsReconnect: boolean;
}

export function RdpProfileSelector({ onChange, profile, profileNeedsReconnect }: RdpProfileSelectorProps) {
  return (
    <div
      className="flex h-8 shrink-0 items-center overflow-hidden rounded-md border border-slate-800 bg-slate-950"
      title={profileNeedsReconnect ? 'Reconnect to apply the selected RDP profile.' : 'RDP display profile'}
    >
      {(Object.keys(RDP_PROFILES) as RdpProfile[]).map((key) => {
        const option = RDP_PROFILES[key];
        const active = key === profile;

        return (
          <button
            key={key}
            className={`h-full px-2.5 text-[11px] font-semibold transition ${
              active ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-slate-900 hover:text-foreground'
            }`}
            title={option.title}
            type="button"
            onClick={() => onChange(key)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
