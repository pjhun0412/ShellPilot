import { invoke } from '@tauri-apps/api/core';

import { rememberCredentialPassword } from '@/features/connections/sshConnection';
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
