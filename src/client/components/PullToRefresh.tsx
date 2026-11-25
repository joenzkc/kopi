import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

const THRESHOLD = 72; // px of (damped) pull needed to refresh
const MAX_PULL = 130; // damped distance approaches this asymptotically (rubber band)
const HOLD = 56; // where the content rests while refreshing
const MIN_SPIN_MS = 700;

/** Rubber-band: 1:1 at first, then increasingly resistant, never past MAX_PULL. */
function damp(dy: number): number {
  if (dy <= 0) return 0;
  return (MAX_PULL * dy) / (dy + MAX_PULL);
}

/**
 * Pull-to-refresh for touch devices. Tracks the finger directly (no animation while dragging),
 * then springs back with an ease-out. Listeners are passive and never call preventDefault;
 * the page sets `overscroll-behavior-y: none` so the browser's own bounce/refresh doesn't fight it.
 */
export function PullToRefresh({ onRefresh, disabled, children }: { onRefresh: () => Promise<unknown> | void; disabled?: boolean; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (disabled) return;
    if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: coarse)').matches) return;

    let startY = 0;
    let startX = 0;
    let tracking = false;
    let pulling = false;
    let distance = 0;

    const paint = (d: number, animate: boolean) => {
      const content = contentRef.current;
      const indicator = indicatorRef.current;
      const icon = iconRef.current;
      if (!content || !indicator || !icon) return;
      const t = animate ? 'transform 320ms var(--ease-out), opacity 200ms ease' : 'none';
      content.style.transition = t;
      indicator.style.transition = t;
      content.style.transform = d ? `translate3d(0, ${d}px, 0)` : '';
      const progress = Math.min(1, d / THRESHOLD);
      indicator.style.opacity = String(progress);
      indicator.style.transform = `translate3d(-50%, ${d - 44}px, 0) scale(${0.7 + 0.3 * progress})`;
      if (!refreshingRef.current) icon.style.transform = `rotate(${d * 2.6}deg)`;
    };

    const blocked = () =>
      refreshingRef.current ||
      window.scrollY > 0 ||
      // Don't hijack drags inside open sheets, dialogs or popovers.
      Boolean(document.querySelector('[role="dialog"], [data-slot="dialog-content"], [role="listbox"], [role="menu"]'));

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || blocked()) {
        tracking = false;
        return;
      }
      tracking = true;
      pulling = false;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (!pulling) {
        if (dy > 6 && Math.abs(dy) > Math.abs(dx) * 1.2 && window.scrollY <= 0) pulling = true;
        else if (Math.abs(dx) > 10 || dy < -6) tracking = false;
        if (!pulling) return;
      }
      distance = damp(dy);
      paint(distance, false);
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!pulling) return;
      pulling = false;
      if (distance >= THRESHOLD) {
        refreshingRef.current = true;
        setRefreshing(true);
        paint(HOLD, true);
        const started = Date.now();
        Promise.resolve(onRefreshRef.current())
          .catch(() => undefined)
          .then(() => new Promise((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - started)))))
          .then(() => {
            refreshingRef.current = false;
            setRefreshing(false);
            paint(0, true);
          });
      } else {
        paint(0, true);
      }
      distance = 0;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [disabled]);

  return (
    <>
      <div
        ref={indicatorRef}
        aria-hidden={!refreshing}
        role="status"
        aria-label={refreshing ? 'Refreshing' : undefined}
        className="pointer-events-none fixed left-1/2 z-20 flex h-10 w-10 items-center justify-center rounded-full md:hidden"
        style={{
          top: 'max(0.75rem, env(safe-area-inset-top))',
          opacity: 0,
          transform: 'translate3d(-50%, -44px, 0)',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--accent-text)',
        }}
      >
        <span ref={iconRef} className="flex">
          <RefreshCw className={`h-[18px] w-[18px] ${refreshing ? 'animate-spin' : ''}`} />
        </span>
      </div>
      {/* No permanent transform/will-change here: it would turn this into the containing block for the
          position:fixed sheets that pages render inline. The transform exists only while pulling. */}
      <div ref={contentRef} className="flex min-h-dvh min-w-0 flex-1 flex-col">
        {children}
      </div>
    </>
  );
}
