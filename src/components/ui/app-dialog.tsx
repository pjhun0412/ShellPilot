import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type AppDialogKind = 'alert' | 'confirm' | 'prompt';

interface AppDialogRequest<T = boolean | string | undefined> {
  defaultValue?: string;
  kind: AppDialogKind;
  message: string;
  rejectLabel?: string;
  resolve: (value: T) => void;
  resolveLabel?: string;
  title: string;
  tone?: 'danger' | 'default';
}

const appDialogEventName = 'shellpilot:app-dialog';

function requestAppDialog<T>(request: Omit<AppDialogRequest<T>, 'resolve'>) {
  return new Promise<T>((resolve) => {
    window.dispatchEvent(
      new CustomEvent<AppDialogRequest<T>>(appDialogEventName, {
        detail: {
          ...request,
          resolve,
        },
      }),
    );
  });
}

export function appAlert(input: { message: string; title?: string }) {
  return requestAppDialog<void>({
    kind: 'alert',
    message: input.message,
    resolveLabel: 'OK',
    title: input.title ?? 'Notice',
  });
}

export function appConfirm(input: {
  cancelLabel?: string;
  confirmLabel?: string;
  message: string;
  title?: string;
  tone?: 'danger' | 'default';
}) {
  return requestAppDialog<boolean>({
    kind: 'confirm',
    message: input.message,
    rejectLabel: input.cancelLabel ?? 'Cancel',
    resolveLabel: input.confirmLabel ?? 'Confirm',
    title: input.title ?? 'Confirm',
    tone: input.tone,
  });
}

export function appPrompt(input: {
  cancelLabel?: string;
  confirmLabel?: string;
  defaultValue?: string;
  message: string;
  title?: string;
}) {
  return requestAppDialog<string | undefined>({
    defaultValue: input.defaultValue,
    kind: 'prompt',
    message: input.message,
    rejectLabel: input.cancelLabel ?? 'Cancel',
    resolveLabel: input.confirmLabel ?? 'Save',
    title: input.title ?? 'Input Required',
  });
}

export function AppDialogProvider() {
  const [request, setRequest] = useState<AppDialogRequest>();
  const [promptValue, setPromptValue] = useState('');

  useEffect(() => {
    const handler = (event: Event) => {
      const nextRequest = (event as CustomEvent<AppDialogRequest>).detail;

      setPromptValue(nextRequest.defaultValue ?? '');
      setRequest(nextRequest);
    };

    window.addEventListener(appDialogEventName, handler);
    return () => window.removeEventListener(appDialogEventName, handler);
  }, []);

  const closeWith = (value: boolean | string | undefined) => {
    request?.resolve(value);
    setRequest(undefined);
  };

  const isPrompt = request?.kind === 'prompt';
  const isConfirm = request?.kind === 'confirm';

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open) {
          closeWith(isPrompt ? undefined : false);
        }
      }}
    >
      <DialogContent className="max-w-md border-slate-800 bg-slate-950 p-4 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-base text-slate-50">{request?.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line text-xs font-medium leading-5 text-slate-300">
            {request?.message}
          </DialogDescription>
        </DialogHeader>

        {isPrompt && (
          <input
            className="session-input h-9 bg-black/55 text-sm"
            autoFocus
            value={promptValue}
            onChange={(event) => setPromptValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                closeWith(promptValue);
              }
            }}
          />
        )}

        <DialogFooter>
          {(isConfirm || isPrompt) && (
            <Button type="button" variant="ghost" onClick={() => closeWith(isPrompt ? undefined : false)}>
              {request?.rejectLabel ?? 'Cancel'}
            </Button>
          )}
          <Button
            type="button"
            variant={request?.tone === 'danger' ? 'destructive' : 'default'}
            onClick={() => closeWith(isPrompt ? promptValue : true)}
          >
            {request?.resolveLabel ?? 'OK'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
