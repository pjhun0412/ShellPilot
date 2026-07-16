export function InlineSectionStatus({ message }: { message?: string }) {
  return (
    <div
      className={[
        'h-3 truncate text-[10px] leading-3 transition-opacity',
        message ? 'text-destructive opacity-100' : 'text-transparent opacity-0',
      ].join(' ')}
      aria-live="polite"
    >
      {message ?? '-'}
    </div>
  );
}
