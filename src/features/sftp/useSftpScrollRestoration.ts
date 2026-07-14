import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

type ScrollPosition = {
  left: number;
  top: number;
};

const defaultScrollPosition: ScrollPosition = { left: 0, top: 0 };

function clampScrollPosition(viewport: HTMLDivElement, position: ScrollPosition): ScrollPosition {
  return {
    left: Math.min(position.left, Math.max(0, viewport.scrollWidth - viewport.clientWidth)),
    top: Math.min(position.top, Math.max(0, viewport.scrollHeight - viewport.clientHeight)),
  };
}

export function useSftpScrollRestoration({
  contentVersion,
  path,
}: {
  contentVersion: string;
  path: string;
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const currentPathRef = useRef(path);
  const positionsRef = useRef(new Map<string, ScrollPosition>());
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);

  const storeViewportPosition = useCallback((viewport: HTMLDivElement, targetPath: string) => {
    positionsRef.current.set(targetPath, {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    });
  }, []);

  const saveScrollPosition = useCallback(() => {
    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    storeViewportPosition(viewport, currentPathRef.current);
  }, [storeViewportPosition]);

  const scrollViewportRef = useCallback((viewport: HTMLDivElement | null) => {
    if (viewportRef.current && viewportRef.current !== viewport) {
      storeViewportPosition(viewportRef.current, currentPathRef.current);
    }

    viewportRef.current = viewport;
    setViewportElement(viewport);
  }, [storeViewportPosition]);

  useEffect(() => {
    if (!viewportElement) {
      return;
    }

    const saveCurrentViewportPosition = () => {
      storeViewportPosition(viewportElement, currentPathRef.current);
    };

    viewportElement.addEventListener('scroll', saveCurrentViewportPosition, { passive: true });

    return () => {
      saveCurrentViewportPosition();
      viewportElement.removeEventListener('scroll', saveCurrentViewportPosition);
    };
  }, [storeViewportPosition, viewportElement]);

  useLayoutEffect(() => {
    currentPathRef.current = path;

    const viewport = viewportRef.current;

    if (!viewport) {
      return;
    }

    const nextPosition = clampScrollPosition(
      viewport,
      positionsRef.current.get(path) ?? defaultScrollPosition,
    );

    viewport.scrollLeft = nextPosition.left;
    viewport.scrollTop = nextPosition.top;
  }, [contentVersion, path]);

  return {
    saveScrollPosition,
    scrollViewportRef,
  };
}
