import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type AppDialogKind = 'alert' | 'choice' | 'confirm' | 'prompt';

interface AppDialogChoice {
  label: string;
  tone?: 'danger' | 'default';
  value: string;
}

interface AppDialogRequest<T = boolean | string | undefined> {
  choices?: AppDialogChoice[];
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

export function appChoose<T extends string>(input: {
  choices: Array<{ label: string; tone?: 'danger' | 'default'; value: T }>;
  message: string;
  title?: string;
}) {
  return requestAppDialog<T | undefined>({
    choices: input.choices,
    kind: 'choice',
    message: input.message,
    title: input.title ?? 'Choose Action',
  });
}

export function AppDialogProvider() {
  const [request, setRequest] = useState<AppDialogRequest>();
  const [openChoiceMenu, setOpenChoiceMenu] = useState<string>();
  const [promptValue, setPromptValue] = useState('');

  useEffect(() => {
    const handler = (event: Event) => {
      const nextRequest = (event as CustomEvent<AppDialogRequest>).detail;

      setPromptValue(nextRequest.defaultValue ?? '');
      setOpenChoiceMenu(undefined);
      setRequest(nextRequest);
    };

    window.addEventListener(appDialogEventName, handler);
    return () => window.removeEventListener(appDialogEventName, handler);
  }, []);

  const closeWith = (value: boolean | string | undefined) => {
    request?.resolve(value);
    setOpenChoiceMenu(undefined);
    setRequest(undefined);
  };

  const isPrompt = request?.kind === 'prompt';
  const isConfirm = request?.kind === 'confirm';
  const isChoice = request?.kind === 'choice';

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open) {
          closeWith(isPrompt || isChoice ? undefined : false);
        }
      }}
    >
      <DialogContent
        className={cn(
          'max-w-[calc(100vw-2rem)] border-border bg-card p-4 text-card-foreground shadow-2xl',
          isChoice ? 'w-[min(30rem,calc(100vw-2rem))]' : 'max-w-md',
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-base text-card-foreground">{request?.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line text-xs font-medium leading-5 text-muted-foreground">
            {request?.message}
          </DialogDescription>
        </DialogHeader>

        {isPrompt && (
          <input
            className="session-input h-9 border-border bg-background text-sm text-foreground"
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

        <DialogFooter className={isChoice ? 'flex-wrap justify-end gap-2 sm:justify-end' : undefined}>
          {(isConfirm || isPrompt) && (
            <Button type="button" variant="ghost" onClick={() => closeWith(isPrompt ? undefined : false)}>
              {request?.rejectLabel ?? 'Cancel'}
            </Button>
          )}
          {isChoice ? (
            getDialogChoiceGroups(request?.choices ?? []).map((choice) => (
              choice.secondary ? (
                <div className="relative flex shrink-0" key={choice.primary.value}>
                  <Button
                    className="rounded-r-none"
                    type="button"
                    variant={getDialogChoiceVariant(choice.primary)}
                    onClick={() => closeWith(choice.primary.value)}
                  >
                    {choice.primary.label}
                  </Button>
                  <Button
                    className="w-8 rounded-l-none border-l border-black/10 px-0"
                    type="button"
                    variant={getDialogChoiceVariant(choice.primary)}
                    aria-label={`${choice.primary.label} options`}
                    onClick={() =>
                      setOpenChoiceMenu((value) =>
                        value === choice.primary.value ? undefined : choice.primary.value,
                      )
                    }
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                  {openChoiceMenu === choice.primary.value && (
                    <div className="absolute right-0 top-10 z-50 min-w-full rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                      <button
                        className="flex h-8 w-full items-center rounded px-2 text-left text-xs hover:bg-accent"
                        type="button"
                        onClick={() => closeWith(choice.secondary?.value)}
                      >
                        {choice.secondary.label}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  className="shrink-0"
                  key={choice.primary.value}
                  type="button"
                  variant={getDialogChoiceVariant(choice.primary)}
                  onClick={() => closeWith(choice.primary.value)}
                >
                  {choice.primary.label}
                </Button>
              )
            ))
          ) : (
            <Button
              type="button"
              variant={request?.tone === 'danger' ? 'destructive' : 'default'}
              onClick={() => closeWith(isPrompt ? promptValue : true)}
            >
              {request?.resolveLabel ?? 'OK'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getDialogChoiceGroups(choices: AppDialogChoice[]) {
  const secondaryByPrimary = new Map<string, AppDialogChoice>();
  const secondaryValues = new Set<string>();

  choices.forEach((choice) => {
    const value = choice.value;

    if (!value.endsWith('-all')) {
      return;
    }

    const primaryValue = value.slice(0, -4);
    const primary = choices.find((item) => item.value === primaryValue);

    if (!primary) {
      return;
    }

    secondaryByPrimary.set(primaryValue, choice);
    secondaryValues.add(value);
  });

  return choices
    .filter((choice) => !secondaryValues.has(choice.value))
    .map((choice) => ({
      primary: choice,
      secondary: secondaryByPrimary.get(choice.value),
    }));
}

function getDialogChoiceVariant(choice: AppDialogChoice) {
  if (choice.tone === 'danger') {
    return 'destructive';
  }

  return choice.value === 'cancel' ? 'ghost' : 'default';
}
