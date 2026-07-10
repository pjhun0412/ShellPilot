import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function SettingsList({ children }: { children: ReactNode }) {
  const visibleChildren = Array.isArray(children)
    ? children.filter(Boolean)
    : children;

  if (Array.isArray(visibleChildren) && visibleChildren.length === 0) {
    return (
      <section className="rounded-md border border-dashed border-slate-800 bg-slate-950/20 px-4 py-8 text-center">
        <p className="text-sm font-medium text-slate-400">No matching settings.</p>
      </section>
    );
  }

  return <div className="grid max-w-3xl gap-2">{visibleChildren}</div>;
}

export function SettingsActionRow({
  children,
  description,
  matches,
  title,
}: {
  children?: ReactNode;
  description: string;
  matches: boolean;
  title: string;
}) {
  if (!matches) {
    return null;
  }

  return (
    <section className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/45 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </section>
  );
}

export function SettingsToggle({
  checked,
  description,
  matches,
  onChange,
  title,
}: {
  checked: boolean;
  description: string;
  matches: boolean;
  onChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <SettingsActionRow description={description} matches={matches} title={title}>
      <button
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
    </SettingsActionRow>
  );
}

export function SettingsTextInput({
  description,
  matches,
  onChange,
  title,
  value,
}: {
  description: string;
  matches: boolean;
  onChange: (value: string) => void;
  title: string;
  value: string;
}) {
  return (
    <SettingsActionRow description={description} matches={matches} title={title}>
      <input
        className="h-8 w-72 max-w-full rounded border border-slate-800 bg-slate-950 px-2 text-xs text-slate-100 outline-none focus:border-primary/70"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </SettingsActionRow>
  );
}

export function SettingsNumberInput({
  description,
  matches,
  max,
  min,
  onChange,
  step = 1,
  title,
  value,
}: {
  description: string;
  matches: boolean;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  title: string;
  value: number;
}) {
  const updateValue = (nextValue: number) => {
    const decimalPlaces = getDecimalPlaces(step);
    const normalizedValue = Number(nextValue.toFixed(decimalPlaces));

    onChange(Math.min(Math.max(normalizedValue, min), max));
  };

  return (
    <SettingsActionRow description={description} matches={matches} title={title}>
      <div className="grid h-8 w-28 grid-cols-[1fr_1.75rem] overflow-hidden rounded border border-slate-800 bg-slate-950 focus-within:border-primary/70">
        <input
          className="min-w-0 bg-transparent px-2 text-right text-xs text-slate-100 outline-none"
          inputMode="decimal"
          value={String(value)}
          onChange={(event) => {
            const nextValue = Number(event.target.value);

            if (!Number.isNaN(nextValue)) {
              updateValue(nextValue);
            }
          }}
        />
        <div className="grid border-l border-slate-800">
          <button
            aria-label={`Increase ${title}`}
            className="grid place-items-center text-slate-500 hover:bg-slate-900 hover:text-slate-200"
            type="button"
            onClick={() => updateValue(value + step)}
          >
            <ChevronUp className="size-3" />
          </button>
          <button
            aria-label={`Decrease ${title}`}
            className="grid place-items-center border-t border-slate-800 text-slate-500 hover:bg-slate-900 hover:text-slate-200"
            type="button"
            onClick={() => updateValue(value - step)}
          >
            <ChevronDown className="size-3" />
          </button>
        </div>
      </div>
    </SettingsActionRow>
  );
}

export function matchesSetting(searchQuery: string, text: string) {
  const query = searchQuery.trim().toLowerCase();

  if (!query) {
    return true;
  }

  return text.toLowerCase().includes(query);
}

function getDecimalPlaces(value: number) {
  const [, decimalPart = ''] = String(value).split('.');

  return Math.min(decimalPart.length, 4);
}
