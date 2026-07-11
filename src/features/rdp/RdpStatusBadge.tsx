import type { RdpStatus } from './rdpBridge';

export function RdpStatusBadge({ compact = false, status }: { compact?: boolean; status: RdpStatus }) {
  const label = {
    closed: 'closed',
    connected: 'connected',
    connecting: 'connecting',
    failed: 'failed',
    frameReady: 'frame ready',
  }[status];
  const tone =
    status === 'connected' || status === 'frameReady'
      ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
      : status === 'failed'
        ? 'border-rose-500/35 bg-rose-500/10 text-rose-200'
        : status === 'connecting'
          ? 'border-sky-500/35 bg-sky-500/10 text-sky-200'
          : 'border-slate-700 bg-slate-900 text-slate-400';

  if (compact) {
    return (
      <span className={`grid size-7 shrink-0 place-items-center rounded border ${tone}`} title={label}>
        <span className="size-1.5 rounded-full bg-current" />
      </span>
    );
  }

  return (
    <span className={`min-w-20 shrink-0 rounded border px-2 py-1 text-center text-[11px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}
