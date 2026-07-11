import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
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
  const dragRef = useRef<
    | {
        axis: 'horizontal' | 'vertical';
        pointerStart: number;
        scrollStart: number;
      }
    | undefined
  >();
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

  const startThumbDrag = useCallback(
    (axis: 'horizontal' | 'vertical') => (event: ReactPointerEvent<HTMLDivElement>) => {
      const element = scrollRef.current;

      if (!element) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);

      dragRef.current = {
        axis,
        pointerStart: axis === 'vertical' ? event.clientY : event.clientX,
        scrollStart: axis === 'vertical' ? element.scrollTop : element.scrollLeft,
      };
    },
    [],
  );

  const handleThumbDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const element = scrollRef.current;

    if (!drag || !element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (drag.axis === 'vertical') {
      const maxScrollTop = element.scrollHeight - element.clientHeight;
      const trackHeight = Math.max(
        overlayScrollbarMinThumbSize,
        element.clientHeight - overlayScrollbarInset * 2,
      );
      const travel = Math.max(1, trackHeight - verticalThumb.height);
      const delta = event.clientY - drag.pointerStart;

      element.scrollTop = drag.scrollStart + (delta / travel) * maxScrollTop;
      syncThumb();
      return;
    }

    const maxScrollLeft = element.scrollWidth - element.clientWidth;
    const trackWidth = Math.max(
      overlayScrollbarMinThumbSize,
      element.clientWidth - overlayScrollbarInset * 2,
    );
    const travel = Math.max(1, trackWidth - horizontalThumb.width);
    const delta = event.clientX - drag.pointerStart;

    element.scrollLeft = drag.scrollStart + (delta / travel) * maxScrollLeft;
    syncThumb();
  }, [horizontalThumb.width, syncThumb, verticalThumb.height]);

  const stopThumbDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragRef.current = undefined;
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
            className="pointer-events-auto absolute right-0 w-1 cursor-grab touch-none rounded-full bg-[hsl(var(--scrollbar-thumb)_/_0.78)] transition-colors duration-200 active:cursor-grabbing"
            style={{ height: verticalThumb.height, top: verticalThumb.top }}
            onPointerDown={startThumbDrag('vertical')}
            onPointerMove={handleThumbDrag}
            onPointerUp={stopThumbDrag}
            onPointerCancel={stopThumbDrag}
          />
        </div>
      )}
      {horizontalThumb.visible && (
        <div className="pointer-events-none absolute bottom-0.5 left-3 right-3 h-1.5 opacity-0 transition-opacity duration-200 group-hover/scroll:opacity-100">
          <div
            className="pointer-events-auto absolute bottom-0 h-1 cursor-grab touch-none rounded-full bg-[hsl(var(--scrollbar-thumb)_/_0.78)] transition-colors duration-200 active:cursor-grabbing"
            style={{ left: horizontalThumb.left, width: horizontalThumb.width }}
            onPointerDown={startThumbDrag('horizontal')}
            onPointerMove={handleThumbDrag}
            onPointerUp={stopThumbDrag}
            onPointerCancel={stopThumbDrag}
          />
        </div>
      )}
    </div>
  );
});
