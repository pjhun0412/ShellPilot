import { zodResolver } from '@hookform/resolvers/zod';
import { FileKey, ShieldCheck } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SessionGroup, SessionItem } from '@/types/workspace';
import {
  createCredentialRef,
  createCredentialLabel,
  createPendingCredentialSecret,
  getCredentialMemoryRule,
  type PendingCredentialSecret,
} from '../session.security';
import { createSessionSchema, type CreateSessionInput } from '../session.schema';

const defaultValues: CreateSessionInput = {
  kind: 'ssh',
  name: '',
  groupId: '',
  newGroupName: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  secret: '',
  privateKeyPath: '',
  passphrase: '',
  saveCredential: true,
  tags: '',
  favorite: false,
};

export interface CreateSessionResult {
  groupName?: string;
  secret?: PendingCredentialSecret;
  session: SessionItem;
}

export function CreateSessionDialog({
  existingGroups,
  initialGroupId,
  initialSession,
  onCreateSession,
  onOpenChange,
  open,
}: {
  existingGroups: SessionGroup[];
  initialGroupId?: string;
  initialSession?: SessionItem;
  onCreateSession: (result: CreateSessionResult) => Promise<void> | void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const form = useForm<CreateSessionInput>({
    resolver: zodResolver(createSessionSchema),
    defaultValues,
  });
  const kind = form.watch('kind');
  const authMethod = form.watch('authMethod');
  const groupId = form.watch('groupId');

  useEffect(() => {
    if (open) {
      form.reset(getFormValues({ initialGroupId, initialSession }));
    }
  }, [form, initialGroupId, initialSession, open]);

  useEffect(() => {
    const currentPort = form.getValues('port');

    if (kind === 'ssh' && (!currentPort || currentPort === 3389)) {
      form.setValue('port', 22);
    }

    if (kind === 'rdp' && (!currentPort || currentPort === 22)) {
      form.setValue('port', 3389);
    }
  }, [form, kind]);

  const submit = async (input: CreateSessionInput) => {
    const timestamp = Date.now();
    const sessionId = initialSession?.id ?? `${input.kind}-${crypto.randomUUID()}`;
    const selectedGroupId = input.groupId === '__new__' ? undefined : input.groupId || undefined;
    const newGroupName = input.groupId === '__new__' ? input.newGroupName?.trim() : undefined;
    const tags = input.tags
      ?.split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const credentialRef = createCredentialRef({
      authMethod: input.authMethod,
      label: createCredentialLabel(input),
      sessionId,
    });
    const secret = createPendingCredentialSecret({ input, sessionId });
    const sessionCredentialRef =
      secret?.shouldSave || initialSession?.credentialRef ? credentialRef ?? initialSession?.credentialRef : undefined;

    await onCreateSession({
      groupName: newGroupName,
      secret,
      session: {
        id: sessionId,
        name: input.name,
        kind: input.kind,
        status: initialSession?.status ?? 'unknown',
        groupId: selectedGroupId,
        host: input.host || undefined,
        port: input.port,
        username: input.username || undefined,
        authMethod: input.authMethod,
        credentialRef: sessionCredentialRef,
        favorite: Boolean(input.favorite),
        tags,
        createdAt: initialSession?.createdAt ?? timestamp,
        updatedAt: timestamp,
      },
    });
    form.reset(defaultValues);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initialSession ? 'Edit Session' : 'Create Session'}</DialogTitle>
          <DialogDescription>
            {initialSession
              ? 'Update connection metadata. Existing secrets stay in the backend credential store.'
              : 'Register connection metadata now. Secrets will be stored by the backend credential store, not in Session data.'}
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-4" onSubmit={form.handleSubmit(submit)}>
          <div className="grid grid-cols-5 gap-2">
            {(['ssh', 'rdp', 'local', 'docker', 'wsl'] as const).map((sessionKind) => (
              <button
                className={[
                  'rounded-md border px-2 py-2 text-xs transition-colors',
                  kind === sessionKind
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                ].join(' ')}
                type="button"
                key={sessionKind}
                onClick={() => form.setValue('kind', sessionKind)}
              >
                {sessionKind.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Name" error={form.formState.errors.name?.message}>
              <input className="session-input" {...form.register('name')} placeholder="Web-01" />
            </Field>
            <Field label="Group" error={form.formState.errors.groupId?.message}>
              <select className="session-input" {...form.register('groupId')}>
                <option value="">No group</option>
                {existingGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
                <option value="__new__">+ New group</option>
              </select>
            </Field>
            {groupId === '__new__' && (
              <Field label="New Group" error={form.formState.errors.newGroupName?.message}>
                <input
                  className="session-input"
                  {...form.register('newGroupName')}
                  placeholder="Production"
                />
              </Field>
            )}
            <Field label="Host" error={form.formState.errors.host?.message}>
              <input className="session-input" {...form.register('host')} placeholder="10.10.0.21" />
            </Field>
            <Field label="Port" error={form.formState.errors.port?.message}>
              <input
                className="session-input"
                type="number"
                {...form.register('port', { valueAsNumber: true })}
              />
            </Field>
            <Field label="Username" error={form.formState.errors.username?.message}>
              <input className="session-input" {...form.register('username')} placeholder="deploy" />
            </Field>
            <Field label="Auth Method" error={form.formState.errors.authMethod?.message}>
              <select className="session-input" {...form.register('authMethod')}>
                <option value="password">Password</option>
                <option value="key">SSH Key</option>
                <option value="agent">SSH Agent</option>
                <option value="interactive">Interactive</option>
              </select>
            </Field>
            <Field label="Tags" error={form.formState.errors.tags?.message}>
              <input className="session-input" {...form.register('tags')} placeholder="web, linux" />
            </Field>
          </div>

          <AuthFields authMethod={authMethod} form={form} />

          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input className="accent-primary" type="checkbox" {...form.register('favorite')} />
            Add to favorites
          </label>

          <div className="flex gap-2 rounded-md border bg-background/70 p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{getCredentialMemoryRule()}</span>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{initialSession ? 'Save Changes' : 'Create Session'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function getFormValues({
  initialGroupId,
  initialSession,
}: {
  initialGroupId?: string;
  initialSession?: SessionItem;
}): CreateSessionInput {
  if (!initialSession) {
    return {
      ...defaultValues,
      groupId: initialGroupId ?? '',
    };
  }

  return {
    kind: initialSession.kind === 'sftp' ? 'ssh' : initialSession.kind,
    name: initialSession.name,
    groupId: initialSession.groupId ?? '',
    newGroupName: '',
    host: initialSession.host ?? '',
    port: initialSession.port ?? (initialSession.kind === 'rdp' ? 3389 : 22),
    username: initialSession.username ?? '',
    authMethod: initialSession.authMethod === 'os-credential' ? 'password' : initialSession.authMethod ?? 'password',
    secret: '',
    privateKeyPath: '',
    passphrase: '',
    saveCredential: true,
    tags: initialSession.tags?.join(', ') ?? '',
    favorite: Boolean(initialSession.favorite),
  };
}

function AuthFields({
  authMethod,
  form,
}: {
  authMethod: CreateSessionInput['authMethod'];
  form: UseFormReturn<CreateSessionInput>;
}) {
  if (authMethod === 'agent' || authMethod === 'interactive') {
    return (
      <div className="rounded-md border bg-background/70 p-3 text-xs text-muted-foreground">
        {authMethod === 'agent'
          ? 'SSH Agent will provide credentials at connection time.'
          : 'Interactive authentication will ask for credentials only when connecting.'}
      </div>
    );
  }

  if (authMethod === 'key') {
    return (
      <div className="grid grid-cols-2 gap-3 rounded-md border bg-background/60 p-3">
        <Field label="Private Key Path" error={form.formState.errors.privateKeyPath?.message}>
          <div className="grid grid-cols-[minmax(0,1fr)_2rem] gap-2">
            <input
              className="session-input"
              {...form.register('privateKeyPath')}
              placeholder="C:\\Users\\me\\.ssh\\id_rsa"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              title="Tauri file picker will be connected through @tauri-apps/plugin-dialog."
            >
              <FileKey />
            </Button>
          </div>
        </Field>
        <Field label="Passphrase" error={form.formState.errors.passphrase?.message}>
          <input
            className="session-input"
            type="password"
            autoComplete="new-password"
            {...form.register('passphrase')}
            placeholder="Optional"
          />
        </Field>
        <SaveCredentialField form={form} label="Save key passphrase" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border bg-background/60 p-3">
      <Field label="Password" error={form.formState.errors.secret?.message}>
        <input
          className="session-input"
          type="password"
          autoComplete="new-password"
          {...form.register('secret')}
          placeholder="Stored by backend credential store"
        />
      </Field>
      <SaveCredentialField form={form} label="Save password" />
    </div>
  );
}

function SaveCredentialField({
  form,
  label,
}: {
  form: UseFormReturn<CreateSessionInput>;
  label: string;
}) {
  return (
    <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
      <input className="accent-primary" type="checkbox" {...form.register('saveCredential')} />
      {label}
    </label>
  );
}

function Field({
  children,
  error,
  label,
}: {
  children: ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}
