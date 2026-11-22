import React, { useState } from 'react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { Button } from '@client/components/ui/button';

/** A labelled group of settings cards ("General", "Security", …). */
export function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="px-1 text-xs font-extrabold uppercase tracking-[0.08em]" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One settings card with the same header treatment everywhere. */
export function SettingsCard({
  icon,
  title,
  description,
  right,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  right?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-4 rounded-3xl p-5">
      <div className="flex items-start justify-between gap-3">
        {/* Same header treatment as the Appearance and Notifications cards: accent icon beside the title. */}
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-4 [&>svg]:w-4" style={{ color: 'var(--accent-text)' }}>
            {icon}
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-extrabold leading-tight">{title}</h3>
            {description && (
              <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {description}
              </p>
            )}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Collapsed-by-default area for rarely used, technical settings. */
export function Disclosure({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl" style={{ backgroundColor: 'var(--bg-subtle)' }}>
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[48px] w-full items-center justify-between gap-3 px-4 py-2 text-left"
      >
        <span className="flex flex-col">
          <span className="text-sm font-bold">{title}</span>
          {description && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {description}
            </span>
          )}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform" style={{ transform: open ? 'rotate(180deg)' : 'none', color: 'var(--text-muted)' }} />
      </Button>
      {open && <div className="flex flex-col gap-4 border-t px-4 pb-4 pt-4" style={{ borderColor: 'var(--border-subtle)' }}>{children}</div>}
    </div>
  );
}

/** Two-step inline confirmation: no browser popups, nothing destructive on a single tap. */
export function ConfirmAction({
  label,
  confirmLabel,
  message,
  onConfirm,
  busy = false,
  ariaLabel,
}: {
  label: React.ReactNode;
  confirmLabel: string;
  message: string;
  onConfirm: () => void | Promise<void>;
  busy?: boolean;
  ariaLabel?: string;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        type="button"
        onClick={() => setAsking(true)}
        aria-label={ariaLabel}
        className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold"
        style={{ color: 'var(--negative)' }}
      >
        {label}
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-2 rounded-2xl p-3" style={{ backgroundColor: 'var(--negative-soft)' }} role="alert">
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
        {message}
      </p>
      <div className="flex gap-2">
        <Button type="button" onClick={() => setAsking(false)} variant="secondary" className="h-10 flex-1 rounded-xl text-sm font-bold">
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={async () => {
            await onConfirm();
            setAsking(false);
          }}
          className="h-10 flex-1 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ backgroundColor: 'var(--negative)', color: 'var(--bg-canvas)' }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/** A value shown in a code box with a copy button that confirms in place. */
export function CopyField({
  label,
  value,
  display,
  mono = true,
  clamp = false,
}: {
  label: string;
  value: string;
  display?: React.ReactNode;
  mono?: boolean;
  /** Long values show three lines with a "Show all" toggle. */
  clamp?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <div className="flex items-stretch gap-2">
        <code
          className={`min-w-0 flex-1 rounded-xl px-3 py-2.5 text-xs leading-relaxed [overflow-wrap:anywhere] ${mono ? '' : 'font-sans'} ${clamp && !expanded ? 'line-clamp-3' : ''}`}
          style={{ backgroundColor: 'var(--bg-canvas)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
        >
          {display ?? value}
        </code>
        <Button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            });
          }}
          aria-label={`Copy ${label}`}
          variant="secondary" className="flex w-12 shrink-0 items-center justify-center rounded-xl"
        >
          {copied ? <Check className="h-4 w-4" style={{ color: 'var(--positive)' }} /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      {clamp && (
        <Button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex min-h-[36px] items-center gap-1 self-start text-xs font-bold"
          style={{ color: 'var(--accent-text)' }}
        >
          <ChevronDown className="h-3.5 w-3.5 transition-transform" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }} />
          {expanded ? 'Show less' : 'Show all'}
        </Button>
      )}
    </div>
  );
}

/** "Chrome on Windows"-style description of a browser user agent. */
export function describeDevice(ua: string): string {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : '';
  return browser ? `${browser} on ${os}` : os;
}
