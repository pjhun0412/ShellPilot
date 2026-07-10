import { Button } from '@/components/ui/button';
import type { SessionItem } from '@/types/workspace';
import {
  getSshFailureTitle,
  shouldPromptSecret,
  shouldPromptUsername,
  type SshTerminalFailure,
} from './sshTerminalUi';

export function SshRestoredCard({ onReconnect }: { onReconnect: () => void }) {
  return (
    <TerminalOverlayCard title="SSH session restored">
      <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
        Terminal output was not restored. Reconnect to open a new SSH session.
      </span>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" type="button" onClick={onReconnect}>
          Reconnect
        </Button>
      </div>
    </TerminalOverlayCard>
  );
}

export function SshClosedCard({ onReconnect }: { onReconnect: () => void }) {
  return (
    <TerminalOverlayCard title="SSH session disconnected">
      <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
        The SSH connection is closed. Reconnect to open a new shell session.
      </span>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" type="button" onClick={onReconnect}>
          Reconnect
        </Button>
      </div>
    </TerminalOverlayCard>
  );
}

export function SshFailureCard({
  failure,
  manualPassword,
  manualUsername,
  onManualPasswordChange,
  onManualUsernameChange,
  onReconnect,
  onResetKnownHost,
  onSubmit,
  onTrustHostKey,
  onToggleRememberPassword,
  onToggleRememberUsername,
  secretLabel,
  session,
  shouldRememberPassword,
  shouldRememberUsername,
}: {
  failure: SshTerminalFailure;
  manualPassword: string;
  manualUsername: string;
  onManualPasswordChange: (value: string) => void;
  onManualUsernameChange: (value: string) => void;
  onReconnect: () => void;
  onResetKnownHost: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onTrustHostKey: () => void;
  onToggleRememberPassword: (value: boolean) => void;
  onToggleRememberUsername: (value: boolean) => void;
  secretLabel: string;
  session: SessionItem;
  shouldRememberPassword: boolean;
  shouldRememberUsername: boolean;
}) {
  const needsUsername = shouldPromptUsername(failure.code, session);
  const needsSecret = shouldPromptSecret(failure.code, session);

  return (
    <form
      className="absolute left-1/2 top-1/2 grid w-[min(28rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg"
      onSubmit={onSubmit}
    >
      <span className="font-medium text-slate-100">{getSshFailureTitle(failure.code)}</span>
      <span className="whitespace-pre-wrap break-words text-slate-300 [overflow-wrap:anywhere]">
        {failure.message}
      </span>
      {failure.authPrompt ? (
        <>
          <div className="grid gap-2">
            {needsUsername && (
              <input
                className="session-input h-8"
                type="text"
                autoComplete="username"
                placeholder="SSH username"
                value={manualUsername}
                onChange={(event) => onManualUsernameChange(event.target.value)}
              />
            )}
            {needsSecret && (
              <input
                className="session-input h-8"
                type="password"
                autoComplete="current-password"
                placeholder={
                  session.authMethod === 'key'
                    ? 'SSH key passphrase'
                    : session.authMethod === 'interactive'
                      ? 'Interactive response'
                      : 'SSH password'
                }
                value={manualPassword}
                onChange={(event) => onManualPasswordChange(event.target.value)}
              />
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              type="submit"
              disabled={(needsUsername && !manualUsername.trim()) || (needsSecret && !manualPassword)}
            >
              Connect
            </Button>
          </div>
          {needsUsername && (
            <label className="flex items-center gap-2 text-muted-foreground">
              <input
                className="accent-primary"
                type="checkbox"
                checked={shouldRememberUsername}
                onChange={(event) => onToggleRememberUsername(event.target.checked)}
              />
              Remember username for this session
            </label>
          )}
          {needsSecret && (
            <label className="flex items-center gap-2 text-muted-foreground">
              <input
                className="accent-primary"
                type="checkbox"
                checked={shouldRememberPassword}
                onChange={(event) => onToggleRememberPassword(event.target.checked)}
              />
              Remember {secretLabel} securely
            </label>
          )}
        </>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          {failure.code === 'host_key_unknown' && (
            <Button size="sm" type="button" onClick={onTrustHostKey}>
              Trust & Connect
            </Button>
          )}
          {failure.code === 'host_key_mismatch' && (
            <Button size="sm" type="button" variant="secondary" onClick={onResetKnownHost}>
              Reset Host Key
            </Button>
          )}
          <Button
            size="sm"
            type="button"
            variant={failure.retryable && failure.code !== 'host_key_unknown' ? 'default' : 'secondary'}
            onClick={onReconnect}
            disabled={!failure.retryable || failure.code === 'host_key_unknown'}
          >
            Reconnect
          </Button>
        </div>
      )}
    </form>
  );
}

function TerminalOverlayCard({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="absolute left-1/2 top-1/2 grid w-[min(24rem,calc(100%-1rem))] min-w-0 -translate-x-1/2 -translate-y-1/2 gap-2 overflow-hidden rounded-md border bg-card/95 p-3 text-xs shadow-lg">
      <span className="font-medium text-slate-100">{title}</span>
      {children}
    </div>
  );
}
