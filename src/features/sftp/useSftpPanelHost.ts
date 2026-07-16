import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';

export function useSftpPanelHost({
  isActive,
  panelRef,
}: {
  isActive: boolean;
  panelRef: RefObject<HTMLDivElement>;
}) {
  const isActivePanelRef = useRef(false);
  const [panelWidth, setPanelWidth] = useState(0);
  const [pendingActivationSelectionPath, setPendingActivationSelectionPath] = useState<string | null>();

  useEffect(() => {
    isActivePanelRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    const element = panelRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      setPanelWidth(Math.round(entry.contentRect.width));
    });

    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, [panelRef]);

  useEffect(() => {
    const handleDocumentPointerDown = (event: globalThis.PointerEvent) => {
      const panelElement = panelRef.current;

      if (!panelElement || !(event.target instanceof Node)) {
        isActivePanelRef.current = false;
        return;
      }

      isActivePanelRef.current = panelElement.contains(event.target);
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    };
  }, [panelRef]);

  const handleFocusCapture = useCallback(() => {
    isActivePanelRef.current = true;
  }, []);

  const handlePointerDownCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isActive) {
      setPendingActivationSelectionPath(findActivationEntryPath(event.target) ?? null);
    }

    isActivePanelRef.current = true;
    panelRef.current?.focus({ preventScroll: true });
  }, [isActive, panelRef]);

  return {
    clearPendingActivationSelectionPath: () => setPendingActivationSelectionPath(undefined),
    handleFocusCapture,
    handlePointerDownCapture,
    isActivePanelRef,
    panelWidth,
    pendingActivationSelectionPath,
  };
}

function findActivationEntryPath(target: EventTarget) {
  if (!(target instanceof HTMLElement)) {
    return undefined;
  }

  const entryElement = target.closest<HTMLElement>('[data-sftp-entry-path], [data-commander-entry-path]');

  return entryElement?.dataset.sftpEntryPath ?? entryElement?.dataset.commanderEntryPath;
}
