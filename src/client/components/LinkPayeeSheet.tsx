import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import type { ActualPayee } from '@shared/types';
import { apiFetch } from '../lib/api';
import { Sheet } from './Sheet';
import { Tile } from './Tile';
import { Button } from '@client/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { Alert } from '@client/components/ui/alert';

interface LinkPayeeSheetProps {
  open: boolean;
  onClose: () => void;
  /** The name as the bank writes it, e.g. "McDonalds JE". */
  raw: string;
  payees: ActualPayee[];
  /** When renaming an existing transaction's payee: that payee's id, so past transactions can be merged too. */
  mergePayeeId?: string | null;
  onLinked: (result: { targetName: string; merged: boolean }) => void;
}

/** Suggests a shorter "contains" text: the leading words, minus branch/outlet codes like "JE" or "#123". */
function suggestContains(raw: string): string {
  const words = raw.trim().split(/\s+/);
  const kept = words.filter((w, i) => i === 0 || (w.length > 2 && !/\d/.test(w)));
  return (kept.slice(0, 2).join(' ') || raw).slice(0, 40);
}

export function LinkPayeeSheet({ open, onClose, raw, payees, mergePayeeId, onLinked }: LinkPayeeSheetProps) {
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [match, setMatch] = useState<'exact' | 'contains'>('exact');
  const [containsText, setContainsText] = useState('');
  const [merge, setMerge] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const guess = suggestContains(raw);
    setQuery(guess);
    setTargetId(null);
    setNewName(null);
    setMatch('exact');
    setContainsText(guess);
    setMerge(true);
    setError(null);
  }, [open, raw]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return payees
      .filter((p) => !p.transfer_acct && p.id !== mergePayeeId && p.name.toLowerCase() !== raw.toLowerCase())
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [payees, query, mergePayeeId, raw]);
  const exact = payees.some((p) => p.name.toLowerCase() === query.trim().toLowerCase());
  const target = payees.find((p) => p.id === targetId);
  const targetLabel = target?.name || newName;

  async function save() {
    if (!targetId && !newName) return setError('Choose the payee to rename to.');
    if (match === 'contains' && containsText.trim().length < 2) return setError('Enter at least 2 characters to match on.');
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ targetName: string; merged: boolean }>('/api/payees/link', {
        method: 'POST',
        body: JSON.stringify({
          raw,
          ...(targetId ? { targetPayeeId: targetId } : { targetName: newName }),
          match,
          ...(match === 'contains' ? { containsText: containsText.trim() } : {}),
          ...(mergePayeeId && merge ? { mergePayeeId } : {}),
        }),
      });
      onLinked({ targetName: res.targetName || targetLabel || '', merged: res.merged });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the rule');
    } finally {
      setBusy(false);
    }
  }

  const chip = (on: boolean): React.CSSProperties => ({
    backgroundColor: on ? 'var(--accent)' : 'transparent',
    color: on ? 'var(--accent-fg)' : 'var(--text-muted)',
  });

  return (
    <Sheet open={open} onClose={onClose} title="Link payee" subtitle="Saved as an Actual rule, so imports are renamed automatically">
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl p-3.5" style={{ backgroundColor: 'var(--bg-subtle)' }}>
          <span className="text-label" style={{ color: 'var(--text-muted)' }}>
            When the bank says
          </span>
          <div className="mt-0.5 break-words text-body font-semibold">{raw}</div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-label" style={{ color: 'var(--text-muted)' }}>
            Match
          </span>
          <RadioGroup value={match} onValueChange={(value) => setMatch(value as typeof match)} aria-label="Match type" className="grid grid-cols-2 gap-1 rounded-2xl p-1" style={{ backgroundColor: 'var(--bg-subtle)' }}>
            <RadioGroupItem value="exact" className="h-10 rounded-xl text-label transition-colors duration-150" style={chip(match === 'exact')}>
              Exactly this
            </RadioGroupItem>
            <RadioGroupItem value="contains" className="h-10 rounded-xl text-label transition-colors duration-150" style={chip(match === 'contains')}>
              Contains…
            </RadioGroupItem>
          </RadioGroup>
          {match === 'contains' && (
            <>
              <Input
                aria-label="Text the bank's payee must contain"
                value={containsText}
                onChange={(e) => setContainsText(e.target.value)}
              />
              <p className="text-caption" style={{ color: 'var(--text-muted)' }}>
                Catches every outlet, e.g. “{containsText || 'McDonalds'} JE”, “{containsText || 'McDonalds'} Tampines”.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-label" style={{ color: 'var(--text-muted)' }}>
            Rename to
          </span>
          <Label className="flex h-11 items-center gap-2 rounded-xl border px-3" style={{ backgroundColor: 'var(--bg-subtle)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
            <Search className="h-4 w-4 shrink-0" />
            <Input
              variant="unstyled"
              aria-label="Search payees"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setTargetId(null);
                setNewName(null);
              }}
              placeholder="Search your payees"
              className="h-full min-w-0 flex-1 bg-transparent text-body outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </Label>
          <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
            {candidates.map((p) => (
              <Button
                key={p.id}
                type="button"
                onClick={() => {
                  setTargetId(p.id);
                  setNewName(null);
                }}
                className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 text-left"
                style={{ backgroundColor: targetId === p.id ? 'var(--accent-soft)' : 'transparent' }}
              >
                <Tile colorKey={p.name} label={p.name} size={32} />
                <span className="flex-1 truncate text-body">{p.name}</span>
                {targetId === p.id && <Check className="h-4 w-4" style={{ color: 'var(--accent-text)' }} />}
              </Button>
            ))}
            {query.trim() && !exact && (
              <Button
                type="button"
                onClick={() => {
                  setNewName(query.trim());
                  setTargetId(null);
                }}
                className="flex min-h-11 items-center gap-3 rounded-xl border border-dashed px-2 py-1.5 text-left text-body"
                style={{ borderColor: 'var(--accent-text)', color: 'var(--accent-text)', backgroundColor: newName ? 'var(--accent-soft)' : 'transparent' }}
              >
                <Plus className="h-4 w-4" />
                New payee “{query.trim()}”
                {newName && <Check className="ml-auto h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>

        {mergePayeeId && (
          <Label className="flex items-start gap-3 text-body">
            <Input variant="unstyled" type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} className="mt-0.5 h-5 w-5" style={{ accentColor: 'var(--accent)' }} />
            <span>
              Also rename past transactions
              <span className="block text-caption" style={{ color: 'var(--text-muted)' }}>
                Merges the “{raw}” payee into {targetLabel ? `“${targetLabel}”` : 'the one you pick'} in Actual.
              </span>
            </span>
          </Label>
        )}

        {error && (
          <Alert as="p" variant="destructive">
            {error}
          </Alert>
        )}
        <Button type="button" disabled={busy || !targetLabel} onClick={() => void save()} variant="default" className="h-12 rounded-2xl text-body disabled:opacity-40">
          {busy ? 'Saving…' : targetLabel ? `Always use “${targetLabel}”` : 'Choose a payee'}
        </Button>
      </div>
    </Sheet>
  );
}
