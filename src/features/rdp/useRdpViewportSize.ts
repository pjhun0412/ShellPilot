import { useEffect, useState, type RefCallback } from 'react';

export interface RdpViewportSize {
  height: number;
  width: number;
}

export function useRdpViewportSize<TElement extends HTMLElement>(): {
  viewportRef: RefCallback<TElement>;
  viewportSize?: RdpViewportSize;
} {
  const [viewportElement, setViewportElement] = useState<TElement | null>(null);
  const [viewportSize, setViewportSize] = useState<RdpViewportSize>();

  useEffect(() => {
    if (!viewportElement) {
      return;
    }

    const updateViewportSize = () => {
      const rect = viewportElement.getBoundingClientRect();

      setViewportSize({
        height: Math.max(0, Math.floor(rect.height)),
        width: Math.max(0, Math.floor(rect.width)),
      });
    };
    const observer = new ResizeObserver(updateViewportSize);

    updateViewportSize();
    observer.observe(viewportElement);

    return () => observer.disconnect();
  }, [viewportElement]);

  return {
    viewportRef: setViewportElement,
    viewportSize,
  };
}
