import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Drawer } from '@base-ui/react/drawer';
import type { SnapshotPoint } from '@shared/types';
import { Button } from '@client/components/ui/button';
import { useFinancialValues } from '../lib/valueVisibility';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  financialForm?: boolean;
  /** Render in place as a side panel (wide screens' list + detail) instead of a modal sheet. */
  inline?: boolean;
  children: ReactNode;
}

function HiddenForm({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) return children;
  return (
    <Button type="button" variant="secondary" className="min-h-11 rounded-xl px-4 text-label" onClick={() => setRevealed(true)}>
      Show values in this form
    </Button>
  );
}

/**
 * Bottom sheet on phones (swipe down or tap outside to dismiss), centred panel on desktop.
 * Base UI Drawer: modal focus trap, scroll lock, nested-sheet aware; motion lives in index.css (.sheet-*).
 */
export function Sheet({ open, onClose, title, subtitle, financialForm, inline, children }: SheetProps) {
  const { valuesHidden } = useFinancialValues();
  const popupRef = useRef<HTMLDivElement>(null);

  // Pages often mount a sheet already open (`{x && <Sheet open …/>}`) and unmount it on close.
  // The drawer only animates a closed→open change, so open one frame after mount, and on dismiss
  // play the exit first and only then tell the page (which may unmount us).
  const [shown, setShown] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const dismissing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  if (inline) {
    if (!open) return null;
    // Same header and body as the sheet, laid out in the page; the body scrolls within the viewport.
    return (
      <section
        aria-label={title}
        className="view-in flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-3xl border"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="min-w-0 pt-1.5">
            <h2 className="text-heading">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-caption" style={{ color: 'var(--text-muted)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <Button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="sheet-body">{financialForm && valuesHidden ? <HiddenForm>{children}</HiddenForm> : children}</div>
      </section>
    );
  }

  return (
    <Drawer.Root
      open={shown}
      onOpenChange={(next) => {
        if (next) return;
        dismissing.current = true;
        setShown(false);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen || !dismissing.current) return;
        dismissing.current = false;
        onClose();
        // The page can refuse to close (e.g. while saving): if it still wants us open, come back.
        setTimeout(() => {
          if (mounted.current && openRef.current) setShown(true);
        }, 0);
      }}
      swipeDirection="down"
    >
      <Drawer.Portal>
        <Drawer.Backdrop className="sheet-backdrop" />
        <Drawer.Viewport className="sheet-viewport">
          <Drawer.Popup
            ref={popupRef}
            // Touch/mouse: focus the panel itself so opening a form doesn't summon the keyboard.
            initialFocus={(type) => (type === 'keyboard' ? true : popupRef.current)}
            className="sheet-popup"
          >
            <div aria-hidden="true" className="sheet-handle" />
            <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-2 md:pt-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="min-w-0 pt-1.5">
                <Drawer.Title className="text-heading" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </Drawer.Title>
                {subtitle && (
                  <Drawer.Description className="mt-0.5 text-caption" style={{ color: 'var(--text-muted)' }}>
                    {subtitle}
                  </Drawer.Description>
                )}
              </div>
              <Drawer.Close
                render={
                  <Button
                    type="button"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                }
              />
            </div>
            <Drawer.Content className="sheet-body">
              {financialForm && valuesHidden ? <HiddenForm>{children}</HiddenForm> : children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export function NetWorthSparkline({ snapshots }: { snapshots: SnapshotPoint[] }) {
  if (snapshots.length < 2) return null;
  const values = snapshots.map((s) => s.netWorth);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 260;
  const height = 40;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - 4 - ((v - min) / span) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const isUp = values[values.length - 1] >= values[0];
  const stroke = isUp ? 'var(--accent)' : 'var(--negative)';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-10 w-full overflow-visible">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill="url(#sparkFill)" points={`0,${height} ${points} ${width},${height}`} />
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
