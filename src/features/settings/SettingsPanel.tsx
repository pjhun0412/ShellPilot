import { KeyRound, Search, Settings, ShieldCheck, Terminal } from 'lucide-react';
import { useState } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { cn } from '@/lib/utils';
import { KnownHostsSettings } from './KnownHostsSettings';

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const sections = [
    {
      description: 'Theme, density, and workspace restore options will live here.',
      icon: Settings,
      id: 'general',
      title: 'General',
    },
    {
      description: 'Font, scrollback, copy/paste, and rendering preferences.',
      icon: Terminal,
      id: 'terminal',
      title: 'Terminal',
    },
    {
      description: 'Known hosts, key handling, agent behavior, and connection defaults.',
      icon: ShieldCheck,
      id: 'ssh-security',
      title: 'SSH Security',
    },
    {
      description: 'Credential store policy and saved secret references.',
      icon: KeyRound,
      id: 'credentials',
      title: 'Credentials',
    },
  ] satisfies SettingsSection[];
  const selectedSection = sections.find((section) => section.id === activeSection);

  return (
    <div className="settings-panel h-full min-h-0">
      <div className="settings-panel__layout">
        <aside className="settings-panel__nav">
          <div className="settings-panel__heading">
            <h2 className="text-sm font-semibold text-slate-100">Settings</h2>
            <p className="mt-1 text-xs text-slate-500">ShellPilot preferences</p>
          </div>
          <nav className="settings-panel__nav-list">
            {sections.map((section) => (
              <SettingsNavButton
                isActive={activeSection === section.id}
                key={section.id}
                section={section}
                onSelect={() => setActiveSection(section.id)}
              />
            ))}
          </nav>
        </aside>
        <OverlayScrollArea className="settings-panel__content">
          <div className="settings-panel__content-inner">
            <div className="relative min-w-0 max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <input
                className="h-9 w-full rounded-md border border-slate-800 bg-slate-950/70 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-primary/70"
                placeholder="Search settings"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-50">{selectedSection?.title}</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">{selectedSection?.description}</p>
            </div>
            <SettingsSectionContent sectionId={activeSection} searchQuery={searchQuery} />
          </div>
        </OverlayScrollArea>
      </div>
    </div>
  );
}

type SettingsSectionId = 'general' | 'terminal' | 'ssh-security' | 'credentials';

interface SettingsSection {
  description: string;
  icon: typeof Settings;
  id: SettingsSectionId;
  title: string;
}

function SettingsNavButton({
  isActive,
  onSelect,
  section,
}: {
  isActive: boolean;
  onSelect: () => void;
  section: SettingsSection;
}) {
  const Icon = section.icon;

  return (
    <button
      className={cn(
        'flex h-8 min-w-0 flex-1 basis-36 items-center gap-2 rounded px-2 text-left text-sm transition-colors',
        isActive
          ? 'bg-slate-800/75 text-slate-50'
          : 'text-slate-400 hover:bg-slate-900/70 hover:text-slate-100',
      )}
      type="button"
      onClick={onSelect}
    >
      <Icon className={cn('size-3.5 shrink-0', isActive ? 'text-primary' : 'text-slate-500')} />
      <span className="truncate">{section.title}</span>
    </button>
  );
}

function SettingsSectionContent({
  searchQuery,
  sectionId,
}: {
  searchQuery: string;
  sectionId: SettingsSectionId;
}) {
  if (sectionId === 'ssh-security') {
    return (
      <div className="grid gap-3">
        <KnownHostsSettings searchQuery={searchQuery} />
      </div>
    );
  }

  const copyBySection: Record<Exclude<SettingsSectionId, 'ssh-security'>, string> = {
    credentials: 'Credential store policy and saved secret references will be managed here.',
    general: 'Theme, density, and workspace restore preferences will be added here.',
    terminal: 'Terminal font, scrollback, paste, and rendering options will be added here.',
  };

  return (
    <section className="rounded-md border border-dashed border-slate-800 bg-slate-950/20 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-300">
        {copyBySection[sectionId]}
      </p>
    </section>
  );
}
