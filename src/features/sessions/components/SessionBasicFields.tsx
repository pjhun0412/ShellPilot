import type { UseFormReturn } from 'react-hook-form';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SessionGroup } from '@/types/workspace';
import type { CreateSessionInput } from '../session.schema';
import { SessionField } from './SessionField';

const NO_GROUP_VALUE = '__none__';

export function SessionBasicFields({
  authMethod,
  existingGroups,
  form,
  groupId,
}: {
  authMethod: CreateSessionInput['authMethod'];
  existingGroups: SessionGroup[];
  form: UseFormReturn<CreateSessionInput>;
  groupId: string | undefined;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <SessionField label="Name" error={form.formState.errors.name?.message}>
        <input className="session-input" {...form.register('name')} />
      </SessionField>
      <SessionField label="Group" error={form.formState.errors.groupId?.message}>
        <Select
          value={groupId || NO_GROUP_VALUE}
          onValueChange={(value) =>
            form.setValue('groupId', value === NO_GROUP_VALUE ? '' : value, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_GROUP_VALUE}>No group</SelectItem>
            {existingGroups.map((group) => (
              <SelectItem key={group.id} value={group.id}>
                {group.name}
              </SelectItem>
            ))}
            <SelectItem value="__new__">+ New group</SelectItem>
          </SelectContent>
        </Select>
      </SessionField>
      {groupId === '__new__' && (
        <SessionField label="New Group" error={form.formState.errors.newGroupName?.message}>
          <input
            className="session-input"
            {...form.register('newGroupName')}
            placeholder="Production"
          />
        </SessionField>
      )}
      <SessionField label="Host" error={form.formState.errors.host?.message}>
        <input className="session-input" {...form.register('host')} />
      </SessionField>
      <SessionField label="Port" error={form.formState.errors.port?.message}>
        <input
          className="session-input"
          type="number"
          {...form.register('port', { valueAsNumber: true })}
        />
      </SessionField>
      <SessionField label="Username" error={form.formState.errors.username?.message}>
        <input className="session-input" {...form.register('username')} />
      </SessionField>
      <SessionField label="Auth Method" error={form.formState.errors.authMethod?.message}>
        <Select
          value={authMethod}
          onValueChange={(value) =>
            form.setValue('authMethod', value as CreateSessionInput['authMethod'], {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="password">Password</SelectItem>
            <SelectItem value="key">SSH Key</SelectItem>
            <SelectItem value="agent">SSH Agent</SelectItem>
            <SelectItem value="interactive">Interactive</SelectItem>
          </SelectContent>
        </Select>
      </SessionField>
      <SessionField className="col-span-2" label="Tags" error={form.formState.errors.tags?.message}>
        <input className="session-input" {...form.register('tags')} placeholder="web, linux" />
      </SessionField>
    </div>
  );
}
