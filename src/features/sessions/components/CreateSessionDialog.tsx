import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { appConfirm } from '@/components/ui/app-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { OverlayScrollArea } from '@/components/ui/overlay-scroll-area';
import type { SessionGroup, SessionItem } from '@/types/workspace';
import { createSessionSchema, type CreateSessionInput } from '../session.schema';
import {
  buildCreateSessionResult,
  defaultSessionFormValues,
  getSessionFormValues,
  type CreateSessionResult,
} from '../sessionForm';
import { SessionAuthFields } from './SessionAuthFields';
import { SessionBasicFields } from './SessionBasicFields';
import { SessionKindSelector } from './SessionKindSelector';
import { SessionSecurityNotice } from './SessionSecurityNotice';

export type { CreateSessionResult } from '../sessionForm';

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
    defaultValues: defaultSessionFormValues,
  });
  const kind = form.watch('kind');
  const authMethod = form.watch('authMethod');
  const groupId = form.watch('groupId');
  const isDirty = form.formState.isDirty;

  useEffect(() => {
    if (open) {
      form.reset(getSessionFormValues({ initialGroupId, initialSession }));
    }
  }, [form, initialGroupId, initialSession, open]);

  useEffect(() => {
    const currentPort = form.getValues('port');
    const currentAuthMethod = form.getValues('authMethod');

    if (kind === 'ssh' && (!currentPort || currentPort === 3389 || currentPort === 5900)) {
      form.setValue('port', 22);
    }

    if (kind === 'sftp' && (!currentPort || currentPort === 21 || currentPort === 3389 || currentPort === 5900)) {
      form.setValue('port', 22);
    }

    if (kind === 'ftp' && (!currentPort || currentPort === 22 || currentPort === 3389 || currentPort === 5900)) {
      form.setValue('port', 21);
    }

    if (kind === 'rdp' && (!currentPort || currentPort === 22 || currentPort === 5900)) {
      form.setValue('port', 3389);
    }

    if (kind === 'vnc' && (!currentPort || currentPort === 22 || currentPort === 3389)) {
      form.setValue('port', 5900);
    }

    if ((kind === 'ftp' || kind === 'rdp' || kind === 'vnc') && currentAuthMethod !== 'password') {
      form.setValue('authMethod', 'password');
    }
  }, [form, kind]);

  const submit = async (input: CreateSessionInput) => {
    await onCreateSession(buildCreateSessionResult({ initialSession, input }));
    form.reset(defaultSessionFormValues);
    onOpenChange(false);
  };
  const requestClose = async () => {
    if (!isDirty) {
      onOpenChange(false);
      return;
    }

    const confirmed = await appConfirm({
      cancelLabel: 'Keep Editing',
      confirmLabel: 'Discard',
      message: 'You have unsaved session changes. Close this dialog and discard them?',
      title: 'Discard session changes?',
      tone: 'danger',
    });

    if (confirmed) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          onOpenChange(true);
          return;
        }

        void requestClose();
      }}
    >
      <DialogContent
        className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden p-0"
        onInteractOutside={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="px-5 pb-0 pt-5">
          <DialogTitle>{initialSession ? 'Edit Session' : 'Create Session'}</DialogTitle>
          <DialogDescription>
            {initialSession
              ? 'Update connection metadata. Existing secrets stay in the backend credential store.'
              : 'Register connection metadata now. Secrets will be stored by the backend credential store, not in Session data.'}
          </DialogDescription>
        </DialogHeader>

        <OverlayScrollArea>
          <form className="grid gap-4 px-5 pb-5 pt-0" onSubmit={form.handleSubmit(submit)}>
            <SessionKindSelector form={form} kind={kind} />
            <SessionBasicFields
              authMethod={authMethod}
              existingGroups={existingGroups}
              form={form}
              groupId={groupId}
            />
            <SessionAuthFields authMethod={authMethod} form={form} />

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input className="accent-primary" type="checkbox" {...form.register('favorite')} />
              Add to favorites
            </label>

            <SessionSecurityNotice />

            <DialogFooter>
              <Button
                className="text-muted-foreground shadow-none hover:text-foreground"
                type="button"
                variant="ghost"
                onClick={() => void requestClose()}
              >
                Cancel
              </Button>
              <Button type="submit">{initialSession ? 'Save Changes' : 'Create Session'}</Button>
            </DialogFooter>
          </form>
        </OverlayScrollArea>
      </DialogContent>
    </Dialog>
  );
}
