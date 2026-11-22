import type { Appearance } from '@shared/types';

export const DEFAULT_APPEARANCE: Appearance = {
  base: 'midnight',
  accent: 'lime',
  custom: '#4F8CFF',
  tiles: 'colour',
  followSystem: false,
};

export interface BaseDef {
  id: Appearance['base'];
  label: string;
  sub: string;
  dark: boolean;
  bg: string;
  surface: string;
  subtle: string;
  hover: string;
  border: string;
  borderStrong: string;
  text: string;
  secondary: string;
  muted: string;
  nav: string;
}

export const BASES: BaseDef[] = [
  {
    id: 'midnight', label: 'Midnight', sub: 'Default', dark: true,
    bg: '#0D0E11', surface: '#17191E', subtle: '#22252C', hover: '#2A2E36', border: '#2A2E36', borderStrong: '#3A3F48',
    text: '#F4F5F7', secondary: '#C4C8CF', muted: '#9BA1AC', nav: '#1F2229',
  },
  {
    id: 'graphite', label: 'Graphite', sub: 'Softer', dark: true,
    bg: '#1B1C20', surface: '#25272D', subtle: '#2F3239', hover: '#383B43', border: '#3A3D45', borderStrong: '#4A4E57',
    text: '#F2F2F0', secondary: '#C9CBD0', muted: '#A9ACB3', nav: '#2A2C33',
  },
  {
    id: 'oled', label: 'OLED', sub: 'True black', dark: true,
    bg: '#000000', surface: '#111214', subtle: '#1C1D21', hover: '#26282D', border: '#26282D', borderStrong: '#363940',
    text: '#FFFFFF', secondary: '#C4C8CF', muted: '#9BA1AC', nav: '#141518',
  },
  {
    id: 'day', label: 'Day', sub: 'Light', dark: false,
    bg: '#F2F3F5', surface: '#FFFFFF', subtle: '#E7E9EE', hover: '#DDE0E6', border: '#DCDFE5', borderStrong: '#C8CCD4',
    text: '#0D0E11', secondary: '#3D424B', muted: '#575D68', nav: '#FFFFFF',
  },
];

export const ACCENTS: Array<{ id: Exclude<Appearance['accent'], 'custom'>; label: string; hex: string }> = [
  { id: 'lime', label: 'Lime', hex: '#C8F25A' },
  { id: 'lilac', label: 'Lilac', hex: '#B9A6FF' },
  { id: 'coral', label: 'Coral', hex: '#FF8A6B' },
  { id: 'aqua', label: 'Aqua', hex: '#5CE1E6' },
  { id: 'amber', label: 'Amber', hex: '#FFC247' },
  { id: 'pink', label: 'Pink', hex: '#FF8FC7' },
];

const PASTELS = ['#FFC78A', '#8FE3B0', '#8EC5FF', '#FFB3C7', '#B9A6FF', '#FFE08A'];
export const TILE_COUNT = PASTELS.length;

// --- colour maths ---

function rgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
}

