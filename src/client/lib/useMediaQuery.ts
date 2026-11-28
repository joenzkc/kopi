import { useCallback, useSyncExternalStore } from 'react';

/** Desktop dashboard layouts switch on at Tailwind's `xl` breakpoint. */
export const WIDE_QUERY = '(min-width: 1280px)';

/** Whether a CSS media query currently matches; re-renders when it starts or stops matching. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}
