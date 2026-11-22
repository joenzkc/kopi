import React from 'react';
import { Check, Palette } from 'lucide-react';
import type { Appearance } from '@shared/types';
import { ACCENTS, BASES, DEFAULT_APPEARANCE, accentHex, contrast, readableOn, resolveBase } from '../lib/theme';
import { Tile } from './Tile';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Switch, SwitchThumb } from '@client/components/ui/switch';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Badge } from '@client/components/ui/badge';
import { Card } from '@client/components/ui/card';

interface AppearanceSectionProps {
  appearance: Appearance;
  onChange: (next: Appearance) => void;
}

export function AppearanceSection({ appearance, onChange }: AppearanceSectionProps) {
  const set = (patch: Partial<Appearance>) => onChange({ ...appearance, ...patch });
  const prefersLight = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches;
  const activeBase = resolveBase(appearance, Boolean(prefersLight));
  const accent = accentHex(appearance);
  // Presets are tuned per base; only warn when a hand-picked colour nearly disappears.
  const lowContrast = appearance.accent === 'custom' && contrast(accent, activeBase.bg) < 3;

  const swatchRing = (on: boolean) =>
    on ? '0 0 0 3px var(--bg-surface), 0 0 0 5px var(--accent-text)' : 'inset 0 0 0 1px var(--border-subtle)';

  return (
    <Card as="section" className="flex flex-col gap-5 rounded-3xl p-5">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />
        <h2 className="text-base font-extrabold">Appearance</h2>
      </div>

      {/* Live preview */}
      <Card variant="outline" className="flex flex-col gap-3 rounded-[24px] bg-background p-4" aria-label="Preview">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Net worth</span>
            <span className="text-2xl font-extrabold tracking-tight">S$12,345<span style={{ color: 'var(--text-muted)' }}>.67</span></span>
          </div>
          <Badge variant="accent" className="px-2.5 py-1 text-[11px] font-extrabold">
            ▲ 1.23%
          </Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}>
            <div className="text-xs font-bold">Budget</div>
            <div className="text-base font-extrabold">S$1,234</div>
          </div>
          <div className="rounded-2xl p-3" style={{ backgroundColor: 'var(--tile-bg-4)', color: 'var(--tile-fg-4)' }}>
            <div className="text-xs font-bold">Invest</div>
            <div className="text-base font-extrabold">S$5,678</div>
          </div>
        </div>
        {['Food & Dining', 'Transport', 'Utilities'].map((c, i) => (
          <div key={c} className="flex items-center gap-3">
            <Tile colorKey={c} label={c} size={32} />
            <span className="flex-1 text-sm font-semibold">{c}</span>
            <span className="text-sm font-bold tabular-nums">{['−S$12.34', '−S$5.60', '−S$78.90'][i]}</span>
          </div>
        ))}
        <span className="text-sm font-bold" style={{ color: 'var(--accent-text)' }}>Links and labels look like this</span>
      </Card>

      {/* Base */}
      <div className="flex flex-col gap-2.5">
        <h3 className="text-sm font-extrabold">Base</h3>
        <RadioGroup value={appearance.base} onValueChange={(base) => set({ base: base as Appearance['base'] })} aria-label="Base colours" className="grid grid-cols-4 gap-2">
          {BASES.map((b) => {
            const on = appearance.base === b.id;
            return (
              <RadioGroupItem
                key={b.id}
                value={b.id}
                onClick={on ? () => set({ base: b.id }) : undefined}
                className="press flex flex-col items-center gap-1.5 rounded-2xl border-2 p-2"
                style={{ borderColor: on ? 'var(--accent-text)' : 'transparent', backgroundColor: 'var(--bg-subtle)' }}
              >
                <span className="flex h-12 w-full flex-col justify-between rounded-xl border p-1.5" style={{ backgroundColor: b.bg, borderColor: b.border }}>
                  <span className="h-2 w-3/4 rounded" style={{ backgroundColor: b.surface }} />
                  <span className="h-3.5 w-3.5 self-end rounded-full" style={{ backgroundColor: accent }} />
                </span>
                <span className="text-xs font-bold">{b.label}</span>
                <span className="-mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>{b.sub}</span>
              </RadioGroupItem>
            );
          })}
        </RadioGroup>
      </div>

      {/* Accent */}
      <div className="flex flex-col gap-2.5">
        <h3 className="text-sm font-extrabold">Accent</h3>
        <RadioGroup value={appearance.accent} onValueChange={(accent) => set({ accent: accent as Appearance['accent'] })} aria-label="Accent colour" className="grid grid-cols-7 gap-1">
          {[...ACCENTS.map((a) => ({ id: a.id as Appearance['accent'], label: a.label, hex: a.hex })), { id: 'custom' as const, label: 'Custom', hex: appearance.custom }].map((a) => {
            const on = appearance.accent === a.id;
            return (
              <RadioGroupItem
                key={a.id}
                value={a.id}
                aria-label={a.label}
                onClick={on ? () => set({ accent: a.id }) : undefined}
                className="flex flex-col items-center gap-1.5 py-0.5 text-[10px] font-semibold"
                style={{ color: 'var(--text-muted)' }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: a.hex, boxShadow: swatchRing(on), color: readableOn(a.hex) }}>
                  {on && <Check className="h-[18px] w-[18px]" strokeWidth={3} />}
                </span>
                {a.label}
              </RadioGroupItem>
            );
          })}
        </RadioGroup>
        {appearance.accent === 'custom' && (
          <Label className="flex items-center gap-3 rounded-2xl border p-2.5" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-subtle)' }}>
            <Input
              variant="unstyled"
              type="color"
              value={appearance.custom}
              onChange={(e) => set({ custom: e.target.value.toUpperCase(), accent: 'custom' })}
              aria-label="Custom accent colour"
              className="h-11 w-11 shrink-0 cursor-pointer rounded-xl border-0 bg-transparent p-0"
            />
            <span className="flex flex-col">
              <span className="text-sm font-bold">Custom accent</span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {appearance.custom.toUpperCase()} · text on it is {readableOn(appearance.custom) === '#FFFFFF' ? 'white' : 'dark'}
              </span>
            </span>
          </Label>
        )}
        {lowContrast && (
          <p className="rounded-xl px-3 py-2.5 text-xs leading-relaxed" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-secondary)' }}>
            This colour is close to the background, so buttons will be hard to see. Links and labels are shifted automatically so they stay readable.
          </p>
        )}
      </div>

      {/* Tiles */}
      <div className="flex flex-col gap-2.5">
        <h3 className="text-sm font-extrabold">Category icons</h3>
        <RadioGroup value={appearance.tiles} onValueChange={(tiles) => set({ tiles: tiles as Appearance['tiles'] })} aria-label="Category icon style" className="grid grid-cols-3 gap-1 rounded-2xl p-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          {(
            [
              ['colour', 'Colourful'],
              ['tinted', 'Tinted'],
              ['mono', 'Mono'],
            ] as const
          ).map(([id, label]) => {
            const on = appearance.tiles === id;
            return (
              <RadioGroupItem
                key={id}
                value={id}
                onClick={on ? () => set({ tiles: id }) : undefined}
                className="h-10 rounded-xl text-sm font-bold transition"
                style={{ backgroundColor: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--accent-fg)' : 'var(--text-muted)' }}
              >
                {label}
              </RadioGroupItem>
            );
          })}
        </RadioGroup>
      </div>

      <div className="flex flex-col rounded-2xl px-4" style={{ backgroundColor: 'var(--bg-subtle)' }}>
        <Switch
          checked={appearance.followSystem}
          onCheckedChange={(followSystem) => set({ followSystem })}
          className="flex min-h-[60px] items-center justify-between gap-3 text-left"
        >
          <span className="flex flex-col">
            <span className="text-sm font-bold">Follow system light mode</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Use Day when your device is in light mode</span>
          </span>
          <SwitchThumb className="shrink-0" />
        </Switch>
        <Button
          type="button"
          onClick={() => onChange({ ...DEFAULT_APPEARANCE, custom: appearance.custom })}
          className="min-h-[52px] border-t text-left text-sm font-bold"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--accent-text)' }}
        >
          Reset to Midnight + Lime
        </Button>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Saved to your server, so every device uses the same scheme.
      </p>
    </Card>
  );
}
