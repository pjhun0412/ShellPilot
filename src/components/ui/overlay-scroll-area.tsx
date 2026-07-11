import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type HTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

const overlayScrollbarInset = 12;
const overlayScrollbarMinThumbSize = 32;

interface OverlayScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  containerClassName?: string;
}

export const OverlayScrollArea = forwardRef<HTMLDivElement, OverlayScrollAreaProps>(function OverlayScrollArea({
  children,
  className,
  containerClassName,
  ...props
}, forwardedRef) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [verticalThumb, setVerticalThumb] = useState({
    height: 0,
    top: 0,
    visible: false,
  });
  const [horizontalThumb, setHorizontalThumb] = useState({
    left: 0,
    visible: false,
    width: 0,
  });

  useImperativeHandle(forwardedRef, () => scrollRef.current as HTMLDivElement, []);

  const syncThumb = useCallback(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    const maxScrollTop = element.scrollHeight - element.clientHeight;

    if (maxScrollTop <= 0) {
      setVerticalThumb({ height: 0, top: 0, visible: false });
    } else {
      const trackHeight = Math.max(
        overlayScrollbarMinThumbSize,
        element.clientHeight - overlayScrollbarInset * 2,
      );
      const height = Math.max(
        overlayScrollbarMinThumbSize,
        Math.round((element.clientHeight / element.scrollHeight) * trackHeight),
      );
      const top = Math.round((element.scrollTop / maxScrollTop) * (trackHeight - height));

      setVerticalThumb({ height, top, visible: true });
    }

    if (maxScrollLeft <= 0) {
      setHorizontalThumb({ left: 0, visible: false, width: 0 });
      return;
    }

    const trackWidth = Math.max(
      overlayScrollbarMinThumbSize,
      element.clientWidth - overlayScrollbarInset * 2,
    );
    const width = Math.max(
      overlayScrollbarMinThumbSize,
      Math.round((element.clientWidth / element.scrollWidth) * trackWidth),
    );
    const left = Math.round((element.scrollLeft / maxScrollLeft) * (trackWidth - width));

    setHorizontalThumb({ left, visible: true, width });
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
    <div className={cn('group/scroll relative h-full min-h-0 overflow-hidden', containerClassName)}>
      <div
        {...props}
        className={cn('app-scrollbar-native-hidden h-full min-h-0 overflow-auto', className)}
        ref={scrollRef}
        onScroll={syncThumb}
      >
        {children}
      </div>
      {verticalThumb.visible && (
        <div className="pointer-events-none absolute bottom-3 right-0.5 top-3 w-1.5 opacity-0 transition-opacity duration-200 group-hover/scroll:opacity-100">
          <div
            className="absolute right-0 w-1 rounded-full bg-[hsl(var(--scrollbar-thumb)_/_0.78)] transition-colors duration-200"
            style={{ height: verticalThumb.height, top: verticalThumb.top }}
          />
        </div>
      )}
      {horizontalThumb.visible && (
        <div className="pointer-events-none absolute bottom-0.5 left-3 right-3 h-1.5 opacity-0 transition-opacity duration-200 group-hover/scroll:opacity-100">
          <div
            className="absolute bottom-0 h-1 rounded-full bg-[hsl(var(--scrollbar-thumb)_/_0.78)] transition-colors duration-200"
            style={{ left: horizontalThumb.left, width: horizontalThumb.width }}
          />
        </div>
      )}
    </div>
  );
});
