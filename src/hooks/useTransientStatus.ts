import { useCallback, useEffect, useRef, useState } from 'react';

export function useTransientStatus(defaultTimeoutMs = 2400) {
  const [statusText, setStatusText] = useState<string>();
  const timeoutRef = useRef<number>();

  const clearStatus = useCallback(() => {
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }

    setStatusText(undefined);
  }, []);

  const setPersistentStatus = useCallback((message?: string) => {
    if (timeoutRef.current !== undefined) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }

    setStatusText(message);
  }, []);

  const showTransientStatus = useCallback(
    (message: string, timeoutMs = defaultTimeoutMs) => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }

      setStatusText(message);
      timeoutRef.current = window.setTimeout(() => {
        setStatusText(undefined);
        timeoutRef.current = undefined;
      }, timeoutMs);
    },
    [defaultTimeoutMs],
  );

  useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  return {
    clearStatus,
    setPersistentStatus,
    showTransientStatus,
    statusText,
  };
}
