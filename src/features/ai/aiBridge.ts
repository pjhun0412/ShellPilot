import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import {
  resolveKeyCredentialRef,
  resolvePasswordCredentialRef,
} from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';

export interface AiProviderInfo {
  available: boolean;
  command: string;
  id: 'claude-cli' | 'codex-cli' | string;
  label: string;
  message?: string;
  version?: string;
}

export interface AiPromptRequest {
  context?: string;
  panelId?: string;
  prompt: string;
  providerId: string;
  runId?: string;
}

export interface AiPromptResponse {
  output: string;
}

export interface AiPromptStreamEvent {
  data?: string;
  message?: string;
  panelId: string;
  runId: string;
  status: 'started' | 'data' | 'stderr' | 'completed' | 'failed' | string;
}

export interface RemoteCommandResult {
  exitCode?: number;
  stderr: string;
  stdout: string;
}

export async function listAiProviders() {
  return invoke<AiProviderInfo[]>('ai_list_providers');
}

export async function runAiPrompt(request: AiPromptRequest) {
  return invoke<AiPromptResponse>('ai_run_prompt', { request });
}

export async function runAiPromptStream(request: Required<Pick<AiPromptRequest, 'panelId' | 'prompt' | 'providerId' | 'runId'>> & Pick<AiPromptRequest, 'context'>) {
  return invoke<void>('ai_run_prompt_stream', { request });
}

export function listenAiPromptEvents(listener: (event: AiPromptStreamEvent) => void): Promise<UnlistenFn> {
  return listen<AiPromptStreamEvent>('shellpilot-ai-prompt', (event) => listener(event.payload));
}

export async function runReadonlyRemoteCommand(panelId: string, session: SessionItem, command: string) {
  return invoke<RemoteCommandResult>('ssh_run_readonly_command', {
    request: {
      command,
      target: createSshToolTarget(panelId, session),
    },
  });
}

function createSshToolTarget(panelId: string, session: SessionItem) {
  const privateKeyPath = typeof session.metadata?.privateKeyPath === 'string' ? session.metadata.privateKeyPath : null;
  const usesPasswordCredential =
    session.authMethod === 'password' ||
    session.authMethod === 'os-credential' ||
    session.authMethod === 'interactive' ||
    !session.authMethod;

  return {
    acceptNewHostKey: false,
    authMethod: session.authMethod ?? 'password',
    credentialId: usesPasswordCredential ? resolvePasswordCredentialRef(session).id : null,
    host: session.host,
    panelId,
    password: null,
    passphrase: null,
    passphraseCredentialId: session.authMethod === 'key' ? resolveKeyCredentialRef(session).id : null,
    port: session.port ?? 22,
    privateKeyPath,
    username: session.username?.trim() ?? '',
  };
}
