import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const overlayScrollbarInset = 12;
const overlayScrollbarMinThumbSize = 32;

export function OverlayScrollArea({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({
    height: 0,
    top: 0,
    visible: false,
  });

  const syncThumb = useCallback(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const maxScrollTop = element.scrollHeight - element.clientHeight;

    if (maxScrollTop <= 0) {
      setThumb({ height: 0, top: 0, visible: false });
      return;
    }

    const trackHeight = Math.max(
      overlayScrollbarMinThumbSize,
      element.clientHeight - overlayScrollbarInset * 2,
    );
    const height = Math.max(
      overlayScrollbarMinThumbSize,
      Math.round((element.clientHeight / element.scrollHeight) * trackHeight),
    );
    const top = Math.round((element.scrollTop / maxScrollTop) * (trackHeight - height));

    setThumb({ height, top, visible: true });
  }, []);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver(syncThumb);

    resizeObserver.observe(element);
    if (element.firstElementChild) {
      resizeObserver.observe(element.firstElementChild);
    }

    syncThumb();

    return () => {
      resizeObserver.disconnect();
    };
  }, [syncThumb]);

  return (
    <div className="group/scroll relative h-full min-h-0 overflow-hidden">
      <div
        {...props}
        className={cn('app-scrollbar-native-hidden h-full min-h-0 overflow-auto', className)}
        ref={scrollRef}
        onScroll={syncThumb}
      >
        {children}
      </div>
      {thumb.visible && (
        <div className="pointer-events-none absolute bottom-3 right-0.5 top-3 w-1.5 opacity-0 transition-opacity duration-200 group-hover/scroll:opacity-100">
          <div
            className="absolute right-0 w-1 rounded-full bg-[hsl(var(--scrollbar-thumb)_/_0.78)] transition-colors duration-200"
            style={{ height: thumb.height, top: thumb.top }}
          />
        </div>
      )}
    </div>
  );
}
