import { ShieldCheck } from 'lucide-react';

import { getCredentialMemoryRule } from '../session.security';

export function SessionSecurityNotice() {
  return (
    <div className="flex gap-2 rounded-md border border-slate-800 bg-background/70 p-3 text-xs font-medium text-muted-foreground">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
      <span>{getCredentialMemoryRule()}</span>
    </div>
  );
}
