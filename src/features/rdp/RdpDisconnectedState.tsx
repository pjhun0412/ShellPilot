import { PlugZap } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface RdpDisconnectedStateProps {
  certificateFingerprint?: string;
  errorCode?: string;
  isConnecting: boolean;
  message: string;
  needsPassword: boolean;
  password: string;
  onForgetCertificate: () => void;
  onPasswordChange: (password: string) => void;
  onPasswordSubmit: () => void;
  onTrustCertificate: () => void;
}

export function RdpDisconnectedState({
  certificateFingerprint,
  errorCode,
  isConnecting,
  message,
  needsPassword,
  onForgetCertificate,
  onPasswordChange,
  onPasswordSubmit,
  onTrustCertificate,
  password,
}: RdpDisconnectedStateProps) {
  return (
    <section className="w-full max-w-2xl rounded-md border border-slate-800 bg-slate-950/55 p-5 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-slate-700 bg-slate-900">
          <PlugZap className="size-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Embedded RDP session</h3>
            <p className="mt-1 text-sm leading-6 text-slate-300">{message}</p>
            {errorCode ? <p className="mt-1 text-xs text-rose-300">Code: {errorCode}</p> : null}
            {errorCode === 'certificate_unknown' && certificateFingerprint ? (
              <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/70 p-3">
                <div className="text-xs font-semibold text-slate-300">TLS certificate fingerprint</div>
                <div className="mt-2 break-all font-mono text-[11px] leading-5 text-slate-400" title={certificateFingerprint}>
                  {certificateFingerprint}
                </div>
                <Button className="mt-3" disabled={isConnecting} size="sm" onClick={onTrustCertificate}>
                  Trust and reconnect
                </Button>
              </div>
            ) : null}
            {errorCode === 'certificate_mismatch' ? (
              <div className="mt-3 rounded-md border border-rose-500/25 bg-rose-950/20 p-3">
                <div className="text-xs font-semibold text-rose-200">Trusted certificate changed</div>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  Only reset trust if you verified this server certificate change is expected.
                </p>
                <Button className="mt-3" disabled={isConnecting} size="sm" variant="secondary" onClick={onForgetCertificate}>
                  Forget trusted certificate
                </Button>
              </div>
            ) : null}
          </div>

          {needsPassword ? (
            <div className="grid gap-2">
              <label className="text-xs font-semibold text-slate-400">Password</label>
              <div className="flex gap-2">
                <input
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-slate-100 outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  type="password"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      onPasswordSubmit();
                    }
                  }}
                />
                <Button disabled={!password || isConnecting} onClick={onPasswordSubmit}>
                  Connect
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
