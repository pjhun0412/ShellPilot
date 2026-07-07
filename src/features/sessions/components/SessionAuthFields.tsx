import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FileKey } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import type { CreateSessionInput } from '../session.schema';
import { SessionField } from './SessionField';

export function SessionAuthFields({
  authMethod,
  form,
}: {
  authMethod: CreateSessionInput['authMethod'];
  form: UseFormReturn<CreateSessionInput>;
}) {
  const selectPrivateKey = async () => {
    try {
      const selectedPath = await openDialog({
        directory: false,
        multiple: false,
        title: 'Select SSH private key',
      });

      if (typeof selectedPath === 'string') {
        form.setValue('privateKeyPath', selectedPath, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    } catch (error) {
      console.error('Failed to select SSH private key', error);
    }
  };

  if (authMethod === 'agent') {
    return (
      <div className="rounded-md border border-slate-800 bg-background/70 p-3 text-xs font-medium leading-5 text-slate-300">
        SSH Agent will provide identities at connection time. Make sure OpenSSH Agent or Pageant is running and has a key loaded.
      </div>
    );
  }

  if (authMethod === 'key') {
    return (
      <div className="grid grid-cols-2 gap-3 rounded-md border border-slate-800 bg-background/70 p-3 pb-4">
        <SessionField
          label="Private Key Path"
          error={form.formState.errors.privateKeyPath?.message}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_2rem] gap-2">
            <input
              className="session-input bg-black/55"
              {...form.register('privateKeyPath')}
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              aria-label="Select SSH private key"
              title="Select SSH private key"
              onClick={selectPrivateKey}
            >
              <FileKey />
            </Button>
          </div>
        </SessionField>
        <SessionField label="Passphrase" error={form.formState.errors.passphrase?.message}>
          <input
            className="session-input bg-black/55"
            type="password"
            autoComplete="new-password"
            {...form.register('passphrase')}
          />
        </SessionField>
        <p className="col-span-2 text-xs font-medium leading-5 text-slate-400">
          The private key file path is stored in session metadata. The passphrase is stored only in the backend credential store when saving is enabled.
        </p>
        <SaveCredentialField form={form} label="Save key passphrase" />
      </div>
    );
  }

  const passwordLabel = authMethod === 'interactive' ? 'Initial Response' : 'Password';
  const saveLabel = authMethod === 'interactive' ? 'Save initial response' : 'Save password';
  const placeholder =
    authMethod === 'interactive'
      ? 'Stored by backend credential store'
      : 'Stored by backend credential store';

  return (
    <div className="grid grid-cols-2 gap-3 rounded-md border border-slate-800 bg-background/70 p-3 pb-4">
      <SessionField label={passwordLabel} error={form.formState.errors.secret?.message}>
        <input
          className="session-input bg-black/55"
          type="password"
          autoComplete="new-password"
          {...form.register('secret')}
          placeholder={placeholder}
        />
      </SessionField>
      <SaveCredentialField form={form} label={saveLabel} />
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
    <label className="col-span-2 mb-0.5 flex items-center gap-2 text-xs font-medium text-slate-300">
      <input className="accent-primary" type="checkbox" {...form.register('saveCredential')} />
      {label}
    </label>
  );
}
