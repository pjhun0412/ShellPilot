import { appConfirm } from '@/components/ui/app-dialog';

import { normalizeSshCommand } from './sshSessionTools';

const SENSITIVE_COMMAND_PATTERN =
  /\b(pass(word)?|passwd|passphrase|secret|token|api[_-]?key|authorization|bearer)\b|(?:^|\s)(?:-p|--password)(?:=|\s+)\S+/i;

export function getSensitiveSshCommandWarning(command: string) {
  const normalizedCommand = normalizeSshCommand(command);

  if (!normalizedCommand || !SENSITIVE_COMMAND_PATTERN.test(normalizedCommand)) {
    return undefined;
  }

  return 'This command looks like it may contain a password, token, API key, or Authorization header. Command snippets are saved with the session metadata, so avoid storing secrets here.';
}

export async function confirmSshCommandSnippetSave(command: string) {
  const warning = getSensitiveSshCommandWarning(command);

  if (!warning) {
    return true;
  }

  return appConfirm({
    cancelLabel: 'Cancel',
    confirmLabel: 'Save anyway',
    message: warning,
    title: 'Sensitive command snippet',
    tone: 'danger',
  });
}
