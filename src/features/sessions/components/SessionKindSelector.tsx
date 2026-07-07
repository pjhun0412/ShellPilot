import type { UseFormReturn } from 'react-hook-form';

import { sessionKinds, type CreateSessionInput } from '../session.schema';

export function SessionKindSelector({
  form,
  kind,
}: {
  form: UseFormReturn<CreateSessionInput>;
  kind: CreateSessionInput['kind'];
}) {
  return (
    <div className="grid grid-cols-5 gap-1 rounded-md border border-slate-800 bg-slate-950/70 p-1 shadow-inner shadow-black/25">
      {sessionKinds.map((sessionKind) => (
        <button
          className={[
            'rounded-[5px] px-2 py-2 text-xs font-medium transition-colors',
            kind === sessionKind
              ? 'bg-teal-500 text-slate-950 shadow-sm shadow-teal-950/30'
              : 'text-slate-400 hover:bg-slate-900/80 hover:text-slate-100',
          ].join(' ')}
          type="button"
          key={sessionKind}
          onClick={() => form.setValue('kind', sessionKind)}
        >
          {sessionKind.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
