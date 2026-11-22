import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import type { SnapshotPoint } from '@shared/types';
import { Button } from '@client/components/ui/button';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export function Sheet({ open, onClose, title, subtitle, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:max-w-lg sm:rounded-2xl"
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <Button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition"
            style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-y-auto overflow-x-hidden px-5 py-4 safe-pb">{children}</div>
      </div>
    </div>
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
