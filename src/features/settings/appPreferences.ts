export interface ShellPilotPreferences {
  sftp: {
    showHiddenFiles: boolean;
  };
  terminal: {
    cursorBlink: boolean;
    diagnosticRules: DiagnosticHighlightRule[];
    diagnosticsHighlight: boolean;
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    scrollback: number;
  };
  workspace: {
    showTransferQueueOnStartup: boolean;
  };
}

export interface DiagnosticHighlightRule {
  backgroundColor: string;
  enabled: boolean;
  foregroundColor: string;
  id: string;
  label: string;
  overviewRuler: boolean;
  pattern: string;
  style: {
    background: boolean;
    foreground: boolean;
    underline: boolean;
  };
}

export const appPreferencesStorageKey = 'shellpilot.preferences.v1';

export const defaultDiagnosticRules: DiagnosticHighlightRule[] = [
  {
    backgroundColor: '#4c1d24',
    enabled: true,
    foregroundColor: '#fca5a5',
    id: 'error',
    label: 'Error',
    overviewRuler: true,
    pattern: '\\b(error|failed|failure|exception|fatal|traceback)\\b',
    style: {
      background: true,
      foreground: true,
      underline: false,
    },
  },
  {
    backgroundColor: '#3f2e12',
    enabled: true,
    foregroundColor: '#fde68a',
    id: 'warning',
    label: 'Warning',
    overviewRuler: true,
    pattern: '\\b(warn|warning|deprecated)\\b',
    style: {
      background: false,
      foreground: true,
      underline: true,
    },
  },
  {
    backgroundColor: '#123326',
    enabled: true,
    foregroundColor: '#86efac',
    id: 'success',
    label: 'Success',
    overviewRuler: true,
    pattern: '\\b(success|succeeded|completed|listening)\\b',
    style: {
      background: false,
      foreground: true,
      underline: false,
    },
  },
  {
    backgroundColor: '#111827',
    enabled: true,
    foregroundColor: '#64748b',
    id: 'timestamp',
    label: 'Timestamp',
    overviewRuler: false,
    pattern: '^[A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2}',
    style: {
      background: false,
      foreground: true,
      underline: false,
    },
  },
  {
    backgroundColor: '#082f49',
    enabled: true,
    foregroundColor: '#22d3ee',
    id: 'process-id',
    label: 'Process ID',
    overviewRuler: false,
    pattern: '\\[[0-9]+\\]',
    style: {
      background: false,
      foreground: true,
      underline: false,
    },
  },
  {
    backgroundColor: '#082f49',
    enabled: true,
    foregroundColor: '#67e8f9',
    id: 'log-level-info',
    label: 'Info level',
    overviewRuler: false,
    pattern: '<info>',
    style: {
      background: false,
      foreground: true,
      underline: false,
    },
  },
];

export const defaultPreferences: ShellPilotPreferences = {
  sftp: {
    showHiddenFiles: true,
  },
  terminal: {
    cursorBlink: true,
    diagnosticRules: defaultDiagnosticRules,
    diagnosticsHighlight: true,
    fontFamily: 'Cascadia Mono, D2Coding, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.35,
    scrollback: 5000,
  },
  workspace: {
    showTransferQueueOnStartup: false,
  },
};

export function loadPreferences(): ShellPilotPreferences {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(appPreferencesStorageKey) ?? '{}') as Partial<ShellPilotPreferences>;

    return normalizePreferences(parsed);
  } catch {
    return defaultPreferences;
  }
}

export function savePreferences(nextPreferences: ShellPilotPreferences) {
  window.localStorage.setItem(appPreferencesStorageKey, JSON.stringify(normalizePreferences(nextPreferences)));
  window.dispatchEvent(new CustomEvent(appPreferencesStorageKey));
}

export function updatePreferences(updater: (current: ShellPilotPreferences) => ShellPilotPreferences) {
  const nextPreferences = updater(loadPreferences());

  savePreferences(nextPreferences);
  return nextPreferences;
}

export function subscribePreferences(listener: (preferences: ShellPilotPreferences) => void) {
  const handlePreferencesChange = () => listener(loadPreferences());

  window.addEventListener(appPreferencesStorageKey, handlePreferencesChange);
  window.addEventListener('storage', handlePreferencesChange);

  return () => {
    window.removeEventListener(appPreferencesStorageKey, handlePreferencesChange);
    window.removeEventListener('storage', handlePreferencesChange);
  };
}

function normalizePreferences(value: Partial<ShellPilotPreferences>): ShellPilotPreferences {
  return {
    sftp: {
      showHiddenFiles: value.sftp?.showHiddenFiles ?? defaultPreferences.sftp.showHiddenFiles,
    },
    terminal: {
      cursorBlink: value.terminal?.cursorBlink ?? defaultPreferences.terminal.cursorBlink,
      diagnosticRules: normalizeDiagnosticRules(value.terminal?.diagnosticRules),
      diagnosticsHighlight: value.terminal?.diagnosticsHighlight ?? defaultPreferences.terminal.diagnosticsHighlight,
      fontFamily: value.terminal?.fontFamily?.trim() || defaultPreferences.terminal.fontFamily,
      fontSize: clampNumber(value.terminal?.fontSize, 10, 24, defaultPreferences.terminal.fontSize),
      lineHeight: clampNumber(value.terminal?.lineHeight, 1, 2, defaultPreferences.terminal.lineHeight),
      scrollback: clampNumber(value.terminal?.scrollback, 1000, 100000, defaultPreferences.terminal.scrollback),
    },
    workspace: {
      showTransferQueueOnStartup:
        value.workspace?.showTransferQueueOnStartup ?? defaultPreferences.workspace.showTransferQueueOnStartup,
    },
  };
}

function normalizeDiagnosticRules(value: unknown): DiagnosticHighlightRule[] {
  if (!Array.isArray(value)) {
    return defaultDiagnosticRules;
  }

  const rules = value
    .map((rule, index) => normalizeDiagnosticRule(rule, index))
    .filter((rule): rule is DiagnosticHighlightRule => Boolean(rule));

  return rules.length > 0 ? rules : defaultDiagnosticRules;
}

function normalizeDiagnosticRule(value: unknown, index: number): DiagnosticHighlightRule | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<DiagnosticHighlightRule>;
  const pattern = typeof candidate.pattern === 'string' ? candidate.pattern.trim() : '';

  if (!pattern) {
    return undefined;
  }

  return {
    backgroundColor: normalizeColor(candidate.backgroundColor, '#1e293b'),
    enabled: candidate.enabled ?? true,
    foregroundColor: normalizeColor(candidate.foregroundColor, '#e2e8f0'),
    id: candidate.id?.trim() || `custom-${index + 1}`,
    label: candidate.label?.trim() || `Rule ${index + 1}`,
    overviewRuler: candidate.overviewRuler ?? false,
    pattern,
    style: {
      background: candidate.style?.background ?? false,
      foreground: candidate.style?.foreground ?? true,
      underline: candidate.style?.underline ?? false,
    },
  };
}

function normalizeColor(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmedValue = value.trim();

  return /^#[0-9a-fA-F]{6}$/.test(trimmedValue) ? trimmedValue : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}
