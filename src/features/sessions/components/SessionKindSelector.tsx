import type { UseFormReturn } from 'react-hook-form';

import type { CreateSessionInput } from '../session.schema';

const visibleSessionKinds: Array<{
  kind: CreateSessionInput['kind'];
  label: string;
}> = [
  { kind: 'ssh', label: 'SSH' },
  { kind: 'sftp', label: 'File Transfer' },
  { kind: 'rdp', label: 'RDP' },
  { kind: 'vnc', label: 'VNC' },
];

export function SessionKindSelector({
  form,
  kind,
}: {
  form: UseFormReturn<CreateSessionInput>;
  kind: CreateSessionInput['kind'];
}) {
  const selectedKind = kind === 'ftp' ? 'sftp' : kind;

  return (
    <div className="grid grid-cols-4 gap-1 rounded-md border border-slate-800 bg-slate-950/70 p-1 shadow-inner shadow-black/25">
      {visibleSessionKinds.map(({ kind: sessionKind, label }) => (
        <button
          className={[
            'rounded-[5px] px-2 py-2 text-xs font-medium transition-colors',
            selectedKind === sessionKind
              ? 'bg-teal-500 text-slate-950 shadow-sm shadow-teal-950/30'
              : 'text-muted-foreground hover:bg-slate-900/80 hover:text-foreground',
          ].join(' ')}
          type="button"
          key={sessionKind}
          onClick={() => form.setValue('kind', sessionKind)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
