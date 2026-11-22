import { useState } from 'react';
import { CalendarCheck, Mail } from 'lucide-react';
import type { EmailEventRecord } from '@shared/types';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { formatSignedMoney } from '../lib/api';
import { friendlyDate } from '../lib/recent';
import { Sheet } from './Sheet';

interface BillMatchSheetProps {
  event: EmailEventRecord;
  accountName: string | null;
  currency: string;
  busy: boolean;
  onClose: () => void;
  onDecision: (action: 'link' | 'reject', transactionId: string, remember: boolean) => void;
}

export function BillMatchSheet({ event, accountName, currency, busy, onClose, onDecision }: BillMatchSheetProps) {
  const [selected, setSelected] = useState('');
  const [remember, setRemember] = useState(false);
  const parsed = event.parsed;
  const review = parsed?.billReview;
  const candidates = review?.candidates || [];
  const match = candidates.find((candidate) => candidate.transactionId === selected) || candidates[0];
  if (!parsed || !match) return null;

  return (
    <Sheet open onClose={onClose} title="Link to paid bill" subtitle={accountName || parsed.accountRef?.label}>
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl bg-secondary p-3">
          <div className="flex items-center gap-2.5">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Card alert · {friendlyDate(parsed.date)}</p>
              <p className="text-xs text-muted-foreground">{parsed.payee}</p>
            </div>
            <span className="shrink-0 text-sm font-bold tabular-nums">{formatSignedMoney(parsed.amountBase ?? 0, currency)}</span>
          </div>

          {candidates.length === 1 ? (
            <div className="mt-3 flex items-center gap-2.5 border-t border-border pt-3">
              <CalendarCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Posted bill · {friendlyDate(match.date)}</p>
                <p className="text-xs text-muted-foreground">{match.scheduleName}</p>
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums">{formatSignedMoney(match.amountCents / 100, currency)}</span>
            </div>
          ) : (
            <RadioGroup aria-label="Choose a posted bill" value={match.transactionId} onValueChange={setSelected}
              className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              {candidates.map((candidate) => (
                <RadioGroupItem key={candidate.transactionId} value={candidate.transactionId} disabled={busy}
                  className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold data-[state=checked]:bg-accent">
                  <span>{candidate.scheduleName} · {friendlyDate(candidate.date)}</span>
                  <span className="shrink-0 tabular-nums">{formatSignedMoney(candidate.amountCents / 100, currency)}</span>
                </RadioGroupItem>
              ))}
            </RadioGroup>
          )}
        </div>

        {review?.canRemember && (
          <Label className="flex min-h-11 items-center gap-3">
            <Input variant="unstyled" type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={remember}
              disabled={busy} onChange={(event) => setRemember(event.target.checked)} />
            <span>
              <span className="block text-sm font-bold">Remember for future charges</span>
              <span className="block text-xs text-muted-foreground">Auto-link when one posted bill matches this merchant and card.</span>
            </span>
          </Label>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" disabled={busy} className="min-h-12 rounded-xl px-2 text-sm font-bold"
            onClick={() => onDecision('reject', match.transactionId, false)}>
            Not a match
          </Button>
          <Button type="button" variant="default" disabled={busy} className="min-h-12 rounded-xl px-2 text-sm font-bold"
            onClick={() => onDecision('link', match.transactionId, remember)}>
            Link to paid bill
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
