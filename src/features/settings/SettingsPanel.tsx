import {
  ChevronDown,
  ChevronUp,
  Folder,
  KeyRound,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { localTerminalProfiles, type LocalTerminalProfileId } from '@/features/terminal/localTerminalProfiles';
import { cn } from '@/lib/utils';
import {
  defaultDiagnosticRules,
  defaultPreferences,
  loadPreferences,
  subscribePreferences,
  updatePreferences,
  type DiagnosticHighlightRule,
  type ShellPilotPreferences,
} from './appPreferences';
import {
  matchesSetting,
  SettingsActionRow,
  SettingsList,
  SettingsNumberInput,
  SettingsTextInput,
  SettingsToggle,
} from './SettingsControls';
import { KnownHostsSettings } from './KnownHostsSettings';

export function SettingsPanel() {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('general');
  const [preferences, setPreferences] = useState<ShellPilotPreferences>(() => loadPreferences());
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => subscribePreferences(setPreferences), []);

  const updatePreference = (updater: (current: ShellPilotPreferences) => ShellPilotPreferences) => {
    setPreferences(updatePreferences(updater));
  };

  const sections = [
    {
      description: 'Startup behavior, workspace restore, and global defaults.',
      icon: Settings,
      id: 'general',
      title: 'General',
    },
    {
      description: 'Font, scrollback, cursor, and rendering defaults for new terminals.',
      icon: Terminal,
      id: 'terminal',
      title: 'Terminal',
    },
    {
      description: 'Remote browser defaults used when opening SFTP explorers.',
      icon: Folder,
      id: 'sftp',
      title: 'SFTP',
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
            <SettingsSectionContent
              preferences={preferences}
              sectionId={activeSection}
              searchQuery={searchQuery}
              updatePreference={updatePreference}
            />
          </div>
        </OverlayScrollArea>
      </div>
    </div>
  );
}

type SettingsSectionId = 'general' | 'terminal' | 'sftp' | 'ssh-security' | 'credentials';

interface SettingsSection {
  description: string;
  icon: LucideIcon;
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
  preferences,
  searchQuery,
  sectionId,
  updatePreference,
}: {
  preferences: ShellPilotPreferences;
  searchQuery: string;
  sectionId: SettingsSectionId;
  updatePreference: (updater: (current: ShellPilotPreferences) => ShellPilotPreferences) => void;
}) {
  if (sectionId === 'ssh-security') {
    return (
      <div className="grid gap-3">
        <KnownHostsSettings searchQuery={searchQuery} />
      </div>
    );
  }

  if (sectionId === 'general') {
    return (
      <SettingsList>
        <SettingsToggle
          checked={preferences.workspace.showTransferQueueOnStartup}
          description="New workspaces open the bottom Transfer Queue panel automatically. Existing saved layouts keep their current panel state."
          matches={matchesSetting(searchQuery, 'transfer queue startup bottom panel workspace')}
          title="Show Transfer Queue on startup"
          onChange={(checked) =>
            updatePreference((current) => ({
              ...current,
              workspace: {
                ...current.workspace,
                showTransferQueueOnStartup: checked,
              },
            }))
          }
        />
        <SettingsNumberInput
          description="Keepalive is always on for persistent remote sessions. This controls the seconds between lightweight idle checks."
          matches={matchesSetting(searchQuery, 'connection keepalive interval seconds idle timeout ssh sftp rdp docker')}
          max={600}
          min={15}
          step={15}
          title="Connection keepalive interval"
          value={preferences.connection.keepaliveIntervalSeconds}
          onChange={(keepaliveIntervalSeconds) =>
            updatePreference((current) => ({
              ...current,
              connection: {
                ...current.connection,
                keepaliveIntervalSeconds,
              },
            }))
          }
        />
      </SettingsList>
    );
  }

  if (sectionId === 'terminal') {
    return (
      <SettingsList>
        <SettingsActionRow
          description="Used by Session > Open Local Terminal > Default and the Sessions sidebar local terminal action."
          matches={matchesSetting(searchQuery, 'terminal local default powershell cmd wsl git bash zsh login shell')}
          title="Default local terminal"
        >
          <Select
            value={preferences.terminal.localTerminalProfileId}
            onValueChange={(localTerminalProfileId) =>
              updatePreference((current) => ({
                ...current,
                terminal: {
                  ...current.terminal,
                  localTerminalProfileId: localTerminalProfileId as LocalTerminalProfileId,
                },
              }))
            }
          >
            <SelectTrigger className="h-8 w-72 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {localTerminalProfiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsActionRow>
        <SettingsTextInput
          description="Applied when a new SSH or local terminal is created."
          matches={matchesSetting(searchQuery, 'terminal font family monospace')}
          title="Font family"
          value={preferences.terminal.fontFamily}
          onChange={(value) =>
            updatePreference((current) => ({
              ...current,
              terminal: {
                ...current.terminal,
                fontFamily: value,
              },
            }))
          }
        />
        <SettingsNumberInput
          description="Terminal character size in pixels. Applied to newly opened terminals."
          matches={matchesSetting(searchQuery, 'terminal font size')}
          max={24}
          min={9}
          title="Font size"
          value={preferences.terminal.fontSize}
          onChange={(value) =>
            updatePreference((current) => ({
              ...current,
              terminal: {
                ...current.terminal,
                fontSize: value,
              },
            }))
          }
        />
        <SettingsNumberInput
          description="Line spacing multiplier for terminal rows."
          matches={matchesSetting(searchQuery, 'terminal line height spacing')}
          max={2}
          min={1}
          step={0.05}
          title="Line height"
          value={preferences.terminal.lineHeight}
          onChange={(value) =>
            updatePreference((current) => ({
              ...current,
              terminal: {
                ...current.terminal,
                lineHeight: value,
              },
            }))
          }
        />
        <SettingsNumberInput
          description="Number of terminal rows retained in memory."
          matches={matchesSetting(searchQuery, 'terminal scrollback buffer rows')}
          max={100000}
          min={1000}
          step={1000}
          title="Scrollback"
          value={preferences.terminal.scrollback}
          onChange={(value) =>
            updatePreference((current) => ({
              ...current,
              terminal: {
                ...current.terminal,
                scrollback: value,
              },
            }))
          }
        />
        <SettingsToggle
          checked={preferences.terminal.cursorBlink}
          description="Applied when a new terminal is created."
          matches={matchesSetting(searchQuery, 'terminal cursor blink')}
          title="Cursor blink"
          onChange={(checked) =>
            updatePreference((current) => ({
              ...current,
              terminal: {
                ...current.terminal,
                cursorBlink: checked,
              },
            }))
          }
        />
        <SettingsToggle
          checked={preferences.terminal.autoCopySelection}
          description="Automatically copies selected terminal text to the clipboard. Leave off when logs may contain secrets."
          matches={matchesSetting(searchQuery, 'terminal copy selection clipboard automatic auto secret privacy')}
          title="Auto-copy selection"
          onChange={(checked) =>
            updatePreference((current) => ({
              ...current,
              terminal: {
                ...current.terminal,
                autoCopySelection: checked,
              },
            }))
          }
        />
        <SettingsToggle
          checked={preferences.terminal.diagnosticsHighlight}
          description="Highlights error, warning, and success terms on rendered terminal lines. Applied to newly opened terminals."
          matches={matchesSetting(searchQuery, 'terminal diagnostics highlight error warning failed syntax trigger')}
          title="Diagnostics highlight"
          onChange={(checked) =>
            updatePreference((current) => ({
              ...current,
              terminal: {
                ...current.terminal,
                diagnosticsHighlight: checked,
              },
            }))
          }
        />
        <DiagnosticRulesSettings
          matches={matchesSetting(searchQuery, 'terminal diagnostics highlight rules pattern color underline background ruler')}
          rules={preferences.terminal.diagnosticRules}
          updatePreference={updatePreference}
        />
        <SettingsActionRow
          description="Restore terminal preferences to ShellPilot defaults."
          matches={matchesSetting(searchQuery, 'terminal reset defaults')}
          title="Reset terminal defaults"
        >
          <button
            className="inline-flex h-8 items-center gap-2 rounded border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:bg-slate-800"
            type="button"
            onClick={() =>
              updatePreference((current) => ({
                ...current,
                terminal: { ...defaultPreferences.terminal },
              }))
            }
          >
            <RotateCcw className="size-3.5" />
            Reset
          </button>
        </SettingsActionRow>
      </SettingsList>
    );
  }

  if (sectionId === 'sftp') {
    return (
      <SettingsList>
        <SettingsToggle
          checked={preferences.sftp.showHiddenFiles}
          description="New SFTP explorers show dotfiles by default. The per-panel toggle still overrides the current explorer."
          matches={matchesSetting(searchQuery, 'sftp hidden files dotfiles browser explorer')}
          title="Show hidden files by default"
          onChange={(checked) =>
            updatePreference((current) => ({
              ...current,
              sftp: {
                ...current.sftp,
                showHiddenFiles: checked,
              },
            }))
          }
        />
      </SettingsList>
    );
  }

  return (
    <SettingsList>
      <SettingsActionRow
        description="Saved secrets stay in the operating-system credential store. ShellPilot only keeps references and connection metadata."
        matches={matchesSetting(searchQuery, 'credentials secrets credential store')}
        title="Credential storage"
      />
    </SettingsList>
  );
}

