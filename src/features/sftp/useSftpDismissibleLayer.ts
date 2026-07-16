import { useEffect, type RefObject } from 'react';

export function useSftpDismissibleLayer({
  isOpen,
  layerRef,
  onDismiss,
}: {
  isOpen: boolean;
  layerRef: RefObject<HTMLElement>;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!layerRef.current?.contains(event.target as Node)) {
        onDismiss();
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, layerRef, onDismiss]);
}
