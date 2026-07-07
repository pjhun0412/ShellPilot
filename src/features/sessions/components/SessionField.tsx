import type { ReactNode } from 'react';

export function SessionField({
  children,
  className,
  error,
  label,
}: {
  children: ReactNode;
  className?: string;
  error?: string;
  label: string;
}) {
  return (
    <label className={['grid gap-1.5 text-sm', className].filter(Boolean).join(' ')}>
      <span className="text-muted-foreground">{label}</span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}
