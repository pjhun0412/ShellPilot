import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { resolvePasswordCredentialRef } from '@/features/connections/sshConnection';
import type { SessionItem } from '@/types/workspace';

export type VncStatus = 'closed' | 'connected' | 'connecting' | 'failed' | 'frameReady';

export interface VncEvent {
  desktopHeight?: number;
  desktopWidth?: number;
  message?: string;
  panelId: string;
  retryable: boolean;
  status: VncStatus;
}

export type VncFrameEvent =
  | {
      data: string;
      height: number;
      kind: 'raw';
      panelId: string;
      sequence: number;
      width: number;
      x: number;
      y: number;
    }
  | {
      height: number;
      kind: 'copy';
      panelId: string;
      sequence: number;
      sourceX: number;
      sourceY: number;
      width: number;
      x: number;
      y: number;
    };

export interface LegacyVncFrameEvent {
  data?: string;
  height: number;
  kind?: 'copy' | 'raw';
  panelId: string;
  sequence: number;
  sourceX?: number;
  sourceY?: number;
  width: number;
  x: number;
  y: number;
}

export type VncInput =
  | { type: 'pointer'; x: number; y: number; buttons: number }
  | { type: 'key'; keysym: number; down: boolean }
  | { type: 'refresh'; full?: boolean };

interface QueuedInput {
  input: VncInput;
  reject: (error: unknown) => void;
  resolve: () => void;
}

interface InputBatch {
  inputs: QueuedInput[];
  timer: number | undefined;
}

const inputBatches = new Map<string, InputBatch>();
const inputDispatchQueues = new Map<string, Promise<void>>();

export class VncOpenError extends Error {
  readonly authPrompt: boolean;
  readonly retryable: boolean;

  constructor(message: string, options: { authPrompt?: boolean; retryable?: boolean } = {}) {
    super(message);
    this.name = 'VncOpenError';
    this.authPrompt = options.authPrompt ?? false;
    this.retryable = options.retryable ?? true;
  }
}

export async function openVncSession(
  panelId: string,
  session: SessionItem,
  options: { password?: string } = {},
) {
  const target = createVncTarget(panelId, session, options);

  await invoke('vnc_open', { target });
}

export async function closeVncSession(panelId: string) {
  await invoke('vnc_close', { panelId });
}

export async function sendVncInput(panelId: string, input: VncInput) {
  return new Promise<void>((resolve, reject) => {
    const batch = inputBatches.get(panelId) ?? { inputs: [], timer: undefined };

    batch.inputs.push({ input, reject, resolve });

    if (batch.timer == null) {
      batch.timer = window.setTimeout(() => flushVncInputBatch(panelId), 0);
    }

    inputBatches.set(panelId, batch);
  });
}

function flushVncInputBatch(panelId: string) {
  const batch = inputBatches.get(panelId);

  if (!batch) {
    return;
  }

  inputBatches.delete(panelId);

  const queuedInputs = batch.inputs;
  const inputs = queuedInputs.map(({ input }) => input);
  const previousDispatch = inputDispatchQueues.get(panelId) ?? Promise.resolve();

  const dispatch = previousDispatch
    .catch(() => undefined)
    .then(() => invoke('vnc_send_inputs', { panelId, inputs }))
    .then(() => {
      for (const queued of queuedInputs) {
        queued.resolve();
      }
    })
    .catch((error) => {
      for (const queued of queuedInputs) {
        queued.reject(error);
      }
    })
    .finally(() => {
      if (inputDispatchQueues.get(panelId) === dispatch) {
        inputDispatchQueues.delete(panelId);
      }
    });

  inputDispatchQueues.set(panelId, dispatch);
}

export async function listenVncEvents(listener: (event: VncEvent) => void): Promise<UnlistenFn> {
  return listen<VncEvent>('shellpilot-vnc', (event) => listener(event.payload));
}

export async function listenVncFrames(listener: (event: VncFrameEvent) => void): Promise<UnlistenFn> {
  return listenVncFrameBatches((frames) => {
    for (const frame of frames) {
      listener(frame);
    }
  });
}

export async function listenVncFrameBatches(listener: (events: VncFrameEvent[]) => void): Promise<UnlistenFn> {
  const unlistenFrame = await listen<LegacyVncFrameEvent>('shellpilot-vnc-frame', (event) => {
    const frame = normalizeVncFrameEvent(event.payload);

    if (frame) {
      listener([frame]);
    }
  });

  const unlistenFrameBatch = await listen<LegacyVncFrameEvent[]>('shellpilot-vnc-frame-batch', (event) => {
    const frames: VncFrameEvent[] = [];

    for (const payload of event.payload) {
      const frame = normalizeVncFrameEvent(payload);

      if (frame) {
        frames.push(frame);
      }
    }

    if (frames.length > 0) {
      listener(frames);
    }
  });

  return () => {
    unlistenFrame();
    unlistenFrameBatch();
  };
}

function normalizeVncFrameEvent(frame: LegacyVncFrameEvent): VncFrameEvent | undefined {
  if (frame.kind === 'copy') {
    if (frame.sourceX == null || frame.sourceY == null) {
      return undefined;
    }

    return {
      height: frame.height,
      kind: 'copy',
      panelId: frame.panelId,
      sequence: frame.sequence,
      sourceX: frame.sourceX,
      sourceY: frame.sourceY,
      width: frame.width,
      x: frame.x,
      y: frame.y,
    };
  }

  if (!frame.data) {
    return undefined;
  }

  return {
    data: frame.data,
    height: frame.height,
    kind: 'raw',
    panelId: frame.panelId,
    sequence: frame.sequence,
    width: frame.width,
    x: frame.x,
    y: frame.y,
  };
}

function createVncTarget(
  panelId: string,
  session: SessionItem,
  options: { password?: string },
) {
  const usesPasswordCredential =
    session.authMethod === 'password' ||
    session.authMethod === 'os-credential' ||
    session.authMethod === 'interactive' ||
    !session.authMethod;
  const passwordCredentialRef = resolvePasswordCredentialRef(session);

  if (!session.host?.trim()) {
    throw new VncOpenError('VNC host is not set.', { retryable: false });
  }

  if (usesPasswordCredential && !options.password && !session.credentialRef) {
    throw new VncOpenError('VNC password is not saved. Enter a password to connect.', {
      authPrompt: true,
    });
  }

  return {
    credentialId: usesPasswordCredential && !options.password ? passwordCredentialRef.id : null,
    host: session.host,
    panelId,
    password: usesPasswordCredential ? options.password ?? null : null,
    port: session.port ?? 5900,
    username: session.username?.trim() || null,
  };
}
