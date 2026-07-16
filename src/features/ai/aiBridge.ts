import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { createSshConnectionTarget } from '@/features/connections/sshTarget';
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
  timeoutSeconds?: number;
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
  error?: string;
  exitCode?: number;
  stderr: string;
  stdout: string;
}

export interface ReadonlyRemoteCommandRequest {
  command: string;
  workingDirectory?: string;
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

export async function cancelAiPrompt(runId: string) {
  return invoke<void>('ai_cancel_prompt', { runId });
}

export function listenAiPromptEvents(listener: (event: AiPromptStreamEvent) => void): Promise<UnlistenFn> {
  return listen<AiPromptStreamEvent>('shellpilot-ai-prompt', (event) => listener(event.payload));
}

export async function runReadonlyRemoteCommands(
  panelId: string,
  session: SessionItem,
  commands: Array<string | ReadonlyRemoteCommandRequest>,
) {
  const normalizedCommands = commands.map((command) =>
    typeof command === 'string' ? { command } : command,
  );

  return invoke<RemoteCommandResult[]>('ssh_run_readonly_commands', {
    request: {
      commands: normalizedCommands.map((command) => command.command),
      target: createSshToolTarget(panelId, session),
      workingDirectories: normalizedCommands.map((command) => command.workingDirectory ?? null),
    },
  });
}

function createSshToolTarget(panelId: string, session: SessionItem) {
  return createSshConnectionTarget(panelId, session, {
    acceptNewHostKey: false,
    validateUsername: false,
    validatePasswordCredential: false,
  });
}
