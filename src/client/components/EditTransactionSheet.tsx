import { useState, type FormEvent } from 'react';
import type { ActualAccount, ActualCategory, ActualPayee, RecentTransaction, TransactionChanges } from '@shared/types';
import { Alert } from '@client/components/ui/alert';
import { Button } from '@client/components/ui/button';
import { Input } from '@client/components/ui/input';
import { Label } from '@client/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@client/components/ui/radio-group';
import { Select } from '@client/components/ui/select';
import { Switch, SwitchThumb } from '@client/components/ui/switch';
import { Textarea } from '@client/components/ui/textarea';
import { apiFetch } from '../lib/api';
import { Sheet } from './Sheet';

interface EditTransactionSheetProps {
  transaction: RecentTransaction;
  accounts: ActualAccount[];
  categories: ActualCategory[];
  payees: ActualPayee[];
  baseCurrency: string;
  onClose: () => void;
  onSaved: () => void;
  onLinkPayee?: () => void;
}

export function EditTransactionSheet({ transaction, accounts, categories, payees, baseCurrency, onClose, onSaved, onLinkPayee }: EditTransactionSheetProps) {
  const initialPayee = transaction.payee || transaction.isTransfer ? transaction.payeeName : '';
  const initialCategory = transaction.category ?? '';
  const initialNotes = transaction.notes ?? '';
  const initialCleared = Boolean(transaction.cleared);
  const [amount, setAmount] = useState((Math.abs(transaction.amount) / 100).toFixed(2));
  const [direction, setDirection] = useState(transaction.amount < 0 ? 'out' : 'in');
  const [date, setDate] = useState(transaction.date);
  const [payeeName, setPayeeName] = useState(initialPayee);
  const [category, setCategory] = useState(initialCategory);
  const [notes, setNotes] = useState(initialNotes);
  const [cleared, setCleared] = useState(initialCleared);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const split = Boolean(transaction.is_parent || transaction.subtransactions?.length);
  const account = accounts.find((a) => a.id === transaction.account);
  const counterpart = accounts.find((a) => a.id === transaction.transferAccountId);
  const canEditCategory = !split && account?.offbudget === false && (!transaction.isTransfer || counterpart?.offbudget === true);
  const magnitude = amount.trim() ? Math.round(Number(amount) * 100) : NaN;
  const amountCents = direction === 'out' ? -magnitude : magnitude;
  const changes: TransactionChanges = {
    ...(!split && amountCents !== transaction.amount ? { amount: amountCents } : {}),
    ...(date !== transaction.date ? { date } : {}),
    ...(!transaction.isTransfer && payeeName.trim() !== initialPayee.trim() ? { payeeName: payeeName.trim() || null } : {}),
    ...(canEditCategory && category !== initialCategory ? { category: category || null } : {}),
    ...(notes !== initialNotes ? { notes: notes || null } : {}),
    ...(!transaction.reconciled && cleared !== initialCleared ? { cleared } : {}),
  };
  const hasChanges = Object.keys(changes).length > 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !hasChanges) return;
    if (!Number.isSafeInteger(amountCents) || magnitude < 0) {
      setError('Enter a valid amount.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/transactions/${encodeURIComponent(transaction.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ accountId: transaction.account, originalDate: transaction.date, changes }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save transaction');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open financialForm onClose={() => { if (!busy) onClose(); }} title="Edit transaction" subtitle={transaction.accountName}>
      <form onSubmit={save}>
        <fieldset disabled={busy} className="space-y-4">
          <div>
            <Label htmlFor="edit-tx-payee" className="mb-1 block text-label" style={{ color: 'var(--text-muted)' }}>Payee</Label>
            <Input id="edit-tx-payee" value={payeeName} onChange={(e) => setPayeeName(e.target.value)}
              readOnly={transaction.isTransfer} list={transaction.isTransfer ? undefined : 'edit-tx-payees'}
              placeholder="No payee" maxLength={120} />
            {!transaction.isTransfer && (
              <datalist id="edit-tx-payees">
                {payees.map((p) => <option key={p.id} value={p.name} />)}
              </datalist>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <div className="min-w-0">
              <Label htmlFor="edit-tx-amount" className="mb-1 block text-label" style={{ color: 'var(--text-muted)' }}>Amount ({baseCurrency})</Label>
              <Input id="edit-tx-amount" type="number" inputMode="decimal" min="0" step="0.01" required readOnly={split}
                value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="min-w-0">
              <span id="edit-tx-direction" className="mb-1 block text-label" style={{ color: 'var(--text-muted)' }}>Direction</span>
              <RadioGroup
                aria-labelledby="edit-tx-direction"
                value={direction}
                onValueChange={setDirection}
                disabled={split}
                className="grid h-11 grid-cols-2 gap-1 rounded-[0.875rem] p-1 data-[disabled]:opacity-50"
                style={{ backgroundColor: 'var(--bg-subtle)' }}
              >
                {[
                  { value: 'out', label: 'Out' },
                  { value: 'in', label: 'In' },
                ].map((o) => (
                  <RadioGroupItem
                    key={o.value}
                    value={o.value}
                    className="min-w-12 rounded-[0.625rem] px-3 text-label transition-colors duration-150"
                    style={direction === o.value ? { backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' } : { color: 'var(--text-muted)' }}
                  >
                    {o.label}
                  </RadioGroupItem>
                ))}
              </RadioGroup>
            </div>
          </div>
          <div>
            <Label htmlFor="edit-tx-date" className="mb-1 block text-label" style={{ color: 'var(--text-muted)' }}>Date</Label>
            <Input id="edit-tx-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {canEditCategory && (
            <div>
              <Label htmlFor="edit-tx-category" className="mb-1 block text-label" style={{ color: 'var(--text-muted)' }}>Category</Label>
              <Select
                id="edit-tx-category"
                aria-label="Category"
                value={category}
                onValueChange={setCategory}
                options={[
                  { value: '', label: 'Uncategorized' },
                  ...(initialCategory && !categories.some((c) => c.id === initialCategory)
                    ? [{ value: initialCategory, label: transaction.categoryName || 'Current category' }]
                    : []),
                  ...categories.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
          )}
          {split && <p className="text-caption" style={{ color: 'var(--text-muted)' }}>Edit split amounts and categories in Actual.</p>}
          <div>
            <Label htmlFor="edit-tx-notes" className="mb-1 block text-label" style={{ color: 'var(--text-muted)' }}>Notes</Label>
            <Textarea id="edit-tx-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-tx-cleared" className="text-body">{transaction.reconciled ? 'Reconciled' : 'Cleared'}</Label>
            <Switch id="edit-tx-cleared" type="button" checked={cleared} onCheckedChange={setCleared}
              disabled={Boolean(transaction.reconciled) || busy} className="flex min-h-11 items-center">
              <SwitchThumb />
            </Switch>
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
          <Button type="submit" variant="default" disabled={!hasChanges || busy} className="h-12 w-full rounded-2xl text-body">
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
          {onLinkPayee && (
            <Button type="button" onClick={onLinkPayee} disabled={hasChanges || busy} className="min-h-11 w-full text-label disabled:opacity-50" style={{ color: 'var(--accent-text)' }}>
              Link payee for imports
            </Button>
          )}
        </fieldset>
      </form>
    </Sheet>
  );
}
