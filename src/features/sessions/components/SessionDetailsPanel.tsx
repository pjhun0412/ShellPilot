import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { useEffect, useState, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { requestSessionPatch } from '@/features/sessions/sessionStorage';
import type { SessionGroup, SessionItem } from '@/types/workspace';

const MIN_PANEL_HEIGHT = 120;
const MAX_PANEL_HEIGHT = 360;
const COLLAPSED_PANEL_HEIGHT = 34;

interface SessionDetailsPanelProps {
  groupId?: string;
  groups: SessionGroup[];
  isCollapsed: boolean;
  onChangeGroup: (session: SessionItem, groupId: string) => void;
  onEditAdvanced: (session: SessionItem) => void;
  onOpenSession: (session: SessionItem) => void;
  onResize: (height: number) => void;
  onToggleCollapsed: () => void;
  panelHeight: number;
  session?: SessionItem;
}

interface SessionDetailsDraft {
  description: string;
  host: string;
  kind: SessionItem['kind'];
  name: string;
  port: string;
  username: string;
}

type AutoSaveStatus = 'idle' | 'saved' | 'saving';

export function SessionDetailsPanel({
  groupId,
  groups,
  isCollapsed,
  onChangeGroup,
  onEditAdvanced,
  onOpenSession,
  onResize,
  onToggleCollapsed,
  panelHeight,
  session,
}: SessionDetailsPanelProps) {
  const [draft, setDraft] = useState<SessionDetailsDraft>(() => createDraft(session));
  const [draftSessionId, setDraftSessionId] = useState(session?.id);
  const [error, setError] = useState<string>();
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');

  useEffect(() => {
    setDraft(createDraft(session));
    setDraftSessionId(session?.id);
    setError(undefined);
    setAutoSaveStatus('idle');
  }, [session?.id]);

  const hasDraftChanges = session ? isDraftChanged(session, draft) : false;

  useEffect(() => {
    if (!session || draftSessionId !== session.id || !hasDraftChanges) {
      return;
    }

    const result = createPatchFromDraft(session, draft);

    if ('error' in result) {
      setError(result.error);
      setAutoSaveStatus('idle');
      return;
    }

    setError(undefined);
    setAutoSaveStatus('saving');

    const saveTimer = window.setTimeout(() => {
      requestSessionPatch({
        patch: result.patch,
        sessionId: session.id,
      });
      setAutoSaveStatus('saved');
    }, 650);

    return () => window.clearTimeout(saveTimer);
  }, [draft, draftSessionId, hasDraftChanges, session]);

  useEffect(() => {
    if (autoSaveStatus !== 'saved') {
      return;
    }

    const resetTimer = window.setTimeout(() => setAutoSaveStatus('idle'), 1600);

    return () => window.clearTimeout(resetTimer);
  }, [autoSaveStatus]);

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panelHeight;

    const resize = (moveEvent: PointerEvent) => {
      onResize(clampPanelHeight(startHeight - (moveEvent.clientY - startY)));
    };
    const finishResize = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', finishResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', finishResize, { once: true });
  };

  const bodyHeight = isCollapsed ? COLLAPSED_PANEL_HEIGHT : panelHeight;

  return (
    <section
      className="shrink-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950/45"
      style={{ height: bodyHeight }}
      aria-label="Session details"
    >
      {!isCollapsed && (
        <div
          className="h-1.5 cursor-ns-resize border-b border-slate-800/70 bg-slate-900/70 hover:bg-teal-500/30"
          role="separator"
          aria-orientation="horizontal"
          title="Resize details"
          onPointerDown={startResize}
        />
      )}
      <div className="flex h-8 items-center gap-2 border-b border-slate-800 px-2">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-200">
          {session ? session.name : 'Session Details'}
        </span>
        <AutoSaveIndicator status={autoSaveStatus} />
        <button
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          type="button"
          aria-label={isCollapsed ? 'Expand session details' : 'Collapse session details'}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          onClick={onToggleCollapsed}
        >
          {isCollapsed ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>
      {!isCollapsed && (
        <OverlayScrollArea className="p-2" containerClassName="h-[calc(100%-2.375rem)]">
          {!session ? (
            <div className="grid h-full place-items-center rounded border border-dashed border-slate-800 px-3 text-center text-xs text-slate-500">
              Select a session to view or edit basic connection info.
            </div>
          ) : (
            <div className="grid gap-2">
              <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] overflow-hidden rounded border border-slate-800 text-[11px]">
                <EditableRow
                  label="Name"
                  value={draft.name}
                  onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
                />
                <SelectRow
                  label="Group"
                  value={groupId}
                  options={groups.map((group) => ({ label: group.name, value: group.id }))}
                  onChange={(value) => onChangeGroup(session, value)}
                />
                <SelectRow
                  label="Protocol"
                  value={draft.kind}
                  options={getProtocolOptions(draft.kind)}
                  onChange={(value) =>
                    setDraft((current) => ({ ...current, kind: value as SessionItem['kind'] }))
                  }
                />
                <EditableRow
                  label="Host"
                  value={draft.host}
                  onChange={(value) => setDraft((current) => ({ ...current, host: value }))}
                />
                <EditableRow
                  label="Port"
                  value={draft.port}
                  placeholder={String(getDefaultPort(draft.kind) ?? '')}
                  inputMode="numeric"
                  onChange={(value) => setDraft((current) => ({ ...current, port: value }))}
                />
                <EditableRow
                  label="User"
                  value={draft.username}
                  onChange={(value) => setDraft((current) => ({ ...current, username: value }))}
                />
                <EditableRow
                  label="Memo"
                  value={draft.description}
                  onChange={(value) => setDraft((current) => ({ ...current, description: value }))}
                />
              </div>
              {error && <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">{error}</div>}
              <div className="flex flex-wrap gap-1.5">
                <DetailsButton tone="primary" width="equal" onClick={() => onOpenSession(session)}>
                  <ExternalLink className="size-3" />
                  Open
                </DetailsButton>
                <DetailsButton width="equal" onClick={() => onEditAdvanced(session)}>Advanced</DetailsButton>
              </div>
            </div>
          )}
        </OverlayScrollArea>
      )}
    </section>
  );
}

