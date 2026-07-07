import { invoke } from '@tauri-apps/api/core';

import { forgetCredentialPassword, rememberCredentialPassword } from '@/features/connections/sshConnection';
import type { CredentialRef } from '@/types/workspace';
import type { PendingCredentialSecret } from './session.security';

export async function savePendingCredentialSecret(secret: PendingCredentialSecret) {
  if (!secret.shouldSave) {
    return;
  }

  if (secret.kind === 'password') {
    await invoke('save_credential', {
      id: secret.credentialRef.id,
      secret: secret.secret,
    });
    rememberCredentialPassword(secret.credentialRef.id, secret.secret);
    return;
  }

  if (secret.passphrase) {
    await invoke('save_credential', {
      id: secret.credentialRef.id,
      secret: secret.passphrase,
    });
  }
}

export async function deleteStoredCredential(credentialRef?: CredentialRef) {
  if (!credentialRef) {
    return;
  }

  forgetCredentialPassword(credentialRef.id);

  await invoke('delete_credential', {
    id: credentialRef.id,
  });
}