function toHex(c: number[]): string {
  return (
    '#' +
    c
      .map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** Weighted mix: w=1 → a, w=0 → b. */
export function mix(a: string, b: string, w: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([0, 1, 2].map((i) => x[i] * w + y[i] * (1 - w)));
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Nudges `hex` toward white (dark bg) or black (light bg) until it reaches `ratio` against `bg`. */
export function ensureContrast(hex: string, bg: string, ratio = 4.5): string {
  const target = luminance(bg) < 0.4 ? '#FFFFFF' : '#000000';
  for (let i = 0; i <= 20; i++) {
    const c = mix(target, hex, i / 20);
    if (contrast(c, bg) >= ratio) return c;
  }
  return target;
}

export function readableOn(fill: string): string {
  return contrast('#0D0E11', fill) >= contrast('#FFFFFF', fill) ? '#0D0E11' : '#FFFFFF';
}

export function accentHex(a: Appearance): string {
  if (a.accent === 'custom') return a.custom.toUpperCase();
  return ACCENTS.find((x) => x.id === a.accent)?.hex || ACCENTS[0].hex;
}

export function resolveBase(a: Appearance, systemPrefersLight: boolean): BaseDef {
  if (a.followSystem && systemPrefersLight) return BASES.find((b) => b.id === 'day')!;
  return BASES.find((b) => b.id === a.base) || BASES[0];
}

export type Tokens = Record<string, string>;

export function computeTokens(a: Appearance, base: BaseDef): Tokens {
  const accent = accentHex(a);
  const accentFg = readableOn(accent);
  const accentText = ensureContrast(accent, base.surface, 4.5);
  const status = base.dark
    ? { pos: '#5EE38F', neg: '#FF9A9A', warn: '#FFC247', info: '#8EC5FF' }
    : { pos: '#15803D', neg: '#B42318', warn: '#A15C07', info: '#1D4ED8' };
  const soft = (c: string) => mix(c, base.surface, base.dark ? 0.16 : 0.12);

  const t: Tokens = {
    '--bg-canvas': base.bg,
    '--bg-surface': base.surface,
    '--bg-subtle': base.subtle,
    '--bg-hover': base.hover,
    '--bg-glass': base.dark ? `${base.nav}F2` : 'rgba(255,255,255,0.94)',
    '--bg-nav': base.nav,
    '--border-subtle': base.border,
    '--border-strong': base.borderStrong,
    '--text-primary': base.text,
    '--text-secondary': base.secondary,
    '--text-muted': base.muted,
    '--accent': accent,
    '--accent-hover': mix(accent, base.dark ? '#FFFFFF' : '#000000', 0.88),
    '--accent-fg': accentFg,
    '--accent-text': accentText,
    '--accent-soft': mix(accent, base.surface, base.dark ? 0.16 : 0.2),
    '--accent-border': mix(accent, base.surface, 0.5),
    '--positive': status.pos,
    '--positive-soft': soft(status.pos),
    '--negative': status.neg,
    '--negative-soft': soft(status.neg),
    '--warning': status.warn,
    '--warning-soft': soft(status.warn),
    '--info': status.info,
    '--info-soft': soft(status.info),
    '--card-shadow': base.dark ? 'none' : '0 1px 2px rgba(13,14,17,0.04), 0 6px 18px rgba(13,14,17,0.05)',
    '--color-scheme': base.dark ? 'dark' : 'light',
  };

  for (let i = 0; i < TILE_COUNT; i++) {
    let bg: string;
    let fg: string;
    if (a.tiles === 'mono') {
      bg = base.subtle;
      fg = base.text;
    } else if (a.tiles === 'tinted') {
      bg = mix(accent, base.surface, 0.18 + (i % 3) * 0.07);
      fg = ensureContrast(accent, bg, 4.5);
    } else {
      bg = PASTELS[i];
      fg = '#0D0E11';
    }
    t[`--tile-bg-${i}`] = bg;
    t[`--tile-fg-${i}`] = fg;
  }
  return t;
}

export function applyTokens(tokens: Tokens): void {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(tokens)) root.style.setProperty(k, v);
  root.style.colorScheme = tokens['--color-scheme'] || 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['--bg-canvas']);
}

const STORAGE_KEY = 'actual_companion_appearance_v1';

/** Applies the appearance now and caches both variants so index.html can paint before React loads. */
export function applyAppearance(a: Appearance): void {
  const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
  applyTokens(computeTokens(a, resolveBase(a, prefersLight)));
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        appearance: a,
        follow: a.followSystem,
        primary: computeTokens(a, resolveBase({ ...a, followSystem: false }, false)),
        day: computeTokens(a, BASES.find((b) => b.id === 'day')!),
      }),
    );
  } catch {
    // storage unavailable — fine, server copy is the source of truth
  }
}

export function loadCachedAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { appearance?: Appearance };
      if (parsed.appearance) return { ...DEFAULT_APPEARANCE, ...parsed.appearance };
    }
  } catch {
    // ignore
  }
  return DEFAULT_APPEARANCE;
}

/** Stable tile index for a label (category or payee), so the same category always gets the same colour. */
export function tileIndex(label: string | null | undefined): number {
  const s = label || '?';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % TILE_COUNT;
}

export function tileStyle(label: string | null | undefined): { backgroundColor: string; color: string } {
  const i = tileIndex(label);
  return { backgroundColor: `var(--tile-bg-${i})`, color: `var(--tile-fg-${i})` };
}