function DiagnosticRulesSettings({
  matches,
  rules,
  updatePreference,
}: {
  matches: boolean;
  rules: DiagnosticHighlightRule[];
  updatePreference: (updater: (current: ShellPilotPreferences) => ShellPilotPreferences) => void;
}) {
  const [rulesExpanded, setRulesExpanded] = useState(false);
  const [expandedRuleId, setExpandedRuleId] = useState<string | undefined>();

  if (!matches) {
    return null;
  }

  const updateRule = (ruleId: string, updater: (rule: DiagnosticHighlightRule) => DiagnosticHighlightRule) => {
    updatePreference((current) => ({
      ...current,
      terminal: {
        ...current.terminal,
        diagnosticRules: current.terminal.diagnosticRules.map((rule) => (
          rule.id === ruleId ? updater(rule) : rule
        )),
      },
    }));
  };

  const toggleRule = (ruleId: string) => {
    setExpandedRuleId((current) => (current === ruleId ? undefined : ruleId));
  };

  return (
    <section className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/45 px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2">
        <button
          className="grid min-w-0 gap-1 text-left"
          type="button"
          onClick={() => setRulesExpanded((current) => !current)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-100">Diagnostics rules</span>
            <span className="rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {rules.length}
            </span>
          </span>
          <span className="text-xs leading-5 text-slate-500">
            Customize terminal trigger patterns and highlight styles. Applied to newly opened terminals.
          </span>
        </button>
        <button
          className="inline-flex h-8 shrink-0 items-center gap-2 rounded border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:bg-slate-800"
          type="button"
          onClick={() =>
            updatePreference((current) => ({
              ...current,
              terminal: {
                ...current.terminal,
                diagnosticRules: defaultDiagnosticRules,
              },
            }))
          }
        >
          <RotateCcw className="size-3.5" />
          Reset
        </button>
        <button
          className="grid size-8 place-items-center rounded border border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-200"
          type="button"
          onClick={() => setRulesExpanded((current) => !current)}
          aria-label={rulesExpanded ? 'Collapse diagnostics rules' : 'Expand diagnostics rules'}
        >
          {rulesExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>
      {rulesExpanded ? (
      <div className="grid max-h-[18rem] gap-1.5 overflow-y-auto pr-1">
        {rules.map((rule) => {
          const expanded = expandedRuleId === rule.id;

          return (
            <div
              className="overflow-hidden rounded border border-slate-800/80 bg-slate-950/70"
              key={rule.id}
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2">
                <button
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-left"
                  type="button"
                  onClick={() => toggleRule(rule.id)}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: rule.foregroundColor }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-100">{rule.label}</span>
                    <span className="block truncate font-mono text-[11px] text-slate-500">{rule.pattern}</span>
                  </span>
                </button>
                <SwitchButton
                  checked={rule.enabled}
                  label={`${rule.label} enabled`}
                  onChange={(checked) => updateRule(rule.id, (current) => ({ ...current, enabled: checked }))}
                />
                <button
                  className="grid size-7 place-items-center rounded border border-slate-800 text-slate-500 hover:border-slate-700 hover:text-slate-200"
                  type="button"
                  onClick={() => toggleRule(rule.id)}
                  aria-label={expanded ? `Collapse ${rule.label}` : `Expand ${rule.label}`}
                >
                  {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
              </div>
              {expanded ? (
                <div className="grid gap-2 border-t border-slate-800/80 p-3">
                  <input
                    className="h-8 w-full rounded border border-slate-800 bg-slate-950 px-2 font-mono text-xs text-slate-100 outline-none focus:border-primary/70"
                    spellCheck={false}
                    value={rule.pattern}
                    onChange={(event) => updateRule(rule.id, (current) => ({ ...current, pattern: event.target.value }))}
                  />
                  <div className="grid gap-2 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-start">
                    <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                      <ColorField
                        label="Text"
                        value={rule.foregroundColor}
                        onChange={(foregroundColor) => updateRule(rule.id, (current) => ({ ...current, foregroundColor }))}
                      />
                      <ColorField
                        label="Background"
                        value={rule.backgroundColor}
                        onChange={(backgroundColor) => updateRule(rule.id, (current) => ({ ...current, backgroundColor }))}
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <StyleToggle
                        active={rule.style.foreground}
                        label="Text"
                        onClick={() =>
                          updateRule(rule.id, (current) => ({
                            ...current,
                            style: { ...current.style, foreground: !current.style.foreground },
                          }))
                        }
                      />
                      <StyleToggle
                        active={rule.style.background}
                        label="Fill"
                        onClick={() =>
                          updateRule(rule.id, (current) => ({
                            ...current,
                            style: { ...current.style, background: !current.style.background },
                          }))
                        }
                      />
                      <StyleToggle
                        active={rule.style.underline}
                        label="Underline"
                        onClick={() =>
                          updateRule(rule.id, (current) => ({
                            ...current,
                            style: { ...current.style, underline: !current.style.underline },
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="min-w-0 rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-300">
                    <span
                      className="inline-block max-w-full truncate rounded-sm px-1 align-bottom"
                      style={{
                        backgroundColor: rule.style.background ? rule.backgroundColor : 'transparent',
                        borderBottom: rule.style.underline ? `1px solid ${rule.foregroundColor}` : undefined,
                        color: rule.style.foreground ? rule.foregroundColor : undefined,
                      }}
                    >
                      {rule.label} sample
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      ) : null}
    </section>
  );
}

function ColorField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="grid h-8 min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 rounded border border-slate-800 bg-slate-950 px-2 text-xs text-slate-400">
      <span className="truncate">{label}</span>
      <input
        className="size-4 cursor-pointer appearance-none rounded border border-slate-700 bg-transparent p-0"
        type="color"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="truncate font-mono text-slate-500">{value}</span>
    </label>
  );
}

function StyleToggle({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'h-8 rounded border px-2 text-xs font-semibold transition-colors',
        active
          ? 'border-primary/60 bg-primary/15 text-primary'
          : 'border-slate-800 bg-slate-950 text-slate-500 hover:border-slate-700 hover:text-slate-300',
      )}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SwitchButton({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={checked}
      className={cn(
        'relative h-6 w-11 overflow-hidden rounded-full border transition-colors',
        checked ? 'border-primary/60 bg-primary/80' : 'border-slate-700 bg-slate-900',
      )}
      type="button"
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'absolute left-1 top-1/2 size-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
