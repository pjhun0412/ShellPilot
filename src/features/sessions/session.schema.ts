import { z } from 'zod';

export const sessionKinds = ['ssh', 'rdp', 'local', 'docker', 'wsl'] as const;
export const authMethods = ['password', 'key', 'agent', 'interactive', 'os-credential'] as const;

export const createSessionSchema = z.object({
  kind: z.enum(sessionKinds),
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
  groupId: z.string().trim().optional(),
  newGroupName: z.string().trim().max(80, 'Group name is too long').optional(),
  host: z.string().trim().max(255, 'Host is too long').optional(),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().max(80, 'Username is too long').optional(),
  authMethod: z.enum(authMethods),
  secret: z.string().optional(),
  privateKeyPath: z.string().trim().max(500, 'Private key path is too long').optional(),
  passphrase: z.string().optional(),
  saveCredential: z.boolean().optional(),
  tags: z.string().trim().optional(),
  favorite: z.boolean().optional(),
}).superRefine((input, context) => {
  if ((input.kind === 'ssh' || input.kind === 'rdp') && !input.host?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Host is required',
      path: ['host'],
    });
  }

  if (input.groupId === '__new__' && !input.newGroupName?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'New group name is required',
      path: ['newGroupName'],
    });
  }

  if (input.authMethod === 'key' && !input.privateKeyPath?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Private key path is required',
      path: ['privateKeyPath'],
    });
  }
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
