import { useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@client/components/ui/button';
import { Label } from '@client/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { cn } from '@client/lib/utils';
import { shortSymbol, tileVars } from './format';

/** Rounded tile showing a ticker (Tile.tsx shows one letter; tickers read better in full). */
export function SymbolTile({ symbol, tile, size = 42 }: { symbol: string; tile: number; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center text-caption font-bold tabular-nums"
      style={{ ...tileVars(tile), width: size, height: size, borderRadius: Math.round(size / 3), letterSpacing: shortSymbol(symbol).length > 3 ? '-0.04em' : '-0.01em' }}
    >
      {shortSymbol(symbol)}
    </span>
  );
}

/** Section header used across the page: heading on the left, muted figure or action on the right. */
export function SectionHeader({ title, right, id }: { title: string; right?: ReactNode; id?: string }) {
  return (
    <div id={id} className="flex min-h-11 items-center justify-between gap-3 px-1">
      <h2 className="text-heading">{title}</h2>
      {right}
    </div>
  );
}

export interface SegmentOption<V extends string> {
  value: V;
  label: ReactNode;
}

/** Pill segmented control for 2–4 options. */
export function Segmented<V extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  className,
}: {
  value: V;
  onChange: (value: V) => void;
  options: SegmentOption<V>[];
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as V)}
      aria-label={ariaLabel}
      className={cn(
        'grid gap-1 p-1',
        size === 'sm' ? 'inline-grid grid-flow-col rounded-full' : 'rounded-2xl',
        className,
      )}
      style={{
        backgroundColor: size === 'sm' ? 'var(--bg-surface)' : 'var(--bg-subtle)',
        gridTemplateColumns: size === 'sm' ? undefined : `repeat(${options.length}, minmax(0, 1fr))`,
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <RadioGroupItem
            key={o.value}
            value={o.value}
            className={cn(
              'truncate text-label transition-colors duration-150',
              size === 'sm' ? 'h-9 rounded-full px-3.5' : 'h-10 rounded-xl px-2',
            )}
            style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
          >
            {o.label}
          </RadioGroupItem>
        );
      })}
    </RadioGroup>
  );
}

/** Form field: muted label above the control, optional helper text below. */
export function Field({
  label,
  htmlFor,
  help,
  aside,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  help?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-label" style={{ color: 'var(--text-muted)' }}>
          {label}
        </Label>
        {aside}
      </div>
      {children}
      {help && (
        <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
          {help}
        </p>
      )}
    </div>
  );
}

/** Full-width destructive action that asks for a second tap instead of a browser confirm. */
export function DeleteButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
      className="press flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-body font-semibold transition-colors duration-150 disabled:opacity-50"
      style={{
        backgroundColor: armed ? 'var(--negative-soft)' : 'transparent',
        color: 'var(--negative)',
      }}
    >
      <Trash2 className="h-4 w-4" />
      {armed ? 'Tap again to delete' : label}
    </Button>
  );
}

/** Primary full-width submit used at the bottom of every sheet form. */
export function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <Button type="submit" disabled={disabled} variant="default" className="h-12 w-full rounded-2xl text-body disabled:opacity-50">
      {children}
    </Button>
  );
}
