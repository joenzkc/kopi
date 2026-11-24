import { useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import type { SnapshotPoint } from '@shared/types';
import { Button } from '@client/components/ui/button';
import { useFinancialValues } from '../lib/valueVisibility';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogTitle } from '@client/components/ui/dialog';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  financialForm?: boolean;
  children: ReactNode;
}

function HiddenForm({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  if (revealed) return children;
  return (
    <Button type="button" variant="secondary" className="min-h-11 rounded-xl px-4 text-sm" onClick={() => setRevealed(true)}>
      Show values in this form
    </Button>
  );
}

export function Sheet({ open, onClose, title, subtitle, financialForm, children }: SheetProps) {
  const { valuesHidden } = useFinancialValues();
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <DialogOverlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity" onClick={onClose} />
        <DialogContent
          aria-describedby={undefined}
          className="relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-lg sm:rounded-2xl"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <div>
              <DialogTitle className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                {title}
              </DialogTitle>
              {subtitle && (
                <DialogDescription className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {subtitle}
                </DialogDescription>
              )}
            </div>
            <DialogClose asChild>
              <Button
                type="button"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition"
                style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
          <div className="overflow-y-auto overflow-x-hidden px-5 py-4 safe-pb">
            {financialForm && valuesHidden ? <HiddenForm>{children}</HiddenForm> : children}
          </div>
        </DialogContent>
      </div>
    </Dialog>
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