function AutoSaveIndicator({ status }: { status: AutoSaveStatus }) {
  if (status === 'idle') {
    return null;
  }

  return (
    <span
      className={[
        'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold',
        status === 'saving'
          ? 'border-slate-800 bg-slate-950/50 text-slate-400'
          : 'border-teal-400/30 bg-teal-500/10 text-teal-200',
      ].join(' ')}
    >
      {status === 'saving' ? 'Saving' : 'Saved'}
    </span>
  );
}

export function clampSessionDetailsPanelHeight(height: number) {
  return clampPanelHeight(height);
}

function EditableRow({
  inputMode,
  label,
  onChange,
  placeholder,
  value,
}: {
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <>
      <label className="border-b border-r border-slate-800 bg-slate-900/65 px-2 py-1 font-medium text-slate-500">
        {label}
      </label>
      <input
        className="min-w-0 border-b border-slate-800 bg-transparent px-2 py-1 text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:bg-slate-900/70 focus:text-teal-100"
        inputMode={inputMode}
        placeholder={placeholder || '-'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}

function SelectRow({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value?: string;
}) {
  return (
    <>
      <label className="border-b border-r border-slate-800 bg-slate-900/65 px-2 py-1 font-medium text-slate-500">
        {label}
      </label>
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger
          className="h-auto min-w-0 rounded-none border-0 border-b border-slate-800 bg-transparent px-2 py-1 text-[11px] text-slate-100 shadow-none focus:border-slate-800 focus:shadow-none"
          aria-label={label}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem className="text-xs" key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function DetailsButton({
  children,
  onClick,
  tone = 'default',
  width,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: 'default' | 'primary';
  width?: 'equal';
}) {
  return (
    <button
      className={[
        'inline-flex h-7 items-center justify-center gap-1 rounded border px-2 text-[11px] font-semibold transition-colors',
        width === 'equal' ? 'min-w-20' : '',
        tone === 'primary'
          ? 'border-teal-400/70 bg-teal-500 text-slate-950 hover:bg-teal-400'
          : 'border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700 hover:bg-slate-900 hover:text-slate-100',
      ].join(' ')}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function createDraft(session?: SessionItem): SessionDetailsDraft {
  return {
    description: getDescription(session),
    host: session?.host ?? '',
    kind: session?.kind ?? 'ssh',
    name: session?.name ?? '',
    port: session?.port ? String(session.port) : '',
    username: session?.username ?? '',
  };
}

function isDraftChanged(session: SessionItem, draft: SessionDetailsDraft) {
  return (
    draft.description !== getDescription(session) ||
    draft.host !== (session.host ?? '') ||
    draft.kind !== session.kind ||
    draft.name !== session.name ||
    draft.port !== (session.port ? String(session.port) : '') ||
    draft.username !== (session.username ?? '')
  );
}

function createPatchFromDraft(session: SessionItem, draft: SessionDetailsDraft) {
  const name = draft.name.trim();
  const host = draft.host.trim();
  const username = draft.username.trim();
  const portText = draft.port.trim();
  const port = portText.length > 0 ? Number(portText) : undefined;

  if (!name) {
    return { error: 'Name is required.' };
  }

  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    return { error: 'Port must be between 1 and 65535.' };
  }

  return {
    patch: {
      host: host || undefined,
      kind: draft.kind,
      metadata: updateDescription(session.metadata, draft.description),
      name,
      port,
      username: username || undefined,
    },
  };
}

function getDescription(session?: SessionItem) {
  const description = session?.metadata?.description;

  return typeof description === 'string' ? description : '';
}

function updateDescription(metadata: SessionItem['metadata'], description: string) {
  const nextMetadata = { ...(metadata ?? {}) };
  const trimmedDescription = description.trim();

  if (trimmedDescription) {
    nextMetadata.description = trimmedDescription;
  } else {
    delete nextMetadata.description;
  }

  return Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
}

function getProtocolOptions(currentKind: SessionItem['kind']) {
  const options: Array<{ label: string; value: SessionItem['kind'] }> = [
    { label: 'SSH', value: 'ssh' },
    { label: 'SFTP', value: 'sftp' },
    { label: 'RDP', value: 'rdp' },
    { label: 'VNC', value: 'vnc' },
    { label: 'FTP', value: 'ftp' },
  ];

  if (!options.some((option) => option.value === currentKind)) {
    return [{ label: currentKind.toUpperCase(), value: currentKind }, ...options];
  }

  return options;
}

function getDefaultPort(kind: SessionItem['kind']) {
  if (kind === 'ssh' || kind === 'sftp') {
    return 22;
  }

  if (kind === 'ftp') {
    return 21;
  }

  if (kind === 'rdp') {
    return 3389;
  }

  if (kind === 'vnc') {
    return 5900;
  }

  return undefined;
}

function clampPanelHeight(height: number) {
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(height)));
}
