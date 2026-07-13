import { useEffect, useState, type RefCallback } from 'react';

export interface VncViewportSize {
  height: number;
  width: number;
}

export function useVncViewportSize<TElement extends HTMLElement>(): {
  viewportRef: RefCallback<TElement>;
  viewportSize?: VncViewportSize;
} {
  const [viewportElement, setViewportElement] = useState<TElement | null>(null);
  const [viewportSize, setViewportSize] = useState<VncViewportSize>();

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

